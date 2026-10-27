// A short summary at the top of the email, written by the model from facts computed in code. A
// model that writes about money tends to round, recompute or invent figures, so any summary with a
// number that is not in the facts is thrown away and a plain template is used instead.

import { generateText } from 'ai'
import { getModel } from './model'
import { describe, type Ranking } from './rank'
import type { Benchmarks } from './benchmarks'

export interface SummaryFacts {
  amount: string
  cdi: string
  ipca12m: string
  bestCdb?: string
  cdbReserve?: string
  bestCdbByTerm: string[]
  reserve?: string
  best?: string
  bestByTerm: string[]
  breakEvens: string[]
  changes: string[]
}

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })

export function summaryFacts(ranking: Ranking, b: Benchmarks, changes: string[]): SummaryFacts {
  return {
    amount: brl(ranking.amount),
    cdi: `${b.cdi.toFixed(2)}% a year`,
    ipca12m: `${b.ipca12m.toFixed(2)}% over the last 12 months`,
    bestCdb: ranking.cdbs.best && describe(ranking.cdbs.best),
    cdbReserve: ranking.cdbs.reserve && describe(ranking.cdbs.reserve),
    bestCdbByTerm: ranking.cdbs.buckets.filter((k) => k.picks.length).map((k) => `${k.label}: ${describe(k.picks[0])}`),
    reserve: ranking.reserve && describe(ranking.reserve),
    best: ranking.best && describe(ranking.best),
    bestByTerm: ranking.buckets.filter((k) => k.picks.length).map((k) => `${k.label}: ${describe(k.picks[0])}`),
    breakEvens: ranking.breakEvens.map(
      (e) =>
        `${e.prefixado} beats ${e.ipca} if inflation averages under ${e.breakEven.toFixed(2)}% a year; ` +
        `the Focus survey expects ${e.expected.toFixed(2)}%`,
    ),
    changes,
  }
}

/**
 * Numbers as written, e.g. "12.53", "R$ 12.939", "2029". A comma and a dot count as the same
 * separator, since the model may write a figure the Brazilian way ("13,13%").
 */
function numbers(text: string): string[] {
  return (text.match(/\d[\d.,]*/g) ?? []).map((n) => n.replace(/[.,]$/, '').replace(/,/g, '.'))
}

/** Every number in the summary must appear in the facts exactly as written there */
export function numbersCheck(summary: string, facts: SummaryFacts): { ok: boolean; unknown: string[] } {
  const known = new Set(numbers(JSON.stringify(facts)))
  // Small counts like "three options" or "1 year" are fine
  const unknown = numbers(summary).filter((n) => !known.has(n) && !/^\d$/.test(n))
  return { ok: unknown.length === 0, unknown }
}

export function templateSummary(facts: SummaryFacts): string {
  const lines = [`CDI is at ${facts.cdi} and inflation was ${facts.ipca12m}.`]
  if (facts.bestCdb) lines.push(`Best CDB for ${facts.amount}: ${facts.bestCdb}.`)
  if (facts.best && facts.best !== facts.bestCdb) lines.push(`Best of everything: ${facts.best}.`)
  if (facts.reserve) lines.push(`For money you may need any day: ${facts.reserve}.`)
  if (facts.changes.length) lines.push(`Since the last report: ${facts.changes.join('; ')}.`)
  return lines.join(' ')
}

const SUMMARY_SYSTEM =
  'You write the opening paragraph of a daily email about Brazilian fixed income for one investor. ' +
  'The investor mostly buys CDBs. You get facts computed from live data. In 3 to 5 plain sentences, ' +
  'start with the best CDB and which term pays best for CDBs now, then say whether Tesouro, an LCI or ' +
  'an LCA beats it, where to put money that may be needed any day, which app or broker to invest ' +
  'through, and what changed since the last report if anything did. Copy every number exactly as it appears in the facts; never round, convert or ' +
  'compute a new number. Do not use hype, and do not promise returns. English, plain text only: no markdown, no heading.'

export async function writeSummary(facts: SummaryFacts): Promise<{ text: string; byModel: boolean; note?: string }> {
  try {
    // Plain text: the small model often breaks a JSON wrapper, and there is only one field
    const { text } = await generateText({
      model: getModel(),
      system: SUMMARY_SYSTEM,
      prompt: JSON.stringify(facts),
      timeout: { totalMs: 60_000 },
      // The search may have just used most of this model's minute on the same model
      maxRetries: 3,
    })
    const summary = text.trim()
    if (!summary) return { text: templateSummary(facts), byModel: false, note: 'the model returned no text' }
    const check = numbersCheck(summary, facts)
    if (check.ok) return { text: summary, byModel: true }
    return { text: templateSummary(facts), byModel: false, note: `model used numbers not in the facts: ${check.unknown.join(', ')}` }
  } catch (error) {
    return { text: templateSummary(facts), byModel: false, note: error instanceof Error ? error.message : String(error) }
  }
}
