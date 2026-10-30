// Turns the day's offers into picks: the best net return in each term bucket, among long-term
// investments only, and how fixed, floating and inflation-linked rates compare. Every number here
// is computed; the model only puts them into words.

import type { Benchmarks } from './benchmarks'
import { guarantee, type Guarantee } from './fgc'
import { type Offer, rateLabel } from './offer'
import { grossFactor, simulate, type Simulation } from './simulate'

const DAY = 86_400_000

export const BUCKETS = [
  { id: 'short', label: 'Up to 1 year', maxDays: 400 },
  { id: 'medium', label: '1 to 3 years', maxDays: 3 * 366 },
  { id: 'long', label: '3 to 6 years', maxDays: 6 * 366 },
  { id: 'veryLong', label: 'Over 6 years', maxDays: Infinity },
] as const
export type BucketId = (typeof BUCKETS)[number]['id']

/** Only CDBs that run for 2 years or more are recommended */
export const MIN_CDB_DAYS = 2 * 365
const CDB_BUCKETS: readonly { id: BucketId; label: string; maxDays: number }[] = [
  { id: 'medium', label: '2 to 3 years', maxDays: 3 * 366 },
  BUCKETS[2],
  BUCKETS[3],
]

/** Daily-liquidity offers are never picked, but are still simulated over a year for the source list */
export const RESERVE_HORIZON_DAYS = 365
const PICKS_PER_BUCKET = 3
/** CDBs are the main subject of the email, so more of them are listed */
const CDB_PICKS_PER_BUCKET = 5

/** Profit is also shown as if the money were taken out after each of these, in years */
export const HOLD_YEARS = [2, 5, 7]

/** The same offer simulated for one of the amounts in the email */
export interface Scenario {
  amount: number
  net: number
  netProfit: number
  netAnnual: number
}

export interface Ranked {
  offer: Offer
  /** Simulated for the first amount, which the picks are ranked by */
  sim: Simulation
  /** One per amount, smallest first */
  scenarios: Scenario[]
  /**
   * The same amounts held for each of HOLD_YEARS the offer runs long enough for. A term that ends
   * within a month of maturity is left out, since the scenarios at maturity already show it.
   */
  holds: { years: number; scenarios: Scenario[] }[]
  guarantee: Guarantee
  reasons: string[]
  warnings: string[]
}

export interface Bucket {
  id: BucketId
  label: string
  picks: Ranked[]
}

export interface BreakEven {
  prefixado: string
  ipca: string
  /** Inflation a year at which both pay the same, percent */
  breakEven: number
  /** Focus survey's expected inflation a year over the same years, percent */
  expected: number
}

export interface Picks {
  /** The best net return a year among the term picks */
  best?: Ranked
  buckets: Bucket[]
}

export interface Ranking extends Picks {
  /** The amount the picks are ranked by: the smallest of the amounts */
  amount: number
  amounts: number[]
  /** The same picks among CDBs alone, those that run for at least MIN_CDB_DAYS */
  cdbs: Picks
  /** How many CDBs can be picked */
  cdbsConsidered: number
  all: Ranked[]
  breakEvens: BreakEven[]
}

const pct = (n: number, digits = 2) => `${n.toFixed(digits)}%`
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function rank(offer: Offer, amounts: number[], b: Benchmarks, today: Date): Ranked {
  const sims = amounts.map((amount) => simulate(offer, amount, b, today, { horizonDays: RESERVE_HORIZON_DAYS }))
  const sim = sims[0]
  const amount = amounts[0]
  const scenario = ({ amount, net, netProfit, netAnnual }: Simulation): Scenario => ({ amount, net, netProfit, netAnnual })
  const scenarios = sims.map(scenario)
  const toMaturity = (new Date(`${offer.maturity}T00:00:00Z`).getTime() - today.getTime()) / DAY
  const holds = HOLD_YEARS.filter((years) => years * 365 <= toMaturity - 30).map((years) => ({
    years,
    scenarios: amounts.map((amount) => scenario(simulate(offer, amount, b, today, { holdDays: years * 365 }))),
  }))
  // The FGC limit is checked for the largest amount, the one most likely to go past it
  const g = guarantee(offer.product, sims[sims.length - 1].net)
  const reasons: string[] = []
  const warnings: string[] = []

  const points = sim.vsCdi
  reasons.push(
    `${points >= 0 ? '+' : ''}${points.toFixed(2)} points a year ${points >= 0 ? 'over' : 'under'} a CDB at 100% of CDI, after tax`,
  )
  if (sim.taxedEquivalent !== undefined) {
    reasons.push(`Tax-exempt: a taxed CDB would need to pay ${pct(sim.taxedEquivalent)} a year to match it`)
  }
  if (offer.indexer === 'PRE') reasons.push(`Locks in ${pct(offer.rate)} a year whatever happens to the Selic`)
  if (offer.indexer === 'IPCA+') reasons.push(`Pays ${pct(offer.rate)} a year above inflation, so it keeps its buying power`)
  reasons.push(g.kind === 'government' ? 'Backed by the federal government' : g.label)

  if (g.warning) warnings.push(amounts.length > 1 ? `Investing ${brl(amounts[amounts.length - 1])}: ${g.warning}` : g.warning)
  if (offer.minimum && offer.minimum > amount) warnings.push(`Minimum investment is ${brl(offer.minimum)}`)
  if (offer.product === 'TESOURO' && offer.liquidity === 'maturity') {
    warnings.push('Selling before maturity is at market price, which can be a loss')
  }
  if (offer.source.kind === 'web') warnings.push('Found on the web: confirm the rate at the broker before investing')
  return { offer, sim, scenarios, holds, guarantee: g, reasons, warnings }
}

