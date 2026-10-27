// Bank-issued offers (CDB, LCI, LCA) have no public API, so a model searches the web for them.
// A model asked for rates without search makes them up, so every offer it reports must come with
// the exact text on a page the search actually returned, and that text must state the rate. Offers
// that fail any check are dropped, with the reason kept for the report.

import { generateText, Output } from 'ai'
import { z } from 'zod'
import { DEFAULT_SEARCH_MODEL, getModel } from '../lib/model'
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
  answer: string
  pages: WebPage[]
}

const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']

export function searchPrompt(today: Date): string {
  const month = `${MONTHS[today.getUTCMonth()]} de ${today.getUTCFullYear()}`
  return (
    `Pesquise na web as ofertas de CDB, LCI e LCA com as maiores taxas disponíveis em ${month} ` +
    'em bancos e corretoras brasileiras (por exemplo XP, BTG Pactual, Inter, Nubank, Rico, Órama, ' +
    'PicPay, Mercado Pago, Sofisa, Banco Pine, BMG, Daycoval). Para cada oferta informe o emissor, o ' +
    'tipo, a taxa (% do CDI, prefixada ou IPCA +), o prazo ou vencimento, a liquidez, a aplicação ' +
    'mínima, em qual app ou corretora investir (Nubank, Inter, PicPay, XP, BTG, Rico, Mercado Pago, C6...) ' +
    'e a URL da página onde a encontrou. Liste só ofertas que aparecem nas páginas.'
  )
}

const searchResultSchema = z.object({ title: z.string().optional(), url: z.string(), content: z.string().optional() })
const groqResponseSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z.object({
          content: z.string().nullable().optional(),
          executed_tools: z
            .array(
              z.object({
                output: z.string().nullable().optional(),
                search_results: z.object({ results: z.array(searchResultSchema).optional() }).nullable().optional(),
              }),
            )
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
})

/** Search results come structured, and also as "Title: / URL: / Content:" text in the tool output */
function pagesFromOutput(output: string): WebPage[] {
  const pages: WebPage[] = []
  for (const block of output.split(/\n(?=Title:)/)) {
    const url = block.match(/^URL:\s*(\S+)/m)?.[1]
    if (!url) continue
    pages.push({
      url,
      title: block.match(/^Title:\s*(.*)$/m)?.[1]?.trim() ?? url,
      content: block.match(/^Content:\s*([\s\S]*?)(?:\n(?:Score|URL|Title):|$)/m)?.[1]?.trim() ?? '',
    })
  }
  return pages
}

export function parseGroqSearch(json: unknown): WebSearch {
  const parsed = groqResponseSchema.safeParse(json)
  if (!parsed.success) throw new SourceError('Web search', 'unexpected response from Groq')
  const message = parsed.data.choices[0].message
  const pages = new Map<string, WebPage>()
  for (const tool of message.executed_tools ?? []) {
    const found = tool.search_results?.results?.length
      ? tool.search_results.results.map((r) => ({ url: r.url, title: r.title ?? r.url, content: r.content ?? '' }))
      : pagesFromOutput(tool.output ?? '')
    for (const page of found) {
      const seen = pages.get(normalizeUrl(page.url))
      // The same page can come back from several searches with different excerpts
      if (seen) seen.content += `\n${page.content}`
      else pages.set(normalizeUrl(page.url), { ...page })
    }
  }
  return { answer: message.content ?? '', pages: [...pages.values()] }
}

export async function searchWeb(today: Date, env: Record<string, string | undefined> = process.env): Promise<WebSearch> {
  if (!env.GROQ_API_KEY) throw new SourceError('Web search', 'GROQ_API_KEY is not set')
  let res: Response
  try {
    res = await fetch(GROQ_CHAT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: JSON.stringify({
        model: env.SEARCH_MODEL || DEFAULT_SEARCH_MODEL,
        messages: [{ role: 'user', content: searchPrompt(today) }],
      }),
      signal: AbortSignal.timeout(120_000),
    })
  } catch (error) {
    throw new SourceError('Web search', error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : String(error))
  }
  if (res.status === 401) throw new SourceError('Web search', 'GROQ_API_KEY was rejected')
  if (res.status === 429) throw new SourceError('Web search', "Groq's free-tier limit was hit")
  if (!res.ok) throw new SourceError('Web search', `HTTP ${res.status}`)
  const search = parseGroqSearch(await res.json())
  if (!search.pages.length) throw new SourceError('Web search', 'the search returned no pages')
  return search
}

