import type { Benchmarks } from '../src/lib/benchmarks'
import type { Offer } from '../src/lib/offer'

export const TODAY = new Date('2026-10-27T00:00:00Z')

/** Flat rates, so expected values are easy to work out by hand */
export const flat: Benchmarks = {
  date: '2026-10-26',
  cdi: 14,
  ipca12m: 4,
  focus: { date: '2026-10-23', selic: { 2026: 14.1, 2027: 14.1, 2028: 14.1 }, ipca: { 2026: 4, 2027: 4, 2028: 4 } },
}

export function offer(overrides: Partial<Offer> = {}): Offer {
  return {
    id: 'web-cdb-test',
    product: 'CDB',
    name: 'CDB Test',
    issuer: 'Banco Test',
    indexer: 'CDI',
    rate: 100,
    maturity: '2028-10-27',
    liquidity: 'maturity',
    platform: 'XP',
    source: { kind: 'web', url: 'https://example.com/cdb', quote: '100% do CDI' },
    ...overrides,
  }
}
