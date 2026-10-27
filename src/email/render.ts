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

// Palette: one green for the brand and gains, quiet grays for structure, amber only for warnings
const BRAND = '#0b5d3b'
const BRAND_DARK = '#083d28'
const INK = '#1b1f1d'
const MUTED = '#5f6b66'
const SOFT = '#8a958f'
const LINE = '#e4e9e6'
const PAGE = '#f2f5f3'
const CARD = '#ffffff'
const GOOD = '#137333'
const BAD = '#b3261e'
const WARN = '#8a5a00'
const WARN_BG = '#fff6e0'

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`

/** "R$ 75.000" to "R$ 75k", to keep labels short */
const short = (n: number) => (n >= 1000 && n % 1000 === 0 ? `R$ ${n / 1000}k` : brl(n))

const pill = (text: string, fg: string, bg: string) =>
  `<span style="display:inline-block;padding:2px 8px;margin:0 4px 4px 0;border-radius:999px;background:${bg};color:${fg};font-size:11px;font-weight:600;white-space:nowrap;">${esc(text)}</span>`

const PRODUCT_COLORS: Partial<Record<string, [string, string]>> = {
  CDB: ['#0b5d3b', '#e3f4ea'],
  LCI: ['#0b5563', '#e0f3f6'],
  LCA: ['#0b5563', '#e0f3f6'],
  TESOURO: ['#1f4e9e', '#e6eefb'],
}

const INDEXER_LABELS: Record<string, string> = {
  CDI: 'Floating, % of CDI',
  'CDI+': 'CDI + spread',
  PRE: 'Fixed rate',
  'IPCA+': 'Inflation + rate',
  'SELIC+': 'Selic + spread',
}

function badges(x: Ranked): string {
  const [fg, bg] = PRODUCT_COLORS[x.offer.product] ?? ['#44504a', '#eef1ef']
  const guarantee =
    x.guarantee.kind === 'fgc'
      ? pill('FGC insured', GOOD, '#e6f4ea')
      : x.guarantee.kind === 'government'
        ? pill('Federal government', '#1f4e9e', '#e6eefb')
        : pill('No guarantee', BAD, '#fce8e6')
  return (
    pill(x.offer.product === 'TESOURO' ? 'Tesouro Direto' : x.offer.product, fg, bg) +
    pill(INDEXER_LABELS[x.offer.indexer] ?? x.offer.indexer, '#44504a', '#eef1ef') +
    (x.offer.liquidity === 'daily' ? pill('Withdraw any day', '#44504a', '#eef1ef') : '') +
    guarantee
  )
}

const warningBox = (w: string) =>
  `<div style="margin-top:6px;padding:6px 10px;border-radius:6px;background:${WARN_BG};color:${WARN};font-size:12px;">${esc(w)}</div>`

/**
 * A small label over a figure, used across the pick cards. Inline blocks wrap onto a new line on a
 * phone, in every client, where table cells would widen the whole email.
 */
const stat = (label: string, value: string, sub = '') =>
  `<div style="display:inline-block;vertical-align:top;margin:10px 20px 2px 0;">` +
  `<div style="font-size:11px;color:${SOFT};text-transform:uppercase;letter-spacing:.4px;white-space:nowrap;">${label}</div>` +
  `<div style="font-size:15px;font-weight:700;color:${INK};white-space:nowrap;margin-top:2px;">${value}</div>` +
  (sub ? `<div style="font-size:12px;color:${MUTED};white-space:nowrap;">${sub}</div>` : '') +
  `</div>`

/** A figure in a colored box: three to a row, or one per row on a phone */
const tile = (label: string, value: string, sub: string, [bg, labelColor, valueColor, subColor]: string[]) =>
  `<div class="tile" style="display:inline-block;vertical-align:top;box-sizing:border-box;width:31.5%;margin:0 1.5% 8px 0;padding:12px 14px;background:${bg};border-radius:10px;">` +
  `<div style="font-size:11px;color:${labelColor};text-transform:uppercase;letter-spacing:.4px;">${label}</div>` +
  `<div style="font-size:21px;font-weight:700;color:${valueColor};margin-top:2px;white-space:nowrap;">${value}</div>` +
  `<div style="font-size:12px;color:${subColor};">${sub}</div></div>`

/** Every web offer gets this warning; the card shows it as a quiet source line instead */
const WEB_WARNING = /^Found on the web/

function sourceLine(x: Ranked): string {
  if (x.offer.source.kind !== 'web') return ''
  return (
    `<div style="margin-top:6px;font-size:12px;color:${SOFT};">Found on ` +
    `<a href="${esc(x.offer.source.url)}" style="color:${BRAND};">${esc(x.offer.source.title ?? 'the web')}</a>: confirm the rate at the broker before investing</div>`
  )
}

const warningBoxes = (x: Ranked) =>
  x.warnings
    .filter((w) => !WEB_WARNING.test(w))
    .map(warningBox)
    .join('') + sourceLine(x)

/** One offer: name, badges, the numbers, then why it was picked and what to watch */
function pickCard(x: Ranked, rank?: number): string {
  const vs = x.sim.vsCdi
  const profits = x.scenarios
    .map((s) => stat(`Profit on ${short(s.amount)}`, `<span style="color:${GOOD};">+${brl(s.netProfit)}</span>`, `${brl(s.net)} at the end`))
    .join('')
  const first = rank === 1
  const number = rank
    ? `<td width="38" style="vertical-align:top;"><div style="width:28px;height:28px;line-height:28px;border-radius:14px;` +
      `background:${first ? BRAND : '#dfe7e2'};color:${first ? '#ffffff' : BRAND_DARK};text-align:center;font-weight:700;font-size:13px;">${rank}</div></td>`
    : ''
  return (
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid ${LINE};border-radius:10px;margin:0 0 10px;background:${CARD};">` +
    `<tr><td style="padding:14px 16px;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>${number}<td style="vertical-align:top;">` +
    `<a href="${esc(x.offer.source.url)}" style="color:${INK};font-weight:700;font-size:16px;text-decoration:none;">${esc(x.offer.name)}</a>` +
    `<div style="color:${MUTED};font-size:13px;margin:2px 0 8px;">Invest through <b style="color:${INK};">${esc(x.offer.platform)}</b></div>` +
    `<div>${badges(x)}</div>` +
    `</td></tr></table>` +
    `<div style="margin-top:6px;border-top:1px solid ${LINE};">` +
    stat('Rate', esc(rateLabel(x.offer))) +
    stat('Until', br(x.sim.until), term(x.sim.days)) +
    stat('Net a year', pct(x.sim.netAnnual), `<span style="color:${vs >= 0 ? GOOD : BAD};">${signed(vs)} vs CDI</span>`) +
    `<div>${profits}</div>` +
    `</div>` +
    `<div style="color:${MUTED};font-size:12px;line-height:1.5;margin-top:6px;">${x.reasons.map(esc).join(' · ')}</div>` +
    warningBoxes(x) +
    `</td></tr></table>`
  )
}

