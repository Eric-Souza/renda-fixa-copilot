import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { breakEvens, rankOffers } from '../src/lib/rank'
import { parseTesouro } from '../src/sources/tesouro'
import { flat, offer, TODAY } from './helpers'

const tesouro = parseTesouro(JSON.parse(readFileSync(new URL('./fixtures/tesouro.json', import.meta.url), 'utf8')))

describe('rankOffers', () => {
  const offers = [
    ...tesouro,
    offer({ id: 'a', name: 'CDB A', rate: 120, maturity: '2027-06-01' }),
    offer({ id: 'b', name: 'LCA B', product: 'LCA', rate: 95, maturity: '2027-10-01' }),
    offer({ id: 'c', name: 'CDB C', rate: 102, liquidity: 'daily', maturity: '2030-01-01' }),
    offer({ id: 'd', name: 'CDB D', rate: 140, maturity: '2028-01-01', minimum: 50_000 }),
  ]
  const ranking = rankOffers(offers, 10_000, flat, TODAY)

  it('picks the best daily-liquidity offer as the reserve', () => {
    expect(ranking.reserve?.offer.name).toBe('CDB C')
  })

  it('sorts each term bucket by net return and leaves daily-liquidity offers out of them', () => {
    const short = ranking.buckets.find((b) => b.id === 'short')!
    expect(short.picks.map((p) => p.offer.name)).toEqual(['CDB A', 'LCA B'])
    const all = ranking.buckets.flatMap((b) => b.picks.map((p) => p.offer.name))
    expect(all).not.toContain('CDB C')
    expect(all).not.toContain('Tesouro Selic 2031')
  })

  it('leaves out offers whose minimum is above the amount, but keeps them listed', () => {
    expect(ranking.buckets.flatMap((b) => b.picks).map((p) => p.offer.name)).not.toContain('CDB D')
    expect(ranking.all.find((r) => r.offer.name === 'CDB D')?.warnings.join()).toMatch(/Minimum investment/)
  })

  it('picks CDBs on their own, without Tesouro or LCA', () => {
    const names = ranking.cdbs.buckets.flatMap((b) => b.picks.map((p) => p.offer.name))
    expect(names).toEqual(['CDB A'])
    expect(ranking.cdbs.reserve?.offer.name).toBe('CDB C')
    expect(ranking.cdbs.best?.offer.name).toBe('CDB A')
  })

  it('explains each pick and flags web offers', () => {
    const lca = ranking.all.find((r) => r.offer.name === 'LCA B')!
    expect(lca.reasons.join(' ')).toMatch(/Tax-exempt/)
    expect(lca.reasons.join(' ')).toMatch(/FGC/)
    expect(lca.warnings.join(' ')).toMatch(/confirm the rate/)
  })
})

describe('rankOffers with several amounts', () => {
  const long = offer({ id: 'l', name: 'CDB Long', rate: 120, maturity: '2031-10-27' })
  const ranking = rankOffers([long], [150_000, 75_000], flat, TODAY)
  const [r] = ranking.all

  it('simulates each amount, smallest first, and ranks by the smallest', () => {
    expect(ranking.amounts).toEqual([75_000, 150_000])
    expect(r.scenarios.map((s) => s.amount)).toEqual([75_000, 150_000])
    expect(r.sim.amount).toBe(75_000)
    expect(r.scenarios[1].netProfit).toBeCloseTo(r.scenarios[0].netProfit * 2, 0)
  })

  it('warns when the largest amount grows past the FGC limit', () => {
    expect(r.scenarios[1].net).toBeGreaterThan(250_000)
    expect(r.warnings.join()).toMatch(/Investing R\$\s150\.000: .* above the FGC limit/)
  })
})

describe('breakEvens', () => {
  it('pairs the Prefixado with the nearest IPCA+ bond', () => {
    const [e] = breakEvens(tesouro, flat, TODAY)
    expect(e.prefixado).toBe('Tesouro Prefixado 2029')
    expect(e.ipca).toBe('Tesouro IPCA+ 2032')
    expect(e.breakEven).toBeCloseTo((1.1479 / 1.0764 - 1) * 100, 6)
    expect(e.expected).toBeCloseTo(4, 1)
  })
})
