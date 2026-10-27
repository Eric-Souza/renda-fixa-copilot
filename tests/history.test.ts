import { PGlite } from '@electric-sql/pglite'
import { drizzle } from 'drizzle-orm/pglite'
import { migrate } from 'drizzle-orm/pglite/migrator'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { type Db, previousSnapshot, saveReport } from '../src/db/history'
import type { Snapshot } from '../src/lib/changes'

let db: Db

beforeAll(async () => {
  const pg = drizzle(new PGlite())
  await migrate(pg, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) })
  db = pg as unknown as Db
})

const snap = (date: string, cdi: number): Snapshot => ({ date, cdi, offers: [{ id: 'x', name: 'X', indexer: 'CDI', rate: 100 }] })

describe('history', () => {
  it('returns the latest report before a date, and keeps one row per day', async () => {
    expect(await previousSnapshot(db, '2026-10-27')).toBeUndefined()
    await saveReport(db, '2026-10-23', 'a', snap('2026-10-23', 13.6))
    await saveReport(db, '2026-10-26', 'b', snap('2026-10-26', 13.65))
    await saveReport(db, '2026-10-26', 'b2', snap('2026-10-26', 13.7))
    await saveReport(db, '2026-10-27', 'c', snap('2026-10-27', 13.8))

    expect((await previousSnapshot(db, '2026-10-27'))?.cdi).toBe(13.7)
    expect((await previousSnapshot(db, '2026-10-26'))?.cdi).toBe(13.6)
  })
})
