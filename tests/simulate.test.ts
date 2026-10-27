import { describe, expect, it } from 'vitest'
import { cdiForYear, pctOfCdiAnnual } from '../src/lib/benchmarks'
import { guarantee } from '../src/lib/fgc'
import { rateLabel } from '../src/lib/offer'
import { incomeTaxRate, simulate } from '../src/lib/simulate'
import { flat, offer, TODAY } from './helpers'

describe('incomeTaxRate', () => {
  it('follows the regressive table', () => {
    expect(incomeTaxRate(1)).toBe(0.225)
    expect(incomeTaxRate(180)).toBe(0.225)
    expect(incomeTaxRate(181)).toBe(0.2)
    expect(incomeTaxRate(360)).toBe(0.2)
    expect(incomeTaxRate(361)).toBe(0.175)
    expect(incomeTaxRate(720)).toBe(0.175)
    expect(incomeTaxRate(721)).toBe(0.15)
  })
})

describe('pctOfCdiAnnual', () => {
  it('is CDI itself at 100%', () => {
    expect(pctOfCdiAnnual(13.65, 100)).toBeCloseTo(13.65, 10)
  })

  it('compounds the daily rate, so 110% of CDI is a bit more than 1.1 times CDI', () => {
    const r = pctOfCdiAnnual(14, 110)
    expect(r).toBeGreaterThan(14 * 1.1)
    expect(r).toBeCloseTo(15.48, 1)
  })
})

describe('cdiForYear', () => {
  const b = { ...flat, cdi: 14, focus: { ...flat.focus, selic: { 2026: 14, 2027: 12, 2028: 10 } } }

  it('uses current CDI for the current year', () => {
    expect(cdiForYear(b, 2026)).toBe(14)
  })

  it('averages the Selic at the start and end of a later year, less the CDI spread', () => {
    expect(cdiForYear(b, 2027)).toBeCloseTo((14.1 + 12) / 2 - 0.1)
    expect(cdiForYear(b, 2028)).toBeCloseTo((12 + 10) / 2 - 0.1)
  })

  it('holds the last forecast after the survey ends', () => {
    expect(cdiForYear(b, 2035)).toBeCloseTo(10 - 0.1)
  })
})

describe('simulate', () => {
  it('works out a 2-year CDB at 100% of CDI with 15% tax', () => {
    const s = simulate(offer(), 10_000, flat, TODAY)
    expect(s.days).toBe(731)
    // Flat 14% a year for just over 2 years
    const gross = 10_000 * Math.pow(1.14, 731 / 365)
    expect(s.gross).toBeCloseTo(gross, -1)
    expect(s.incomeTax).toBeCloseTo((s.gross - 10_000) * 0.15, 6)
    expect(s.net).toBeCloseTo(s.gross - s.incomeTax, 6)
    expect(s.vsCdi).toBeCloseTo(0, 6)
    expect(s.taxedEquivalent).toBeUndefined()
  })

  it('pays more than CDI at 110%', () => {
    expect(simulate(offer({ rate: 110 }), 10_000, flat, TODAY).vsCdi).toBeGreaterThan(1)
  })

  it('charges no tax on an LCI and gives its taxed equivalent', () => {
    const s = simulate(offer({ product: 'LCI', rate: 90 }), 10_000, flat, TODAY)
    expect(s.incomeTax).toBe(0)
    expect(s.net).toBeCloseTo(s.gross, 6)
    // 90% of CDI tax-free beats 100% of CDI taxed at 15% on 2 years
    expect(s.vsCdi).toBeGreaterThan(0)
    expect(s.taxedEquivalent!).toBeCloseTo(s.netAnnual / 0.85, 0)
    expect(s.taxedEquivalent!).toBeGreaterThan(s.netAnnual)
  })

  it('compares a daily-liquidity offer over the horizon, not to its maturity', () => {
    const s = simulate(offer({ liquidity: 'daily', maturity: '2031-01-01' }), 10_000, flat, TODAY, { horizonDays: 365 })
    expect(s.days).toBe(365)
    expect(s.until).toBe('2027-10-27')
    expect(s.incomeTax).toBeCloseTo((s.gross - 10_000) * 0.175, 6)
  })

  it('holds a maturity-only offer to maturity even with a horizon', () => {
    expect(simulate(offer(), 10_000, flat, TODAY, { horizonDays: 365 }).days).toBe(731)
  })

  it('takes Tesouro custody before tax, and none on the first R$10k of Tesouro Selic', () => {
    const pre = offer({ product: 'TESOURO', indexer: 'PRE', rate: 14 })
    const s = simulate(pre, 10_000, flat, TODAY)
    // 0.20% a year on an average balance between 10k and 13k, for 2 years
    expect(s.fees).toBeGreaterThan(0.002 * 2 * 10_000)
    expect(s.fees).toBeLessThan(0.002 * 2.01 * 13_000)
    expect(s.incomeTax).toBeCloseTo((s.gross - s.fees - 10_000) * 0.15, 6)

    const selic = offer({ product: 'TESOURO', indexer: 'SELIC+', rate: 0.1, liquidity: 'daily' })
    expect(simulate(selic, 5_000, flat, TODAY, { horizonDays: 365 }).fees).toBe(0)
    expect(simulate(selic, 50_000, flat, TODAY, { horizonDays: 365 }).fees).toBeGreaterThan(0)
  })

  it('keeps long-bond custody near 0.20% of the average balance', () => {
    const ipca = offer({ product: 'TESOURO', indexer: 'IPCA+', rate: 7, maturity: '2050-08-15' })
    const s = simulate(ipca, 10_000, flat, TODAY)
    expect(s.fees / s.gross).toBeLessThan(0.03)
  })
})

describe('guarantee', () => {
  it('names the FGC for bank products and warns above the limit', () => {
    expect(guarantee('CDB', 100_000)).toMatchObject({ kind: 'fgc', warning: undefined })
    expect(guarantee('LCA', 300_000).warning).toMatch(/above the FGC limit/)
    expect(guarantee('TESOURO', 1_000_000).kind).toBe('government')
    expect(guarantee('TESOURO', 1_000_000).warning).toBeUndefined()
  })
})

describe('rateLabel', () => {
  it('writes rates the way Brazilian brokers do', () => {
    expect(rateLabel({ indexer: 'CDI', rate: 110 })).toBe('110% do CDI')
    expect(rateLabel({ indexer: 'IPCA+', rate: 7.64 })).toBe('IPCA + 7,64%')
    expect(rateLabel({ indexer: 'PRE', rate: 14.79 })).toBe('14,79% a.a.')
    expect(rateLabel({ indexer: 'SELIC+', rate: 0 })).toBe('Selic')
  })
})