const byNet = (a: Ranked, b: Ranked) => b.sim.netAnnual - a.sim.netAnnual

/** Prefixed, post-fixed and inflation-linked rates, each with its own risk */
const RATE_KINDS = [['PRE'], ['CDI', 'CDI+', 'SELIC+'], ['IPCA+']]

/**
 * The best of each kind of rate first, then the rest by net return. Ranked by net alone, one kind
 * can fill every place (post-fixed when the Selic is expected to stay high), and the investor
 * still wants the best prefixed CDB to compare.
 */
function mixed(sorted: Ranked[], n: number): Ranked[] {
  const firsts = RATE_KINDS.map((kind) => sorted.find((r) => kind.includes(r.offer.indexer))).filter((r) => r !== undefined)
  return [...firsts, ...sorted.filter((r) => !firsts.includes(r))].slice(0, n).sort(byNet)
}

/**
 * Pairs each Tesouro Prefixado with the Tesouro IPCA+ that matures closest to it. Tesouro sells few
 * Prefixados, so the pair can be years apart; the comparison is a rough read of what the market
 * prices in, not an exact break-even.
 */
export function breakEvens(offers: Offer[], b: Benchmarks, today: Date): BreakEven[] {
  const tesouro = offers.filter((o) => o.product === 'TESOURO')
  const time = (o: Offer) => new Date(`${o.maturity}T00:00:00Z`).getTime()
  const result: BreakEven[] = []
  for (const pre of tesouro.filter((o) => o.indexer === 'PRE')) {
    const ipca = tesouro
      .filter((o) => o.indexer === 'IPCA+')
      .sort((x, y) => Math.abs(time(x) - time(pre)) - Math.abs(time(y) - time(pre)))[0]
    if (!ipca || Math.abs(time(ipca) - time(pre)) > 4 * 365 * DAY) continue
    const end = new Date(time(pre))
    const years = (end.getTime() - today.getTime()) / DAY / 365
    // Forecast inflation compounded over the years to maturity, as a yearly rate
    const inflation = grossFactor({ indexer: 'IPCA+', rate: 0 }, b, today, end)
    result.push({
      prefixado: pre.name,
      ipca: ipca.name,
      breakEven: ((1 + pre.rate / 100) / (1 + ipca.rate / 100) - 1) * 100,
      expected: (Math.pow(inflation, 1 / years) - 1) * 100,
    })
  }
  return result
}

export function rankOffers(offers: Offer[], amountOrAmounts: number | number[], b: Benchmarks, today: Date): Ranking {
  const amounts = [...new Set([amountOrAmounts].flat())].sort((x, y) => x - y)
  if (!amounts.length) throw new Error('rankOffers needs at least one amount')
  const amount = amounts[0]
  const all = offers.map((o) => rank(o, amounts, b, today)).sort(byNet)
  // Only long-term investments are recommended: nothing withdrawn any day, and CDBs of 2 years or more
  const longTerm = (r: Ranked) =>
    r.offer.liquidity !== 'daily' &&
    (r.offer.product !== 'CDB' || new Date(`${r.offer.maturity}T00:00:00Z`).getTime() - today.getTime() >= MIN_CDB_DAYS * DAY)
  const recommendable = all.filter(longTerm)
  const affordable = recommendable.filter((r) => !r.offer.minimum || r.offer.minimum <= amount)
  return {
    amount,
    amounts,
    ...picks(affordable, PICKS_PER_BUCKET),
    cdbs: picks(
      affordable.filter((r) => r.offer.product === 'CDB'),
      CDB_PICKS_PER_BUCKET,
      CDB_BUCKETS,
      true,
    ),
    cdbsConsidered: recommendable.filter((r) => r.offer.product === 'CDB').length,
    all,
    breakEvens: breakEvens(offers, b, today),
  }
}

/** Offers already sorted by net return, from best; `mix` keeps the best of each kind of rate in every bucket */
function picks(sorted: Ranked[], perBucket: number, terms: typeof CDB_BUCKETS = BUCKETS, mix = false): Picks {
  const buckets: Bucket[] = terms.map((bucket) => ({ id: bucket.id, label: bucket.label, picks: [] as Ranked[] }))
  for (const r of sorted) {
    const i = terms.findIndex((bucket) => r.sim.days <= bucket.maxDays)
    if (i >= 0) buckets[i].picks.push(r)
  }
  for (const bucket of buckets) bucket.picks = mix ? mixed(bucket.picks, perBucket) : bucket.picks.slice(0, perBucket)
  const best = buckets.flatMap((bucket) => bucket.picks.slice(0, 1)).sort(byNet)[0]
  return { best, buckets }
}

/** One line per pick, for the email and for the model writing the summary */
export function describe(r: Ranked): string {
  const profits = r.scenarios.map((x) => `${brl(x.netProfit)} on ${brl(x.amount)}`).join(', ')
  return (
    `${r.offer.name} (${rateLabel(r.offer)}, until ${r.sim.until}, invest through ${r.offer.platform}): ` +
    `${pct(r.sim.netAnnual)} a year net, net profit ${profits}`
  )
}
