import { describe, expect, it } from 'vitest'
import { renderHtml, renderText, type Report, subject } from '../src/email/render'
import { rankOffers } from '../src/lib/rank'
import { flat, offer, TODAY } from './helpers'

function report(overrides: Partial<Report> = {}): Report {
  const offers = [
    offer({ id: 'a', name: 'CDB <A>', rate: 120, maturity: '2027-06-01', source: { kind: 'web', url: 'https://x.com/?a=1&b=2', quote: '120% do CDI' } }),
    offer({ id: 'c', name: 'CDB C', rate: 102, liquidity: 'daily', maturity: '2030-01-01' }),
  ]
  return {
    date: '2026-10-27',
    benchmarks: flat,
    ranking: rankOffers(offers, 10_000, flat, TODAY),
    summary: { text: 'Summary & more', byModel: true },
    changes: ['CDI went from 13.65% to 14.00% a year'],
    web: { found: 2, rejected: [{ name: 'CDB X 230', reason: 'outside' }], pagesSearched: 8 },
    ...overrides,
  }
}

describe('render', () => {
  it('names the best pick in the subject', () => {
    expect(subject(report())).toMatch(/^Renda fixa 27\/10: CDB <A> at \d+\.\d\d% a year net$/)
  })

  it('names the best CDB even when Tesouro pays more', () => {
    const tesouro = offer({ id: 't', product: 'TESOURO', name: 'Tesouro Prefixado 2029', indexer: 'PRE', rate: 20, maturity: '2029-01-01', source: { kind: 'tesouro', url: 'https://tesouro' } })
    const r = report()
    r.ranking = rankOffers([...r.ranking.all.map((x) => x.offer), tesouro], 10_000, flat, TODAY)
    expect(r.ranking.best?.offer.name).toBe('Tesouro Prefixado 2029')
    expect(subject(r)).toMatch(/: CDB <A> at/)
  })

  it('leads with the CDBs, then compares with everything else', () => {
    const html = renderHtml(report())
    expect(html.indexOf('Best CDBs')).toBeLessThan(html.indexOf('Compared with Tesouro, LCI and LCA'))
    expect(html).toContain('CDB you can withdraw any day')
    expect(html).toContain('CDBs for up to 1 year')
    expect(renderText(report())).toContain('CDBs for up to 1 year:')
  })

  it('says when there are no CDBs', () => {
    const r = report({ web: { found: 0, rejected: [], pagesSearched: 0, error: 'timed out' } })
    r.ranking = rankOffers([], 10_000, flat, TODAY)
    expect(renderHtml(r)).toContain('No CDBs today: the web search failed')
  })

  it('escapes text from the web', () => {
    const html = renderHtml(report())
    expect(html).toContain('CDB &lt;A&gt;')
    expect(html).toContain('https://x.com/?a=1&amp;b=2')
    expect(html).toContain('Summary &amp; more')
    expect(html).not.toContain('<A>')
  })

  it('includes the reserve, the changes, the source quotes and the disclaimer', () => {
    const html = renderHtml(report())
    expect(html).toContain('Money you may need any day')
    expect(html).toContain('CDI went from 13.65% to 14.00% a year')
    expect(html).toContain('"120% do CDI"')
    expect(html).toContain('1 more were left out')
    expect(html).toContain('not financial advice')
  })

  it('says when the web search failed', () => {
    const r = report({ web: { found: 0, rejected: [], pagesSearched: 0, error: 'GROQ_API_KEY was rejected' } })
    expect(renderHtml(r)).toContain('The web search failed today (GROQ_API_KEY was rejected)')
    expect(renderText(r)).toContain('The web search failed today')
  })

  it('has a plain-text version with the picks', () => {
    const text = renderText(report())
    expect(text).toContain('Best for up to 1 year:')
    expect(text).toContain('- CDB <A> (120% do CDI)')
    expect(text).toContain('Invest through: XP.')
    expect(renderHtml(report())).toMatch(/Invest through <b[^>]*>XP<\/b>/)
  })

  it('shows the profit for each amount', () => {
    const r = report()
    r.ranking = rankOffers(r.ranking.all.map((x) => x.offer), [150_000, 75_000, 100_000], flat, TODAY)
    const html = renderHtml(r)
    expect(html.indexOf('Profit on R$ 75k')).toBeLessThan(html.indexOf('Profit on R$ 100k'))
    expect(html).toContain('Profit on R$ 150k')
    expect(html).toMatch(/Simulating R\$\s75\.000, R\$\s100\.000, R\$\s150\.000/)
    expect(renderText(r)).toMatch(/Net profit: \+R\$\s[\d.]+ on R\$\s75\.000, \+R\$\s[\d.]+ on R\$\s100\.000/)
  })
})