const cards = (picks: Ranked[], numbered = true) => picks.map((x, i) => pickCard(x, numbered ? i + 1 : undefined)).join('')

const p = (s: string, style = '') => `<p style="margin:6px 0;line-height:1.55;${style}">${s}</p>`
const h3 = (s: string) =>
  `<h3 style="font-size:13px;margin:22px 0 10px;color:${BRAND};text-transform:uppercase;letter-spacing:.6px;">${esc(s)}</h3>`
const bullets = (items: string[], style = '') =>
  `<ul style="margin:0 0 0 18px;padding:0;line-height:1.6;${style}">${items.map((i) => `<li style="margin-bottom:4px;">${i}</li>`).join('')}</ul>`

/** A white block on the page, with a heading and a line under it */
function section(title: string, body: string, intro = '', accent = false): string {
  return (
    `<tr><td style="padding:0 0 16px;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${CARD};border-radius:14px;${accent ? `border-top:4px solid ${BRAND};` : ''}">` +
    `<tr><td class="pad" style="padding:22px 24px;">` +
    `<h2 style="font-size:20px;margin:0 0 4px;color:${INK};">${esc(title)}</h2>` +
    (intro ? p(intro, `color:${MUTED};font-size:13px;margin-top:0;`) : '') +
    body +
    `</td></tr></table></td></tr>`
  )
}

function focusLine(b: Benchmarks): string {
  return Object.entries(b.focus.selic)
    .map(([year, selic]) => `${year}: ${pct(selic)}`)
    .join(', ')
}

