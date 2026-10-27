import { jsonb, pgTable, serial, text, timestamp } from 'drizzle-orm/pg-core'
import type { Snapshot } from '../lib/changes'

/** One row per report day, so the next report can say what changed */
export const reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  /** YYYY-MM-DD */
  date: text('date').notNull().unique(),
  subject: text('subject').notNull(),
  snapshot: jsonb('snapshot').$type<Snapshot>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
