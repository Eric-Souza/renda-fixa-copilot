// Bank-issued offers (CDB, LCI, LCA) have no public API, so a model with web search finds them.
// A model asked for rates without search makes them up, so every offer it reports must come with
// the exact text of a page the search tool actually fetched, and that text must state the rate.
// Offers that fail any check are dropped, with the reason kept for the report.
//
// The model reads the pages and lists the offers in the same call. A second call to extract them
// would send every page again, far past the free tier's 8,000 tokens a minute.

import { z } from 'zod'
import { DEFAULT_SEARCH_MODEL, FALLBACK_SEARCH_MODELS } from '../lib/model'
import { INDEXERS, type Indexer, type Offer, platformFor, type Product } from '../lib/offer'
import { SourceError } from './http'

const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions'
const DAY = 86_400_000

export interface WebPage {
  url: string
  title: string
  content: string
}

export interface WebSearch {
  /** The model's final answer, which should hold the offers as JSON */
  answer: string
  pages: WebPage[]
  model?: string
  /** Why the model stopped: "stop" when it finished, "length" when it ran out of output tokens */
  finishReason?: string
}

const extractedSchema = z.object({
  product: z.enum(['CDB', 'LCI', 'LCA', 'LC', 'RDB']),
  issuer: z.string(),
  indexer: z.enum(INDEXERS),
  rate: z.number(),
  termMonths: z.number().nullable().optional(),
  maturity: z.string().nullable().optional(),
  liquidity: z.enum(['daily', 'maturity']).catch('maturity'),
  minimum: z.number().nullable().optional(),
  platform: z.string().nullable().optional(),
  sourceUrl: z.string(),
  quote: z.string(),
})
export type ExtractedOffer = z.infer<typeof extractedSchema>

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function searchPrompt(today: Date): string {
  const day = today.toISOString().slice(0, 10)
  const month = `${MONTHS[today.getUTCMonth()]} de ${today.getUTCFullYear()}`
  return [
    `Hoje é ${day}. Pesquise na web as ofertas de CDB com as maiores taxas disponíveis hoje ou em ${month} ` +
      'em bancos e corretoras brasileiras. Procure CDBs de todos os prazos (até 1 ano, 1 a 3 anos, mais de 3 anos), ' +
      'dos três tipos (pós-fixados em % do CDI, prefixados e IPCA+) e também CDBs com liquidez diária. ' +
      'Inclua algumas LCI e LCA se aparecerem, mas a maioria das ofertas deve ser de CDB. Bons pontos de partida são ' +
      'rankings diários de CDB (Meelion, Investidor10, Yubb) e as colunas "Renda Fixa Hoje" (InfoMoney). ' +
      'Abra no máximo 4 páginas, as que listam mais ofertas.',
    '',
    'Responda só com um array JSON, sem texto antes ou depois, com até 25 ofertas específicas (pelo menos 15 CDBs, se houver) que aparecem nas páginas que você abriu:',
    '[{"product":"CDB|LCI|LCA|LC|RDB","issuer":"banco emissor","indexer":"CDI|CDI+|PRE|IPCA+",' +
      '"rate":120,"termMonths":24 ou null,"maturity":"AAAA-MM-DD" ou "AAAA-MM" ou null,"liquidity":"daily|maturity",' +
      '"minimum":1000 ou null,"platform":"app ou corretora onde investir (Nubank, Inter, PicPay, XP, BTG...)" ou null,' +
      '"sourceUrl":"URL da página","quote":"trecho copiado da página que mostra a taxa"}]',
    '',
    'Regras: rate é o número da taxa (120 para 120% do CDI, 15.05 para 15,05% a.a., 8.15 para IPCA + 8,15%). ' +
      'quote deve ser copiado exatamente da página, sem os marcadores de linha "L12:", e conter a taxa. ' +
      'Não invente nada e não use ofertas que não estão nas páginas.',
  ].join('\n')
}

// Fields come back null or missing depending on the tool step, so everything but the message is optional
const searchResultSchema = z.object({ title: z.string().nullish(), url: z.string().nullish(), content: z.string().nullish() })
const groqResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullish(),
        message: z.object({
          content: z.string().nullish(),
          executed_tools: z
            .array(z.object({ search_results: z.object({ results: z.array(searchResultSchema).nullish() }).nullish() }))
            .nullish(),
        }),
      }),
    )
    .min(1),
})

function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
}

/** The browser tool numbers each line ("L25: ") and marks citations (【2†L25-L42】) */
export function cleanPageText(text: string): string {
  return text.replace(/^L\d+: ?/gm, '').replace(/【[^】]*】/g, '')
}