/** CDI, inflation and where the Selic is expected to end the year */
function headerTiles(b: Benchmarks): string {
  const [year, selic] = Object.entries(b.focus.selic)[0] ?? []
  const colors = ['#0f5236', '#b9d8c7', '#ffffff', '#b9d8c7']
  return (
    `<div style="margin-top:18px;font-size:0;">` +
    tile('CDI', pct(b.cdi), 'a year', colors) +
    tile('IPCA', pct(b.ipca12m), 'last 12 months', colors) +
    (selic !== undefined ? tile('Selic forecast', pct(selic), `end of ${year}, Focus survey`, colors) : '') +
    `</div>`
  )
}

/** The best CDB of the day, with what each amount would earn */
function hero(x: Ranked): string {
  const colors = ['#f1f8f4', MUTED, GOOD, MUTED]
  const tiles = x.scenarios.map((s) => tile(`Invest ${short(s.amount)}`, `+${brl(s.netProfit)}`, `${brl(s.net)} at the end`, colors)).join('')
  const body =
    `<div style="font-size:24px;font-weight:800;color:${INK};margin:2px 0;">${esc(x.offer.name)} · ${esc(rateLabel(x.offer))}</div>` +
    `<div style="color:${MUTED};font-size:14px;margin-bottom:10px;">${pct(x.sim.netAnnual)} a year after tax, until ${br(x.sim.until)} (${term(x.sim.days)}). ` +
    `Invest through <b style="color:${INK};">${esc(x.offer.platform)}</b>.</div>` +
    `<div style="margin-bottom:12px;">${badges(x)}</div>` +
    `<div style="font-size:0;">${tiles}</div>` +
    warningBoxes(x)
  return section("Today's best CDB", body, '', true)
}

