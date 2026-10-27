// What moved since the last report: rates on the same bond, CDI, and offers that came or went.

import type { Benchmarks } from './benchmarks'
import { type Offer, rateLabel } from './offer'

/** What a report keeps about itself so the next one can compare */
export interface Snapshot {
  date: string
  cdi: number
  offers: Pick<Offer, 'id' | 'name' | 'indexer' | 'rate'>[]
}

export function snapshot(date: string, b: Benchmarks, offers: Offer[]): Snapshot {
  return { date, cdi: b.cdi, offers: offers.map(({ id, name, indexer, rate }) => ({ id, name, indexer, rate })) }
}

/** Rate moves under this are noise in Tesouro's twice-daily price updates */
const MIN_MOVE = 0.05

export function changes(previous: Snapshot | undefined, current: Snapshot): string[] {
  if (!previous) return []
  const lines: string[] = []
  if (Math.abs(current.cdi - previous.cdi) >= 0.01) {
    lines.push(`CDI went from ${previous.cdi.toFixed(2)}% to ${current.cdi.toFixed(2)}% a year`)
  }
  const before = new Map(previous.offers.map((o) => [o.id, o]))
  const moves: { line: string; size: number }[] = []
  for (const o of current.offers) {
    const p = before.get(o.id)
    if (!p || p.indexer !== o.indexer) continue
    const size = o.rate - p.rate
    if (Math.abs(size) < MIN_MOVE) continue
    moves.push({ line: `${o.name}: ${rateLabel(p)} to ${rateLabel(o)}`, size: Math.abs(size) })
  }
  // The biggest moves are the ones worth reading about
  lines.push(...moves.sort((a, b) => b.size - a.size).slice(0, 5).map((m) => m.line))

  const now = new Set(current.offers.map((o) => o.id))
  const web = (o: { id: string }) => o.id.startsWith('web-')
  const added = current.offers.filter((o) => web(o) && !before.has(o.id))
  const gone = previous.offers.filter((o) => web(o) && !now.has(o.id))
  if (added.length) lines.push(`New offers found: ${added.map((o) => `${o.name} ${rateLabel(o)}`).join(', ')}`)
  if (gone.length) lines.push(`No longer found: ${gone.map((o) => `${o.name} ${rateLabel(o)}`).join(', ')}`)
  return lines
}
