// The daily run: fetch rates, find bank offers, rank them, email the report and keep a snapshot.
//   npm run report               send the email
//   npm run report -- --dry-run  write out/report.html and out/report.txt instead, save nothing
//   --no-web                     skip the web search (Tesouro Direto only)

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { changes, snapshot } from './lib/changes'
import { rankOffers } from './lib/rank'
import { summaryFacts, writeSummary } from './lib/summary'
import type { Offer } from './lib/offer'
import { renderHtml, renderText, type Report, subject } from './email/render'
import { sendMail } from './email/send'
import { connect, previousSnapshot, saveReport } from './db/history'
import { fetchBenchmarks } from './sources/bcb'
import { fetchTesouro } from './sources/tesouro'
import { fetchWebOffers, type WebOffers } from './sources/web-offers'

if (existsSync('.env.local')) process.loadEnvFile('.env.local')

const args = new Set(process.argv.slice(2))
const dryRun = args.has('--dry-run')
const skipWeb = args.has('--no-web')

/** Today in Brazil, YYYY-MM-DD, whatever timezone the runner is in */
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date())
const today = new Date(`${date}T00:00:00Z`)
// Each offer is simulated for every amount, e.g. INVEST_AMOUNTS=75000,100000,150000
const amounts = (process.env.INVEST_AMOUNTS || process.env.INVEST_AMOUNT || '75000,100000,150000').split(',').map(Number)
if (!amounts.every((n) => Number.isFinite(n) && n > 0)) throw new Error('INVEST_AMOUNTS must be positive numbers of reais, separated by commas')

const [benchmarks, tesouro] = await Promise.all([fetchBenchmarks(), fetchTesouro()])
console.log(`CDI ${benchmarks.cdi}% (${benchmarks.date}), ${tesouro.length} Tesouro bonds`)

let web: WebOffers = { offers: [], rejected: [], pagesSearched: 0 }
let webError: string | undefined
if (skipWeb) webError = 'skipped with --no-web'
else {
  try {
    web = await fetchWebOffers(today)
    console.log(`Web (${web.model}): ${web.offers.length} offers kept, ${web.rejected.length} rejected, ${web.pagesSearched} pages`)
    for (const r of web.rejected) console.log(`  rejected ${r.name}: ${r.reason}`)
  } catch (error) {
    webError = error instanceof Error ? error.message : String(error)
    console.warn(`Web search failed: ${webError}`)
  }
}

const offers: Offer[] = [...tesouro, ...web.offers]
const ranking = rankOffers(offers, amounts, benchmarks, today)
const current = snapshot(date, benchmarks, offers)

const database = process.env.DATABASE_URL ? await connect(process.env.DATABASE_URL) : undefined
try {
  const previous = database && (await previousSnapshot(database.db, date))
  const changed = changes(previous, current)
  const summary = await writeSummary(summaryFacts(ranking, benchmarks, changed))
  if (summary.note) console.warn(`Summary fell back to the template: ${summary.note}`)

  const report: Report = {
    date,
    benchmarks,
    ranking,
    summary,
    changes: changed,
    web: { found: web.offers.length, rejected: web.rejected, pagesSearched: web.pagesSearched, error: webError },
  }
  const mail = { subject: subject(report), html: renderHtml(report), text: renderText(report) }

  if (dryRun) {
    mkdirSync('out', { recursive: true })
    writeFileSync('out/report.html', mail.html)
    writeFileSync('out/report.txt', `${mail.subject}\n\n${mail.text}`)
    console.log(`Dry run: wrote out/report.html ("${mail.subject}")`)
  } else {
    const id = await sendMail(mail)
    console.log(`Sent "${mail.subject}" (${id})`)
    if (database) await saveReport(database.db, date, mail.subject, current)
  }
} finally {
  await database?.close()
}