export function parseGroqSearch(json: unknown): WebSearch {
  const parsed = groqResponseSchema.safeParse(json)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new SourceError('Web search', `unexpected response from Groq (${issue.path.join('.')}: ${issue.message})`)
  }
  const { message, finish_reason } = parsed.data.choices[0]
  const pages = new Map<string, WebPage>()
  for (const tool of message.executed_tools ?? []) {
    for (const r of tool.search_results?.results ?? []) {
      if (!r.url) continue
      const key = normalizeUrl(r.url)
      const content = cleanPageText(r.content ?? '')
      const seen = pages.get(key)
      // A page comes back each time the model looks at it: in the search listing, opened, searched in
      if (seen) seen.content += `\n${content}`
      else pages.set(key, { url: r.url, title: r.title ?? r.url, content })
    }
  }
  return { answer: message.content ?? '', pages: [...pages.values()], finishReason: finish_reason ?? undefined }
}

/**
 * The offers in the model's answer; it is asked for bare JSON but may wrap it in a code fence.
 * An answer cut off mid-list still keeps the offers before the cut, since one search uses most
 * of the day's tokens and searching again would leave none for a second try.
 */
export function parseAnswer(answer: string): { offers: ExtractedOffer[]; invalid: number } {
  const start = answer.indexOf('[')
  if (start < 0) throw new SourceError('Web search', 'the answer had no list of offers')
  const end = answer.lastIndexOf(']')
  let items: unknown
  try {
    items = JSON.parse(answer.slice(start, end + 1))
  } catch {
    items = parseTruncated(answer.slice(start))
    if (!items) throw new SourceError('Web search', 'the list of offers was not valid JSON')
  }
  if (!Array.isArray(items)) throw new SourceError('Web search', 'the answer had no list of offers')
  const offers: ExtractedOffer[] = []
  for (const item of items) {
    const parsed = extractedSchema.safeParse(item)
    if (parsed.success) offers.push(parsed.data)
  }
  return { offers, invalid: items.length - offers.length }
}

/** The complete items of a list cut off partway, or null when not even one is whole */
function parseTruncated(text: string): unknown[] | null {
  for (let end = text.lastIndexOf('}'); end > 0; end = text.lastIndexOf('}', end - 1)) {
    try {
      const items = JSON.parse(`${text.slice(0, end + 1)}]`)
      if (Array.isArray(items) && items.length) return items
    } catch {
      // A "}" inside a quote, or one closing a nested object; try the one before
    }
  }
  return null
}

class RateLimited extends SourceError {}

async function searchWith(model: string, today: Date, key: string): Promise<WebSearch> {
  let res: Response
  try {
    res = await fetch(GROQ_CHAT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: searchPrompt(today) }],
        tools: [{ type: 'browser_search' }],
      }),
      signal: AbortSignal.timeout(240_000),
    })
  } catch (error) {
    throw new SourceError('Web search', error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : String(error))
  }
  if (res.status === 401) throw new SourceError('Web search', 'GROQ_API_KEY was rejected')
  if (res.status === 429) {
    // Groq says which limit (tokens a minute or a day) and when it resets
    const body = (await res.text()).match(/"message"\s*:\s*"([^"]+)"/)?.[1]
    throw new RateLimited('Web search', `Groq's free-tier limit was hit${body ? `: ${body}` : ''}`)
  }
  if (!res.ok) {
    const body = (await res.text()).match(/"message"\s*:\s*"([^"]+)"/)?.[1]
    throw new SourceError('Web search', `HTTP ${res.status}${body ? `: ${body}` : ''}`)
  }
  const search = parseGroqSearch(await res.json())
  if (!search.pages.length) throw new SourceError('Web search', 'the search returned no pages')
  return { ...search, model }
}

/**
 * Pages read by the search count against a daily token limit, and one search takes most of a
 * model's day. Limits are per model, so when one runs out the next is tried.
 */
export async function searchWeb(today: Date, env: Record<string, string | undefined> = process.env): Promise<WebSearch> {
  if (!env.GROQ_API_KEY) throw new SourceError('Web search', 'GROQ_API_KEY is not set')
  const models = [...new Set([env.SEARCH_MODEL || DEFAULT_SEARCH_MODEL, ...FALLBACK_SEARCH_MODELS])]
  for (const [i, model] of models.entries()) {
    try {
      return await searchWith(model, today, env.GROQ_API_KEY)
    } catch (error) {
      if (!(error instanceof RateLimited) || i === models.length - 1) throw error
      console.warn(`${model}: ${error.message}; trying ${models[i + 1]}`)
    }
  }
  throw new SourceError('Web search', 'no search model configured')
}

/** Rates outside these ranges are typos, promotions for new clients or misread numbers */
const PLAUSIBLE: Record<Indexer, [number, number]> = {
  CDI: [80, 150],
  'CDI+': [0, 6],
  PRE: [6, 25],
  'IPCA+': [2, 12],
  'SELIC+': [0, 2],
}

