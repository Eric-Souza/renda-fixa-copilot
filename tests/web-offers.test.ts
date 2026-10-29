import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { checkOffer, cleanPageText, type ExtractedOffer, parseAnswer, parseGroqSearch, type WebPage } from '../src/sources/web-offers'
import { TODAY } from './helpers'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

describe('parseGroqSearch', () => {
  it('reads structured search results and merges repeats of a page', () => {
    const search = parseGroqSearch({
      choices: [
        {
          finish_reason: 'length',
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
    expect(search.finishReason).toBe('length')
    expect(search.pages).toHaveLength(1)
    expect(search.pages[0].content).toContain('110% do CDI')
    expect(search.pages[0].content).toContain('95% do CDI')
  })

  it('reads a real browser_search response, without line numbers', () => {
    const search = parseGroqSearch(fixture('groq-browser-search.json'))
    const meelion = search.pages.find((p) => p.url.includes('meelion.com'))!
    expect(meelion.title).toBe('Melhores Investimentos em CDB Hoje 27/10/2026')
    expect(meelion.content).toContain('CDB DM FINANCEIRA S.A. 122,00% CDI')
    expect(meelion.content).not.toMatch(/^L\d+:/m)
    expect(new Set(search.pages.map((p) => p.url)).size).toBe(search.pages.length)
  })

  it('checks a quote against a real page, across wrapped lines', () => {
    const search = parseGroqSearch(fixture('groq-browser-search.json'))
    const infomoney = search.pages.find((p) => p.url.includes('infomoney'))!
    const r = checkOffer(
      {
        product: 'CDB',
        issuer: 'Fibra',
        indexer: 'IPCA+',
        rate: 8.15,
        maturity: '2031-10',
        liquidity: 'maturity',
        platform: 'XP',
        sourceUrl: infomoney.url,
        quote: 'CDB FIBRA Taxa: IPC-A + 8,150%',
      },
      search.pages,
      TODAY,
    )
    expect(r.ok && r.offer.maturity).toBe('2031-10-01')
  })

  it('skips tool steps with null fields', () => {
    const search = parseGroqSearch({
      choices: [
        {
          message: {
            content: null,
            executed_tools: [
              { search_results: null },
              { search_results: { results: null } },
              { search_results: { results: [{ title: null, url: null }, { url: 'https://a.com', content: null }] } },
            ],
          },
        },
      ],
    })
    expect(search.pages).toEqual([{ url: 'https://a.com', title: 'https://a.com', content: '' }])
  })

  it('handles a response with no tools', () => {
    expect(parseGroqSearch({ choices: [{ message: { content: 'x' } }] }).pages).toEqual([])
  })

  it('rejects an unexpected response', () => {
    expect(() => parseGroqSearch({ error: 'x' })).toThrow(/Web search/)
  })
})

describe('cleanPageText', () => {
  it('drops line numbers and citation marks', () => {
    expect(cleanPageText('L1: CDB 120% CDI【2†L25-L42】\nL2: Vencimento')).toBe('CDB 120% CDI\nVencimento')
  })
})

describe('parseAnswer', () => {
  const offer = { product: 'CDB', issuer: 'X', indexer: 'CDI', rate: 110, sourceUrl: 'https://x.com', quote: '110% do CDI' }

  it('reads a JSON list, also inside a code fence, and counts items it cannot use', () => {
    const answer = '```json\n' + JSON.stringify([offer, { ...offer, indexer: 'POUPANCA' }]) + '\n```'
    const { offers, invalid } = parseAnswer(answer)
    expect(offers).toHaveLength(1)
    expect(offers[0].liquidity).toBe('maturity')
    expect(invalid).toBe(1)
  })

  it('keeps the complete offers of an answer cut off mid-list', () => {
    const whole = JSON.stringify([offer, { ...offer, issuer: 'Y' }, { ...offer, issuer: 'Z' }])
    const { offers } = parseAnswer(whole.slice(0, whole.lastIndexOf('"Z"') + 5))
    expect(offers.map((o) => o.issuer)).toEqual(['X', 'Y'])
    expect(() => parseAnswer('[{"product":"CDB","iss')).toThrow(/not valid JSON/)
  })

  it('fails when there is no list', () => {
    expect(() => parseAnswer('Não encontrei ofertas.')).toThrow(/no list of offers/)
    expect(() => parseAnswer('[{oops}]')).toThrow(/not valid JSON/)
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

describe('rate matching', () => {
  const page: WebPage[] = [{ url: 'https://x.com', title: 'x', content: 'CDB A 120% CDI. CDB B 122,00% CDI. CDB C IPCA + 8,150%. CDB D 12,5% a.a.' }]
  const base: ExtractedOffer = { product: 'CDB', issuer: 'A', indexer: 'CDI', rate: 120, termMonths: 24, liquidity: 'maturity', sourceUrl: 'https://x.com', quote: '' }
  const ok = (rate: number, quote: string, indexer: ExtractedOffer['indexer'] = 'CDI') =>
    checkOffer({ ...base, rate, quote, indexer }, page, TODAY).ok

  it('accepts padded decimals and rejects a different number', () => {
    expect(ok(120, 'CDB A 120% CDI')).toBe(true)
    expect(ok(122, 'CDB B 122,00% CDI')).toBe(true)
    expect(ok(8.15, 'CDB C IPCA + 8,150%', 'IPCA+')).toBe(true)
    expect(ok(12, 'CDB D 12,5% a.a.', 'PRE')).toBe(false)
    expect(ok(12.5, 'CDB D 12,5% a.a.', 'PRE')).toBe(true)
  })
})
