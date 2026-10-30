import { describe, expect, it } from 'vitest'
import { changes, type Snapshot } from '../src/lib/changes'
import { numbersCheck, type SummaryFacts, templateSummary } from '../src/lib/summary'

const facts: SummaryFacts = {
  amount: 'R$ 10.000',
  cdi: '13.65% a year',
  ipca12m: '4.58% over the last 12 months',
  bestCdb: 'CDB Banco XP (15,05% a.a., until 2031-10-01, invest through XP): 13.24% a year net, R$ 18.463 at the end',
  bestCdbByTerm: ['3 to 6 years: CDB Banco XP (15,05% a.a., until 2031-10-01, invest through XP): 13.24% a year net, R$ 18.463 at the end'],
  bestByTerm: ['1 to 3 years: Tesouro Prefixado 2029 (14,79% a.a., until 2029-01-01): 12.53% a year net, R$ 12.940 at the end'],
  breakEvens: [],
  changes: [],
}

describe('numbersCheck', () => {
  it('accepts a summary that only uses numbers from the facts', () => {
    const s = 'The best CDB is CDB Banco XP at 13.24% a year net. For 1 to 3 years, Tesouro Prefixado 2029 pays 12.53%, turning R$ 10.000 into R$ 12.940.'
    expect(numbersCheck(s, facts)).toEqual({ ok: true, unknown: [] })
  })

  it('rejects rounded or invented numbers', () => {
    const s = 'Tesouro Prefixado 2029 pays about 12.5% a year, or R$ 2.940 of profit.'
    expect(numbersCheck(s, facts).unknown).toEqual(['12.5', '2.940'])
  })

  it('accepts a decimal comma for a number in the facts', () => {
    expect(numbersCheck('Tesouro Prefixado 2029 pays 12,53% a year net.', facts).ok).toBe(true)
  })

  it('has a template that passes its own check', () => {
    expect(numbersCheck(templateSummary(facts), facts).ok).toBe(true)
  })
})

describe('changes', () => {
  const previous: Snapshot = {
    date: '2026-10-26',
    cdi: 13.65,
    offers: [
      { id: 'tesouro-1', name: 'Tesouro Prefixado 2029', indexer: 'PRE', rate: 14.6 },
      { id: 'tesouro-2', name: 'Tesouro IPCA+ 2032', indexer: 'IPCA+', rate: 7.63 },
      { id: 'web-old', name: 'CDB Old', indexer: 'CDI', rate: 115 },
    ],
  }
  const current: Snapshot = {
    date: '2026-10-27',
    cdi: 13.65,
    offers: [
      { id: 'tesouro-1', name: 'Tesouro Prefixado 2029', indexer: 'PRE', rate: 14.79 },
      { id: 'tesouro-2', name: 'Tesouro IPCA+ 2032', indexer: 'IPCA+', rate: 7.64 },
      { id: 'web-new', name: 'CDB New', indexer: 'CDI', rate: 120 },
    ],
  }

  it('reports rate moves, new offers and offers that went away', () => {
    expect(changes(previous, current)).toEqual([
      'Tesouro Prefixado 2029: 14,6% a.a. to 14,79% a.a.',
      'New offers found: CDB New 120% do CDI',
      'No longer found: CDB Old 115% do CDI',
    ])
  })

  it('says nothing without a previous report', () => {
    expect(changes(undefined, current)).toEqual([])
  })
})
