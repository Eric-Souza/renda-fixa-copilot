// The daily email, as HTML with inline styles (email clients drop stylesheets) and as plain text.

import type { Benchmarks } from '../lib/benchmarks'
import { FGC_LIMIT } from '../lib/fgc'
import { rateLabel } from '../lib/offer'
import type { Ranked, Ranking } from '../lib/rank'

const TAX_NOTE =
  'Income tax on CDB and Tesouro gains: 22.5% up to 180 days, 20% up to 360, 17.5% up to 720, 15% after. LCI and LCA are exempt. ' +
  'Net values are after tax and fees.'

export interface Report {
  /** YYYY-MM-DD */
  date: string
  benchmarks: Benchmarks
  ranking: Ranking
  summary: { text: string; byModel: boolean; note?: string }
  changes: string[]
  web: { found: number; rejected: { name: string; reason: string }[]; pagesSearched: number; error?: string }
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
const pct = (n: number) => `${n.toFixed(2)}%`
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}`
/** "2029-01-01" to "01/01/2029" */
const br = (iso: string) => iso.split('-').reverse().join('/')

function term(days: number): string {
  if (days < 365) return `${Math.round(days / 30)} months`
  const years = days / 365
  return `${years.toFixed(years < 10 ? 1 : 0)} years`
}

export function subject(r: Report): string {
  // CDBs lead the email; the overall best stands in on days the search found none
  const best = r.ranking.cdbs.best ?? r.ranking.best
  const day = br(r.date).slice(0, 5)
  if (!best) return `Renda fixa ${day}: CDI ${pct(r.benchmarks.cdi)}`
  return `Renda fixa ${day}: ${best.offer.name} at ${pct(best.sim.netAnnual)} a year net`
}

// Colors
const INK = '#1a1a1a'
const MUTED = '#5f6368'
const LINE = '#e3e3e3'
const GOOD = '#137333'
const BAD = '#b3261e'
const WARN = '#8a5a00'

const cell = `padding:8px 10px;vertical-align:top;`
const head = `${cell}border-bottom:1px solid ${LINE};text-align:left;font-weight:600;color:${MUTED};font-size:12px;`
const num = `${cell}text-align:right;white-space:nowrap;`

const nameCell = (x: Ranked) => `<a href="${esc(x.offer.source.url)}" style="color:${INK};font-weight:600;">${esc(x.offer.name)}</a>`

/** Why it was picked and what to watch, on a full-width row under the numbers */
function notesRow(x: Ranked): string {
  const why = x.reasons.map(esc).join(' · ')
  const warn = x.warnings.map((s) => `<div style="color:${WARN};">${esc(s)}</div>`).join('')
  return `<tr><td colspan="7" style="${cell}padding-top:0;border-bottom:1px solid ${LINE};color:${MUTED};font-size:12px;">${why}${warn}</td></tr>`
}

function rows(picks: Ranked[]): string {
  return picks
    .map((x) => {
      const vs = x.sim.vsCdi
      return (
        `<tr><td style="${cell}">${nameCell(x)}</td>` +
        `<td style="${cell}font-size:13px;">${esc(x.offer.platform)}</td>` +
        `<td style="${num}">${esc(rateLabel(x.offer))}</td>` +
        `<td style="${num}">${br(x.sim.until)}<div style="color:${MUTED};font-size:12px;">${term(x.sim.days)}</div></td>` +
        `<td style="${num}">${brl(x.sim.net)}<div style="color:${GOOD};font-size:12px;">+${brl(x.sim.netProfit)}</div></td>` +
        `<td style="${num}"><b>${pct(x.sim.netAnnual)}</b><div style="color:${vs >= 0 ? GOOD : BAD};font-size:12px;">${signed(vs)} vs CDI</div></td>` +
        `<td style="${cell}font-size:12px;">${x.guarantee.kind === 'fgc' ? 'FGC' : x.guarantee.kind === 'government' ? 'Government' : 'None'}</td></tr>` +
        notesRow(x)
      )
    })
    .join('')
}

function table(picks: Ranked[]): string {
  return (
    `<table cellspacing="0" cellpadding="0" style="width:100%;border-collapse:collapse;font-size:14px;">` +
    `<tr><th style="${head}">Investment</th><th style="${head}">Where to invest</th>` +
    `<th style="${head}text-align:right;">Rate</th>` +
    `<th style="${head}text-align:right;">Until</th><th style="${head}text-align:right;">Net value</th>` +
    `<th style="${head}text-align:right;">Net a year</th><th style="${head}">Guarantee</th></tr>` +
    rows(picks) +
    `</table>`
  )
}

const h2 = (s: string) => `<h2 style="font-size:18px;margin:32px 0 4px;color:${INK};">${esc(s)}</h2>`
const h3 = (s: string) => `<h3 style="font-size:15px;margin:20px 0 8px;color:${INK};">${esc(s)}</h3>`
const p = (s: string, style = '') => `<p style="margin:6px 0;line-height:1.5;${style}">${s}</p>`

function focusLine(b: Benchmarks): string {
  return Object.entries(b.focus.selic)
    .map(([year, selic]) => `${year}: ${pct(selic)}`)
    .join(', ')
}

export function renderHtml(r: Report): string {
  const { ranking: k, benchmarks: b } = r
  const parts: string[] = []
  parts.push(`<h1 style="font-size:20px;margin:0 0 4px;">Renda fixa, ${br(r.date)}</h1>`)
  parts.push(p(`Simulating ${brl(k.amount)}. CDI ${pct(b.cdi)} a year, IPCA ${pct(b.ipca12m)} over 12 months.`, `color:${MUTED};`))
  parts.push(p(esc(r.summary.text), 'font-size:15px;'))

  parts.push(h2('Best CDBs'))
  const cdbCount = k.all.filter((x) => x.offer.product === 'CDB').length
  if (!k.cdbs.reserve && !k.cdbs.buckets.some((bucket) => bucket.picks.length)) {
    parts.push(p(r.web.error ? 'No CDBs today: the web search failed (see below).' : 'The search found no CDBs today.', `color:${WARN};`))
  } else {
    parts.push(
      p(
        `${cdbCount} CDBs found today, ranked by net return after income tax. ` +
          `Each is covered by the FGC up to ${brl(FGC_LIMIT)} per CPF per institution.`,
        `color:${MUTED};font-size:13px;`,
      ),
    )
  }
  if (k.cdbs.reserve) {
    parts.push(h3('CDB you can withdraw any day'))
    parts.push(table([k.cdbs.reserve]))
  }
  for (const bucket of k.cdbs.buckets) {
    if (!bucket.picks.length) continue
    parts.push(h3(`CDBs for ${bucket.label.toLowerCase()}`))
    parts.push(table(bucket.picks))
  }

  parts.push(h2('Compared with Tesouro, LCI and LCA'))
  parts.push(p('The best of everything, CDBs included, for the same amount and terms.', `color:${MUTED};font-size:13px;`))
  if (k.reserve) {
    parts.push(h3('Money you may need any day'))
    parts.push(p(`Compared over 1 year; you can withdraw any business day.`, `color:${MUTED};font-size:13px;`))
    parts.push(table([k.reserve]))
  }

  for (const bucket of k.buckets) {
    if (!bucket.picks.length) continue
    parts.push(h3(`Best for ${bucket.label.toLowerCase()}`))
    parts.push(table(bucket.picks))
  }

  if (k.breakEvens.length) {
    parts.push(h3('Fixed rate or inflation-linked?'))
    const items = k.breakEvens.map((e) => {
      const verdict = e.breakEven > e.expected ? 'the fixed rate pays more if the forecast holds' : 'the IPCA+ bond pays more if the forecast holds'
      return `<li>${esc(e.prefixado)} vs ${esc(e.ipca)}: same return at ${pct(e.breakEven)} inflation a year; the Focus survey expects ${pct(e.expected)}, so ${verdict}.</li>`
    })
    parts.push(`<ul style="margin:0 0 0 18px;padding:0;line-height:1.5;">${items.join('')}</ul>`)
  }

  if (r.changes.length) {
    parts.push(h2('Since the last report'))
    parts.push(`<ul style="margin:0 0 0 18px;padding:0;line-height:1.5;">${r.changes.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>`)
  }

  parts.push(h2('Bank offers from the web'))
  if (r.web.error) parts.push(p(`The web search failed today (${esc(r.web.error)}), so only Tesouro Direto is listed.`, `color:${WARN};`))
  else {
    parts.push(
      p(
        `${r.web.found} offers checked against ${r.web.pagesSearched} pages the search returned; ` +
          `${r.web.rejected.length} more were left out because the page did not back them up.`,
        `color:${MUTED};font-size:13px;`,
      ),
    )
    const web = k.all.filter((x) => x.offer.source.kind === 'web')
    if (web.length) {
      parts.push(table(web))
      const quotes = web
        .map((x) => `<li><b>${esc(x.offer.name)}</b>: "${esc(x.offer.source.quote ?? '')}" (<a href="${esc(x.offer.source.url)}">${esc(x.offer.source.title ?? 'source')}</a>)</li>`)
        .join('')
      parts.push(`<ul style="margin:8px 0 0 18px;padding:0;font-size:12px;color:${MUTED};">${quotes}</ul>`)
    }
  }

  parts.push(h2('How this is worked out'))
  parts.push(
    `<ul style="margin:0 0 0 18px;padding:0;font-size:12px;color:${MUTED};line-height:1.5;">` +
      `<li>Floating rates are projected with the Focus survey (${esc(br(b.focus.date))}). Selic at year end: ${esc(focusLine(b))}.</li>` +
      `<li>${esc(TAX_NOTE)}</li>` +
      `<li>Tesouro Direto: B3 custody of 0.20% a year is deducted (Tesouro Selic is free on the first R$ 10.000). Bonds other than Tesouro Selic are held to maturity.</li>` +
      `<li>FGC covers CDB, LCI, LCA, LC and RDB up to ${brl(FGC_LIMIT)} per CPF per institution, interest included, with R$ 1.000.000 every 4 years.</li>` +
      `<li>Web offers are read by a model from search results and kept only when the page text states the rate. Rates change during the day: confirm at the broker.</li>` +
      `<li>This is an automated comparison, not financial advice.${r.summary.byModel ? '' : ' The summary above is a template today.'}</li>` +
      `</ul>`,
  )

  return (
    `<!doctype html><html><body style="margin:0;padding:24px;background:#ffffff;">` +
    `<div style="max-width:760px;margin:0 auto;font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:${INK};font-size:14px;">` +
    parts.join('\n') +
    `</div></body></html>`
  )
}

function textRows(picks: Ranked[]): string[] {
  return picks.map(
    (x) =>
      `- ${x.offer.name} (${rateLabel(x.offer)}), until ${br(x.sim.until)}: ${brl(x.sim.net)} net (+${brl(x.sim.netProfit)}), ` +
      `${pct(x.sim.netAnnual)} a year, ${signed(x.sim.vsCdi)} vs CDI. Invest through: ${x.offer.platform}. ${x.guarantee.label}.` +
      (x.warnings.length ? ` Note: ${x.warnings.join('; ')}.` : ''),
  )
}

export function renderText(r: Report): string {
  const { ranking: k, benchmarks: b } = r
  const lines = [
    `Renda fixa, ${br(r.date)}`,
    `Simulating ${brl(k.amount)}. CDI ${pct(b.cdi)} a year, IPCA ${pct(b.ipca12m)} over 12 months.`,
    '',
    r.summary.text,
  ]
  lines.push('', 'BEST CDBS')
  if (k.cdbs.reserve) lines.push('', 'CDB you can withdraw any day (over 1 year):', ...textRows([k.cdbs.reserve]))
  for (const bucket of k.cdbs.buckets) {
    if (bucket.picks.length) lines.push('', `CDBs for ${bucket.label.toLowerCase()}:`, ...textRows(bucket.picks))
  }
  if (!k.cdbs.reserve && !k.cdbs.buckets.some((bucket) => bucket.picks.length)) lines.push('No CDBs found today.')
  lines.push('', 'COMPARED WITH TESOURO, LCI AND LCA')
  if (k.reserve) lines.push('', 'Money you may need any day (over 1 year):', ...textRows([k.reserve]))
  for (const bucket of k.buckets) {
    if (bucket.picks.length) lines.push('', `Best for ${bucket.label.toLowerCase()}:`, ...textRows(bucket.picks))
  }
  if (r.changes.length) lines.push('', 'Since the last report:', ...r.changes.map((c) => `- ${c}`))
  if (r.web.error) lines.push('', `The web search failed today (${r.web.error}).`)
  lines.push('', 'Automated comparison, not financial advice. Confirm rates at the broker before investing.')
  return lines.join('\n')
}
