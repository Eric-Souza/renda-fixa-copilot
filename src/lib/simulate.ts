// What an amount turns into at maturity, after income tax and fees. Computed in code so every
// offer is compared the same way; the model never does the math.

import { type Benchmarks, cdiForYear, ipcaForYear, pctOfCdiAnnual } from './benchmarks'
import type { Offer, Product } from './offer'

const DAY = 86_400_000

/** Regressive income tax on fixed income gains (Lei 11.033/2004), by days held */
export function incomeTaxRate(days: number): number {
  if (days <= 180) return 0.225
  if (days <= 360) return 0.2
  if (days <= 720) return 0.175
  return 0.15
}

/** LCI and LCA are tax-exempt for individuals */
export const TAX_EXEMPT: readonly Product[] = ['LCI', 'LCA']

/** B3's custody fee on Tesouro Direto, a year, on the invested balance */
export const TESOURO_CUSTODY = 0.002
/** Tesouro Selic pays no custody fee on the first R$10,000 */
export const TESOURO_SELIC_CUSTODY_FREE = 10_000

/** Expected annual rate in a calendar year, percent */
export function annualRate(offer: Pick<Offer, 'indexer' | 'rate'>, b: Benchmarks, year: number): number {
  const cdi = cdiForYear(b, year)
  const compound = (base: number) => ((1 + base / 100) * (1 + offer.rate / 100) - 1) * 100
  switch (offer.indexer) {
    case 'CDI':
      return pctOfCdiAnnual(cdi, offer.rate)
    case 'CDI+':
      return compound(cdi)
    case 'PRE':
      return offer.rate
    case 'IPCA+':
      return compound(ipcaForYear(b, year))
    case 'SELIC+':
      return compound(cdi + 0.1)
  }
}

/** Growth factor from start to end, year by year as the projected rates change */
export function grossFactor(offer: Pick<Offer, 'indexer' | 'rate'>, b: Benchmarks, start: Date, end: Date): number {
  let factor = 1
  let from = start.getTime()
  const to = end.getTime()
  while (from < to) {
    const year = new Date(from).getUTCFullYear()
    const yearEnd = Math.min(Date.UTC(year + 1, 0, 1), to)
    const yearDays = (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY
    factor *= Math.pow(1 + annualRate(offer, b, year) / 100, (yearEnd - from) / DAY / yearDays)
    from = yearEnd
  }
  return factor
}

export interface Simulation {
  amount: number
  /** YYYY-MM-DD the money is taken out: maturity, or the horizon for a daily-liquidity offer */
  until: string
  days: number
  years: number
  gross: number
  fees: number
  incomeTax: number
  net: number
  netProfit: number
  /** Net return, percent a year */
  netAnnual: number
  /** Gross return, percent a year */
  grossAnnual: number
  /** For a tax-exempt offer, the taxed rate that would pay the same net, percent a year */
  taxedEquivalent?: number
  /** Net percent a year minus a CDB at 100% of CDI over the same period, in points */
  vsCdi: number
}

export function simulate(
  offer: Offer,
  amount: number,
  b: Benchmarks,
  today: Date,
  { horizonDays }: { horizonDays?: number } = {},
): Simulation {
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()))
  let end = new Date(`${offer.maturity}T00:00:00Z`)
  if (horizonDays && offer.liquidity === 'daily') end = new Date(Math.min(end.getTime(), start.getTime() + horizonDays * DAY))
  const days = Math.round((end.getTime() - start.getTime()) / DAY)
  const years = days / 365

  const factor = grossFactor(offer, b, start, end)
  const gross = amount * factor
  let fees = 0
  if (offer.product === 'TESOURO') {
    // Charged on the balance as it grows. A balance growing by `factor` averages
    // amount * (factor - 1) / ln(factor) over the period, well under the midpoint on long bonds.
    const average = factor > 1 ? (amount * (factor - 1)) / Math.log(factor) : amount
    const free = offer.indexer === 'SELIC+' ? TESOURO_SELIC_CUSTODY_FREE : 0
    fees = TESOURO_CUSTODY * years * Math.max(0, average - free)
  }
  const exempt = TAX_EXEMPT.includes(offer.product)
  const taxRate = exempt ? 0 : incomeTaxRate(days)
  // Fees are deducted before the tax is worked out
  const incomeTax = Math.max(0, gross - fees - amount) * taxRate
  const net = gross - fees - incomeTax

  const perYear = (factor: number) => (Math.pow(factor, 1 / years) - 1) * 100
  const netAnnual = perYear(net / amount)
  const cdiNet = 1 + (grossFactor({ indexer: 'CDI', rate: 100 }, b, start, end) - 1) * (1 - incomeTaxRate(days))

  let taxedEquivalent: number | undefined
  if (exempt) {
    // The gross rate whose gain, taxed at this term's rate, equals the exempt gain
    const t = incomeTaxRate(days)
    taxedEquivalent = perYear(1 + (net / amount - 1) / (1 - t))
  }

  return {
    amount,
    until: end.toISOString().slice(0, 10),
    days,
    years,
    gross,
    fees,
    incomeTax,
    net,
    netProfit: net - amount,
    netAnnual,
    grossAnnual: perYear(gross / amount),
    taxedEquivalent,
    vsCdi: netAnnual - perYear(cdiNet),
  }
}
