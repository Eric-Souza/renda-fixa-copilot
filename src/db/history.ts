// Report history in Postgres (Neon in production). Optional: without DATABASE_URL the report still
// goes out, it just cannot say what changed since the day before.

import { desc, lt } from 'drizzle-orm'
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/node-postgres'
import { migrate } from 'drizzle-orm/node-postgres/migrator'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import type { Snapshot } from '../lib/changes'
import { reports } from './schema'

// node-postgres in production, PGlite in tests
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Db = PgDatabase<PgQueryResultHKT, any>

export async function connect(url: string): Promise<{ db: Db; close: () => Promise<void> }> {
  const pool = new pg.Pool({ connectionString: url, max: 1 })
  const db = drizzle(pool)
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../drizzle', import.meta.url)) })
  return { db, close: () => pool.end() }
}

/** The latest report from before this date */
export async function previousSnapshot(db: Db, date: string): Promise<Snapshot | undefined> {
  const [row] = await db.select().from(reports).where(lt(reports.date, date)).orderBy(desc(reports.date)).limit(1)
  return row?.snapshot
}

/** Saves today's report; running twice on a day keeps the later run */
export async function saveReport(db: Db, date: string, subject: string, snapshot: Snapshot): Promise<void> {
  await db
    .insert(reports)
    .values({ date, subject, snapshot })
    .onConflictDoUpdate({ target: reports.date, set: { subject, snapshot, createdAt: new Date() } })
}