const extractedSchema = z.object({
  offers: z.array(
    z.object({
      product: z.enum(['CDB', 'LCI', 'LCA', 'LC', 'RDB']),
      issuer: z.string().describe('The bank that issues it, e.g. "Banco Pine"'),
      indexer: z.enum(INDEXERS).describe('CDI = percent of CDI; CDI+, PRE, IPCA+ = rate percent a year'),
      rate: z.number().describe('110 for 110% do CDI, 7.5 for IPCA + 7,5%, 14.2 for 14,2% a.a.'),
      termMonths: z.number().nullable().describe('Months until maturity, if the page gives a term'),
      maturity: z.string().nullable().describe('YYYY-MM-DD, if the page gives a maturity date'),
      liquidity: z.enum(['daily', 'maturity']),
      minimum: z.number().nullable().describe('Minimum investment in reais'),
      platform: z
        .string()
        .nullable()
        .describe('The app or broker where it is sold, e.g. "XP", "Nubank", "Inter", "PicPay", as named on the page'),
      sourceUrl: z.string().describe('The URL of the page that lists this offer'),
      quote: z.string().describe('The exact text from that page that states the rate, copied verbatim'),
    }),
  ),
})
export type ExtractedOffer = z.infer<typeof extractedSchema>['offers'][number]

const EXTRACT_SYSTEM =
  'You read web search results about Brazilian fixed income offers and list the offers they contain. ' +
  'Only list an offer that appears in one of the pages below, with that page as sourceUrl and a short ' +
  'verbatim excerpt from its content as quote. Never use outside knowledge, never guess a rate, and ' +
  'skip general articles with no specific offer. An empty list is a fine answer.'

export async function extractOffers(search: WebSearch): Promise<ExtractedOffer[]> {
  const pages = search.pages.map((p, i) => `[${i + 1}] ${p.title}\nURL: ${p.url}\n${p.content.slice(0, 4000)}`)
  const { output } = await generateText({
    model: getModel(),
    output: Output.object({ schema: extractedSchema }),
    system: EXTRACT_SYSTEM,
    prompt: `Search results:\n\n${pages.join('\n\n')}`,
    timeout: { totalMs: 90_000 },
    maxRetries: 1,
  })
  return output.offers
}

/** Rates outside these ranges are typos, promotions for new clients or misread numbers */
const PLAUSIBLE: Record<Indexer, [number, number]> = {
  CDI: [80, 150],
  'CDI+': [0, 6],
  PRE: [6, 25],
  'IPCA+': [2, 12],
  'SELIC+': [0, 2],
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/#.*$/, '').replace(/\/+$/, '').toLowerCase()
}

const normalizeText = (s: string) =>
  s
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .replace(/[“”]/g, '"')
    .toLowerCase()
    .trim()

/** "110", "110,5", "110.5" and "7,64" all match the number as written in Portuguese or English */
function statesRate(quote: string, rate: number): boolean {
  const forms = new Set([String(rate), String(rate).replace('.', ',')])
  if (Number.isInteger(rate)) forms.add(`${rate},0`).add(`${rate},00`)
  else forms.add(rate.toFixed(2)).add(rate.toFixed(2).replace('.', ','))
  return [...forms].some((f) => new RegExp(`(^|[^\\d.,])${f.replace(/[.,]/g, '[.,]')}(?![\\d])`).test(quote))
}

export type Checked = { ok: true; offer: Offer } | { ok: false; reason: string; offer: ExtractedOffer }

export function checkOffer(raw: ExtractedOffer, pages: WebPage[], today: Date): Checked {
  const fail = (reason: string): Checked => ({ ok: false, reason, offer: raw })
  const page = pages.find((p) => normalizeUrl(p.url) === normalizeUrl(raw.sourceUrl))
  if (!page) return fail('source URL was not in the search results')
  const quote = normalizeText(raw.quote)
  if (quote.length < 6 || !normalizeText(page.content).includes(quote)) return fail('quote is not on the source page')
  if (!statesRate(quote, raw.rate)) return fail('quote does not state the rate')
  const [low, high] = PLAUSIBLE[raw.indexer]
  if (raw.rate < low || raw.rate > high) return fail(`rate ${raw.rate} is outside ${low} to ${high} for ${raw.indexer}`)

  let maturity: Date | undefined
  if (raw.maturity && /^\d{4}-\d{2}-\d{2}$/.test(raw.maturity)) maturity = new Date(`${raw.maturity}T00:00:00Z`)
  else if (raw.termMonths && raw.termMonths > 0) {
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
}

export async function fetchWebOffers(today: Date): Promise<WebOffers> {
  const search = await searchWeb(today)
  const extracted = await extractOffers(search)
  const offers = new Map<string, Offer>()
  const rejected: WebOffers['rejected'] = []
  for (const raw of extracted) {
    const checked = checkOffer(raw, search.pages, today)
    if (checked.ok) offers.set(checked.offer.id, checked.offer)
    else rejected.push({ name: `${raw.product} ${raw.issuer} ${raw.rate}`, reason: checked.reason })
  }
  return { offers: [...offers.values()], rejected, pagesSearched: search.pages.length }
}