export function renderHtml(r: Report): string {
  const { ranking: k, benchmarks: b } = r
  const rows: string[] = []

  rows.push(
    `<tr><td style="padding:0 0 16px;">` +
      `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${BRAND_DARK};border-radius:14px;"><tr><td class="pad" style="padding:24px;">` +
      `<div style="font-size:12px;color:#8fd1ad;font-weight:700;text-transform:uppercase;letter-spacing:1px;">Renda Fixa Copilot</div>` +
      `<div style="font-size:26px;font-weight:800;color:#ffffff;margin:4px 0 2px;">Your fixed income briefing</div>` +
      `<div style="font-size:14px;color:#b9d8c7;">${br(r.date)} · Simulating ${k.amounts.map(brl).join(', ')}</div>` +
      headerTiles(b) +
      `<div style="font-size:15px;line-height:1.6;color:#eaf5ef;margin-top:18px;">${esc(r.summary.text)}</div>` +
      `</td></tr></table></td></tr>`,
  )

  if (k.cdbs.best) rows.push(hero(k.cdbs.best))

  const hasCdbs = Boolean(k.cdbs.reserve || k.cdbs.buckets.some((bucket) => bucket.picks.length))
  const cdbCount = k.all.filter((x) => x.offer.product === 'CDB').length
  let cdbBody = hasCdbs
    ? ''
    : p(r.web.error ? 'No CDBs today: the web search failed (see below).' : 'The search found no CDBs today.', `color:${WARN};`)
  if (k.cdbs.reserve) cdbBody += h3('CDB you can withdraw any day') + cards([k.cdbs.reserve], false)
  for (const bucket of k.cdbs.buckets) {
    if (bucket.picks.length) cdbBody += h3(`CDBs for ${bucket.label.toLowerCase()}`) + cards(bucket.picks)
  }
  const cdbIntro = hasCdbs
    ? `${cdbCount} CDBs found today, ranked by net return after income tax. Each is covered by the FGC up to ${brl(FGC_LIMIT)} per CPF per institution.`
    : ''
  rows.push(section('Best CDBs', cdbBody, cdbIntro))

  let compareBody = ''
  if (k.reserve) {
    compareBody +=
      h3('Money you may need any day') +
      p('Compared over 1 year; you can withdraw any business day.', `color:${MUTED};font-size:13px;margin-top:-4px;`) +
      cards([k.reserve], false)
  }
  for (const bucket of k.buckets) {
    if (bucket.picks.length) compareBody += h3(`Best for ${bucket.label.toLowerCase()}`) + cards(bucket.picks)
  }
  if (k.breakEvens.length) {
    const items = k.breakEvens.map((e) => {
      const verdict = e.breakEven > e.expected ? 'the fixed rate pays more if the forecast holds' : 'the IPCA+ bond pays more if the forecast holds'
      return `${esc(e.prefixado)} vs ${esc(e.ipca)}: same return at ${pct(e.breakEven)} inflation a year; the Focus survey expects ${pct(e.expected)}, so ${verdict}.`
    })
    compareBody += h3('Fixed rate or inflation-linked?') + bullets(items, 'font-size:13px;')
  }
  rows.push(section('Compared with Tesouro, LCI and LCA', compareBody, 'The best of everything, CDBs included, for the same amounts and terms.'))

  if (r.changes.length) rows.push(section('Since the last report', bullets(r.changes.map(esc), 'font-size:14px;')))

  let webBody: string
  if (r.web.error) webBody = p(`The web search failed today (${esc(r.web.error)}), so only Tesouro Direto is listed.`, `color:${WARN};`)
  else {
    const web = k.all.filter((x) => x.offer.source.kind === 'web')
    const quotes = web.map(
      (x) =>
        `<b style="color:${INK};">${esc(x.offer.name)}</b> ${esc(rateLabel(x.offer))}, ${pct(x.sim.netAnnual)} a year net: ` +
        `"${esc(x.offer.source.quote ?? '')}" <a href="${esc(x.offer.source.url)}" style="color:${BRAND};">${esc(x.offer.source.title ?? 'source')}</a>`,
    )
    webBody =
      p(
        `${r.web.found} offers checked against ${r.web.pagesSearched} pages the search returned; ` +
          `${r.web.rejected.length} more were left out because the page did not back them up.`,
        `color:${MUTED};font-size:13px;margin-top:0;`,
      ) + (quotes.length ? bullets(quotes, `font-size:12px;color:${MUTED};margin-top:8px;`) : '')
  }
  rows.push(section('Bank offers from the web', webBody))

  const method = [
    `Floating rates are projected with the Focus survey (${esc(br(b.focus.date))}). Selic at year end: ${esc(focusLine(b))}.`,
    esc(TAX_NOTE),
    'Tesouro Direto: B3 custody of 0.20% a year is deducted (Tesouro Selic is free on the first R$ 10.000). Bonds other than Tesouro Selic are held to maturity.',
    `FGC covers CDB, LCI, LCA, LC and RDB up to ${brl(FGC_LIMIT)} per CPF per institution, interest included, with R$ 1.000.000 every 4 years.`,
    'Web offers are read by a model from search results and kept only when the page text states the rate. Rates change during the day: confirm at the broker.',
    `This is an automated comparison, not financial advice.${r.summary.byModel ? '' : ' The summary above is a template today.'}`,
  ]
  rows.push(
    `<tr><td style="padding:4px 12px 0;">` +
      `<div style="font-size:12px;font-weight:700;color:${MUTED};margin-bottom:6px;">How this is worked out</div>` +
      bullets(method, `font-size:12px;color:${SOFT};`) +
      `</td></tr>`,
  )

  // Gmail and Apple Mail apply this on phones; clients that drop it still get the inline layout
  const mobile =
    `<style>@media only screen and (max-width:600px){` +
    `.pad{padding:18px 16px!important}` +
    `.tile{display:block!important;width:100%!important;margin-right:0!important}` +
    `}</style>`

  return (
    `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${mobile}</head>` +
    `<body style="margin:0;padding:0;background:${PAGE};">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${PAGE};"><tr><td align="center" style="padding:24px 12px;">` +
    `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:760px;font-family:${FONT};color:${INK};font-size:14px;">` +
    rows.join('\n') +
    `</table></td></tr></table></body></html>`
  )
}

function textRows(picks: Ranked[]): string[] {
  return picks.map(
    (x) =>
      `- ${x.offer.name} (${rateLabel(x.offer)}), until ${br(x.sim.until)}: ${pct(x.sim.netAnnual)} a year net, ` +
      `${signed(x.sim.vsCdi)} vs CDI. Net profit: ${x.scenarios.map((s) => `+${brl(s.netProfit)} on ${brl(s.amount)}`).join(', ')}. Invest through: ${x.offer.platform}. ${x.guarantee.label}.` +
      (x.warnings.length ? ` Note: ${x.warnings.join('; ')}.` : ''),
  )
}

export function renderText(r: Report): string {
  const { ranking: k, benchmarks: b } = r
  const lines = [
    `Renda fixa, ${br(r.date)}`,
    `Simulating ${k.amounts.map(brl).join(', ')}. CDI ${pct(b.cdi)} a year, IPCA ${pct(b.ipca12m)} over 12 months.`,
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
