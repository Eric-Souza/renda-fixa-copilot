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
    offer({ id: 'e', name: 'CDB E', rate: 110, maturity: '2029-01-01' }),
    offer({ id: 'f', name: 'LCI F', product: 'LCI', rate: 100, liquidity: 'daily', maturity: '2029-01-01' }),
  ]
  const ranking = rankOffers(offers, 10_000, flat, TODAY)

  it('sorts each term bucket by net return, with LCI and LCA of any term', () => {
    const short = ranking.buckets.find((b) => b.id === 'short')!
    expect(short.picks.map((p) => p.offer.name)).toEqual(['LCA B'])
  })

  it('recommends nothing that can be withdrawn any day', () => {
    const picked = [...ranking.cdbs.buckets, ...ranking.buckets].flatMap((b) => b.picks.map((p) => p.offer.name))
    expect(picked).not.toContain('CDB C')
    expect(picked).not.toContain('LCI F')
    expect(picked).not.toContain('Tesouro Selic 2031')
    expect(ranking).not.toHaveProperty('reserve')
    expect(ranking.cdbs).not.toHaveProperty('reserve')
  })

  it('leaves out offers whose minimum is above the amount, but keeps them listed', () => {
    expect(ranking.buckets.flatMap((b) => b.picks).map((p) => p.offer.name)).not.toContain('CDB D')
    expect(ranking.all.find((r) => r.offer.name === 'CDB D')?.warnings.join()).toMatch(/Minimum investment/)
  })

  it('picks CDBs on their own, without Tesouro or LCA', () => {
    const names = ranking.cdbs.buckets.flatMap((b) => b.picks.map((p) => p.offer.name))
    expect(names).toEqual(['CDB E'])
    expect(ranking.cdbs.best?.offer.name).toBe('CDB E')
  })

  it('leaves out CDBs that run for under 2 years, even when they pay the most', () => {
    const picked = [...ranking.cdbs.buckets, ...ranking.buckets].flatMap((b) => b.picks.map((p) => p.offer.name))
    expect(picked).not.toContain('CDB A')
    expect(ranking.cdbs.buckets.map((b) => b.label)).toEqual(['2 to 3 years', '3 to 6 years', 'Over 6 years'])
    // Only E runs for 2 years or more and is held to maturity
    expect(ranking.cdbsConsidered).toBe(1)
  })

  it('explains each pick and flags web offers', () => {
    const lca = ranking.all.find((r) => r.offer.name === 'LCA B')!
    expect(lca.reasons.join(' ')).toMatch(/Tax-exempt/)
    expect(lca.reasons.join(' ')).toMatch(/FGC/)
    expect(lca.warnings.join(' ')).toMatch(/confirm the rate/)
  })
})

describe('CDB picks', () => {
  const postFixed = [125, 124, 123, 122, 121, 120].map((rate) =>
    offer({ id: `cdi-${rate}`, name: `CDB ${rate}% CDI`, rate, maturity: '2030-10-27' }),
  )
  const prefixed = offer({ id: 'pre', name: 'CDB Pre', indexer: 'PRE', rate: 14, maturity: '2030-10-27' })
  const ranking = rankOffers([...postFixed, prefixed], 10_000, flat, TODAY)

  it('keeps the best prefixed CDB in a term even when post-fixed ones pay more', () => {
    const [bucket] = ranking.cdbs.buckets.filter((b) => b.picks.length)
    const names = bucket.picks.map((p) => p.offer.name)
    expect(names).toHaveLength(5)
    expect(names).toContain('CDB Pre')
    expect(names[0]).toBe('CDB 125% CDI')
    // Still listed by net return
    const nets = bucket.picks.map((p) => p.sim.netAnnual)
    expect(nets).toEqual([...nets].sort((a, b) => b - a))
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

  it('works out the profit after 2 and 5 years, but not 7 on a 5-year CDB', () => {
    expect(r.holds.map((h) => h.years)).toEqual([2])
    const fiveYears = rankOffers([offer({ maturity: '2033-01-01' })], [75_000], flat, TODAY).all[0]
    expect(fiveYears.holds.map((h) => h.years)).toEqual([2, 5])
    const [two, five] = fiveYears.holds
    expect(two.scenarios[0].netProfit).toBeGreaterThan(0)
    expect(five.scenarios[0].netProfit).toBeGreaterThan(two.scenarios[0].netProfit)
    expect(fiveYears.scenarios[0].netProfit).toBeGreaterThan(five.scenarios[0].netProfit)
  })

  it('leaves out a term within a month of maturity, already shown at maturity', () => {
    expect(rankOffers([offer({ maturity: '2028-11-10' })], [75_000], flat, TODAY).all[0].holds).toEqual([])
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
