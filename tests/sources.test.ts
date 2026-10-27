import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseFocus } from '../src/sources/bcb'
import { parseRate, parseTesouro } from '../src/sources/tesouro'

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'))

describe('parseRate', () => {
  it('reads Tesouro rate labels', () => {
    expect(parseRate('IPCA + 7,64%')).toEqual({ indexer: 'IPCA+', rate: 7.64 })
    expect(parseRate('14,79%')).toEqual({ indexer: 'PRE', rate: 14.79 })
    expect(parseRate('SELIC + 0,10%')).toEqual({ indexer: 'SELIC+', rate: 0.1 })
    expect(parseRate('SELIC')).toEqual({ indexer: 'SELIC+', rate: 0 })
    expect(parseRate('')).toBeUndefined()
  })
})

describe('parseTesouro', () => {
  const offers = parseTesouro(fixture('tesouro.json'))

  it('keeps plain bonds and leaves out Renda+, Educa+ and coupon bonds', () => {
    expect(offers.map((o) => o.name)).toEqual([
      'Tesouro Selic 2031',
      'Tesouro Prefixado 2029',
      'Tesouro IPCA+ 2032',
      'Tesouro IPCA+ 2040',
      'Tesouro IPCA+ 2050',
      'Tesouro Reserva 2036',
    ])
  })

  it('maps each bond to an offer', () => {
    expect(offers[1]).toMatchObject({
      product: 'TESOURO',
      indexer: 'PRE',
      rate: 14.79,
      maturity: '2029-01-01',
      liquidity: 'maturity',
      minimum: 7.42,
      platform: expect.stringContaining('Nubank'),
    })
    expect(offers[1].id).toMatch(/^tesouro-\d+$/)
    expect(offers[0]).toMatchObject({ indexer: 'SELIC+', rate: 0.1, liquidity: 'daily' })
  })

  it('rejects an unexpected response', () => {
    expect(() => parseTesouro({ foo: 1 })).toThrow(/Tesouro Direto/)
  })
})

describe('parseFocus', () => {
  it("takes the latest survey's medians by year", () => {
    const focus = parseFocus(fixture('focus.json'))
    expect(focus.date).toBe('2026-10-23')
    expect(focus.selic[2027]).toBe(11.75)
    expect(focus.ipca[2026]).toBeCloseTo(5.1891)
    expect(Object.keys(focus.selic).length).toBeGreaterThanOrEqual(4)
  })
})