const normalizeText = (s: string) =>
  s
    .normalize('NFKC')
    // Pages come as markdown; a copied quote may or may not keep the bold markers
    .replace(/\*+/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .trim()

/** "110", "110,5", "110.5" and "7,64" all match the number as written in Portuguese or English */
function statesRate(quote: string, rate: number): boolean {
  // Brokers pad decimals with zeros ("8,150%", "122,00%"), never whole numbers: 12 is not 120
  const [whole, decimals] = String(rate).split('.')
  const pattern = decimals ? `${whole}[.,]${decimals}0*` : `${whole}(?:[.,]0+)?`
  return new RegExp(`(^|[^\\d.,])${pattern}(?![\\d]|[.,]\\d)`).test(quote)
}

export type Checked = { ok: true; offer: Offer } | { ok: false; reason: string; offer: ExtractedOffer }

export function checkOffer(raw: ExtractedOffer, pages: WebPage[], today: Date): Checked {
  const fail = (reason: string): Checked => ({ ok: false, reason, offer: raw })
  const page = pages.find((p) => normalizeUrl(p.url) === normalizeUrl(raw.sourceUrl))
  if (!page) return fail('source URL was not in the search results')
  const quote = normalizeText(cleanPageText(raw.quote))
  if (quote.length < 6 || !normalizeText(page.content).includes(quote)) return fail('quote is not on the source page')
  if (!statesRate(quote, raw.rate)) return fail('quote does not state the rate')
  const [low, high] = PLAUSIBLE[raw.indexer]
  if (raw.rate < low || raw.rate > high) return fail(`rate ${raw.rate} is outside ${low} to ${high} for ${raw.indexer}`)

  let maturity: Date | undefined
  // "Vencimento: outubro/2029" gives only a month, taken as its first day
  if (raw.maturity && /^\d{4}-\d{2}(-\d{2})?$/.test(raw.maturity)) {
    maturity = new Date(`${raw.maturity.length === 7 ? `${raw.maturity}-01` : raw.maturity}T00:00:00Z`)
  } else if (raw.termMonths && raw.termMonths > 0) {
    maturity = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + Math.round(raw.termMonths), today.getUTCDate()))
  }
  if (!maturity || Number.isNaN(maturity.getTime())) return fail('no term or maturity date')
  const days = (maturity.getTime() - today.getTime()) / DAY
  if (days < 30) return fail('matures in under 30 days')
  if (days > 15 * 365) return fail('matures in over 15 years')

  const issuer = raw.issuer.trim()
  const iso = maturity.toISOString().slice(0, 10)
  const product = raw.product as Product
  const platform = platformFor(raw.platform, issuer)
  return {
    ok: true,
    offer: {
      // The same CDB can pay a different rate on each platform, so each is its own offer
      id: `web-${product}-${issuer}-${raw.indexer}-${raw.rate}-${iso.slice(0, 7)}-${platform}`.toLowerCase().replace(/[^a-z0-9.+-]+/g, '-'),
      product,
      name: `${product} ${issuer}`,
      issuer,
      indexer: raw.indexer,
      rate: raw.rate,
      maturity: iso,
      liquidity: raw.liquidity,
      minimum: raw.minimum ?? undefined,
      platform,
      source: { kind: 'web', url: page.url, title: page.title, quote: raw.quote.trim() },
    },
  }
}

export interface WebOffers {
  offers: Offer[]
  rejected: { name: string; reason: string }[]
  pagesSearched: number
  model?: string
}

/** The model sometimes answers in prose instead of JSON; a second search usually lists the offers */
async function searchForOffers(today: Date, attempts = 2): Promise<{ search: WebSearch } & ReturnType<typeof parseAnswer>> {
  for (let attempt = 1; ; attempt++) {
    const search = await searchWeb(today)
    if (search.finishReason && search.finishReason !== 'stop') {
      console.warn(`${search.model}: the answer ended with finish_reason "${search.finishReason}" after ${search.answer.length} characters`)
    }
    try {
      return { search, ...parseAnswer(search.answer) }
    } catch (error) {
      const start = search.answer.slice(0, 200).replace(/\s+/g, ' ')
      const message = `${search.model}: ${error instanceof Error ? error.message : String(error)} ("${start}")`
      if (attempt >= attempts) throw new SourceError('Web search', message)
      console.warn(`${message}; searching again`)
    }
  }
}

export async function fetchWebOffers(today: Date): Promise<WebOffers> {
  const { search, offers: extracted, invalid } = await searchForOffers(today)
  const offers = new Map<string, Offer>()
  const rejected: WebOffers['rejected'] = []
  for (const raw of extracted) {
    const checked = checkOffer(raw, search.pages, today)
    if (checked.ok) offers.set(checked.offer.id, checked.offer)
    else rejected.push({ name: `${raw.product} ${raw.issuer} ${raw.rate}`, reason: checked.reason })
  }
  if (invalid) rejected.push({ name: `${invalid} more`, reason: 'missing fields in the answer' })
  return { offers: [...offers.values()], rejected, pagesSearched: search.pages.length, model: search.model }
}
