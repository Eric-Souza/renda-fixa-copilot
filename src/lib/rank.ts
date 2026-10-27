// Turns the day's offers into picks: the best net return in each term bucket, a place for money
// that may be needed any day, and how fixed, floating and inflation-linked rates compare. Every
// number here is computed; the model only puts them into words.

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

/** Daily-liquidity offers are compared over a year, the usual horizon for an emergency reserve */
export const RESERVE_HORIZON_DAYS = 365
const PICKS_PER_BUCKET = 3
/** CDBs are the main subject of the email, so more of them are listed */
const CDB_PICKS_PER_BUCKET = 5

export interface Ranked {
  offer: Offer
  sim: Simulation
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
  reserve?: Ranked
  /** The best net return a year among the term picks */
  best?: Ranked
  buckets: Bucket[]
}

export interface Ranking extends Picks {
  amount: number
  /** The same picks among CDBs alone */
  cdbs: Picks
  all: Ranked[]
  breakEvens: BreakEven[]
}

const pct = (n: number, digits = 2) => `${n.toFixed(digits)}%`
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

function rank(offer: Offer, amount: number, b: Benchmarks, today: Date): Ranked {
  const sim = simulate(offer, amount, b, today, { horizonDays: RESERVE_HORIZON_DAYS })
  const g = guarantee(offer.product, sim.net)
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
  if (offer.liquidity === 'daily') reasons.push('Can be withdrawn any business day')
  reasons.push(g.kind === 'government' ? 'Backed by the federal government' : g.label)

  if (g.warning) warnings.push(g.warning)
  if (offer.minimum && offer.minimum > amount) warnings.push(`Minimum investment is ${brl(offer.minimum)}`)
  if (offer.product === 'TESOURO' && offer.liquidity === 'maturity') {
    warnings.push('Selling before maturity is at market price, which can be a loss')
  }
  if (offer.source.kind === 'web') warnings.push('Found on the web: confirm the rate at the broker before investing')
  return { offer, sim, guarantee: g, reasons, warnings }
}

const byNet = (a: Ranked, b: Ranked) => b.sim.netAnnual - a.sim.netAnnual

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

export function rankOffers(offers: Offer[], amount: number, b: Benchmarks, today: Date): Ranking {
  const all = offers.map((o) => rank(o, amount, b, today)).sort(byNet)
  const affordable = all.filter((r) => !r.offer.minimum || r.offer.minimum <= amount)
  return {
    amount,
    ...picks(affordable, PICKS_PER_BUCKET),
    cdbs: picks(
      affordable.filter((r) => r.offer.product === 'CDB'),
      CDB_PICKS_PER_BUCKET,
    ),
    all,
    breakEvens: breakEvens(offers, b, today),
  }
}

/** Offers already sorted by net return, from best */
function picks(sorted: Ranked[], perBucket: number): Picks {
  const reserve = sorted.find((r) => r.offer.liquidity === 'daily')
  const buckets: Bucket[] = BUCKETS.map((bucket) => ({ id: bucket.id, label: bucket.label, picks: [] as Ranked[] }))
  for (const r of sorted) {
    // Daily-liquidity offers are compared as a reserve, not by how far off their maturity is
    if (r.offer.liquidity === 'daily') continue
    const i = BUCKETS.findIndex((bucket) => r.sim.days <= bucket.maxDays)
    if (buckets[i].picks.length < perBucket) buckets[i].picks.push(r)
  }
  const best = buckets.flatMap((bucket) => bucket.picks.slice(0, 1)).sort(byNet)[0]
  return { reserve, best, buckets }
}

/** One line per pick, for the email and for the model writing the summary */
export function describe(r: Ranked): string {
  return (
    `${r.offer.name} (${rateLabel(r.offer)}, until ${r.sim.until}, invest through ${r.offer.platform}): ` +
    `${pct(r.sim.netAnnual)} a year net, ${brl(r.sim.net)} at the end`
  )
}
