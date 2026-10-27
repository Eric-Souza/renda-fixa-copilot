import { describe, expect, it } from 'vitest'
import { checkOffer, type ExtractedOffer, parseGroqSearch, type WebPage } from '../src/sources/web-offers'
import { TODAY } from './helpers'

describe('parseGroqSearch', () => {
  it('reads structured search results and merges repeats of a page', () => {
    const search = parseGroqSearch({
      choices: [
        {
          message: {
            content: 'Found some offers',
            executed_tools: [
              { search_results: { results: [{ title: 'A', url: 'https://a.com/x', content: 'CDB 110% do CDI' }] } },
              { search_results: { results: [{ title: 'A', url: 'https://a.com/x/', content: 'LCA 95% do CDI' }] } },
            ],
          },
        },
      ],
    })
    expect(search.answer).toBe('Found some offers')
    expect(search.pages).toHaveLength(1)
    expect(search.pages[0].content).toContain('110% do CDI')
    expect(search.pages[0].content).toContain('95% do CDI')
  })

  it('falls back to the text output when results are not structured', () => {
    const search = parseGroqSearch({
      choices: [
        {
          message: {
            content: '',
            executed_tools: [
              {
                output:
                  'Title: Melhores CDBs\nURL: https://b.com/cdb\nContent: CDB Banco Pine paga 120% do CDI por 2 anos\nScore: 0.9\n' +
                  'Title: Outro\nURL: https://c.com\nContent: LCI 92% do CDI\n',
              },
            ],
          },
        },
      ],
    })
    expect(search.pages.map((p) => p.url)).toEqual(['https://b.com/cdb', 'https://c.com'])
    expect(search.pages[0].content).toBe('CDB Banco Pine paga 120% do CDI por 2 anos')
  })

  it('handles a response with no tools', () => {
    expect(parseGroqSearch({ choices: [{ message: { content: 'x' } }] }).pages).toEqual([])
  })

  it('rejects an unexpected response', () => {
    expect(() => parseGroqSearch({ error: 'x' })).toThrow(/Web search/)
  })
})

describe('checkOffer', () => {
  const pages: WebPage[] = [
    {
      url: 'https://blog.example.com/melhores-cdbs',
      title: 'Melhores CDBs de outubro',
      content: 'O CDB do Banco Pine paga 120% do CDI com vencimento em 2 anos.\nA LCA do BTG rende 94,5%  do CDI.',
    },
  ]
  const raw: ExtractedOffer = {
    product: 'CDB',
    issuer: 'Banco Pine',
    indexer: 'CDI',
    rate: 120,
    termMonths: 24,
    maturity: null,
    liquidity: 'maturity',
    minimum: 1000,
    platform: 'XP',
    sourceUrl: 'https://blog.example.com/melhores-cdbs/',
    quote: 'Banco Pine paga 120% do CDI',
  }

  it('keeps an offer the page backs up', () => {
    const r = checkOffer(raw, pages, TODAY)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.offer).toMatchObject({ product: 'CDB', rate: 120, maturity: '2028-10-27', minimum: 1000, platform: 'XP' })
    expect(r.offer.source).toMatchObject({ kind: 'web', url: pages[0].url })
    expect(r.offer.id).toBe('web-cdb-banco-pine-cdi-120-2028-10-xp')
  })

  it("falls back to the issuer's own app when the page does not say where", () => {
    const nubank = { ...raw, issuer: 'Nubank', platform: null }
    const r = checkOffer(nubank, pages, TODAY)
    expect(r.ok && r.offer.platform).toBe('Nubank app')
    const r2 = checkOffer({ ...raw, platform: null }, pages, TODAY)
    expect(r2.ok && r2.offer.platform).toBe('Not stated: see the source page')
  })

  it('matches a quote across whitespace and a decimal comma', () => {
    const lca = { ...raw, product: 'LCA' as const, issuer: 'BTG', rate: 94.5, quote: 'LCA do BTG rende 94,5% do CDI' }
    expect(checkOffer(lca, pages, TODAY).ok).toBe(true)
  })

  const rejected = (overrides: Partial<ExtractedOffer>) => {
    const r = checkOffer({ ...raw, ...overrides }, pages, TODAY)
    return r.ok ? undefined : r.reason
  }

  it('rejects a source the search did not return', () => {
    expect(rejected({ sourceUrl: 'https://other.com' })).toMatch(/not in the search results/)
  })

  it('rejects a quote that is not on the page', () => {
    expect(rejected({ quote: 'Banco Pine paga 130% do CDI' })).toMatch(/not on the source page/)
  })

  it('rejects a rate the quote does not state', () => {
    expect(rejected({ rate: 12 })).toMatch(/does not state the rate/)
  })

  it('rejects an implausible rate', () => {
    const page = [{ ...pages[0], content: 'CDB Pine 230% do CDI' }]
    const r = checkOffer({ ...raw, rate: 230, quote: 'CDB Pine 230% do CDI' }, page, TODAY)
    expect(r.ok ? undefined : r.reason).toMatch(/outside 80 to 150/)
  })

  it('rejects an offer with no term or one about to mature', () => {
    expect(rejected({ termMonths: null })).toMatch(/no term/)
    expect(rejected({ termMonths: null, maturity: '2026-11-01' })).toMatch(/under 30 days/)
  })
})
