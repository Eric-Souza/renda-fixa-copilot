// Tesouro Direto's public price list: every government bond on sale with its current buy rate.

import { z } from 'zod'
import { type Indexer, type Offer, TESOURO_PLATFORM } from '../lib/offer'
import { getJson, SourceError } from './http'

export const TESOURO_URL = 'https://www.tesourodireto.com.br/o/rentabilidade/investir'
const PRICES_PAGE = 'https://www.tesourodireto.com.br/titulos/precos-e-taxas.htm'

const bondSchema = z.object({
  treasuryBondName: z.string(),
  treasuryBondCode: z.number(),
  investmentProfitabilityIndexerName: z.string(),
  investmentBondMinimumValue: z.number(),
  maturityDate: z.string(),
})
const responseSchema = z.object({ TesouroLegado: z.array(z.unknown()), Tesouro24x7: z.array(z.unknown()).optional() })

/** "IPCA + 7,64%", "14,79%", "SELIC + 0,10%" or "SELIC" */
export function parseRate(text: string): { indexer: Indexer; rate: number } | undefined {
  const num = (s: string) => Number(s.replace(/\./g, '').replace(',', '.'))
  let m = text.match(/^\s*IPCA\s*\+\s*([\d.,]+)\s*%\s*$/i)
  if (m) return { indexer: 'IPCA+', rate: num(m[1]) }
  m = text.match(/^\s*SELIC(?:\s*\+\s*([\d.,]+)\s*%)?\s*$/i)
  if (m) return { indexer: 'SELIC+', rate: m[1] ? num(m[1]) : 0 }
  m = text.match(/^\s*([\d.,]+)\s*%\s*$/)
  if (m) return { indexer: 'PRE', rate: num(m[1]) }
  return undefined
}

/**
 * Renda+ and Educa+ pay out monthly over many years, and the coupon bonds pay interest every six
 * months, so a hold-to-maturity simulation would misstate them. Each has a plain bond with the
 * same index next to it, so they are left out.
 */
const SKIP = /Renda\+|Educa\+|Juros Semestrais/i

export function parseTesouro(json: unknown): Offer[] {
  const parsed = responseSchema.safeParse(json)
  if (!parsed.success) throw new SourceError('Tesouro Direto', 'unexpected response')
  const offers: Offer[] = []
  for (const raw of [...parsed.data.TesouroLegado, ...(parsed.data.Tesouro24x7 ?? [])]) {
    const bond = bondSchema.safeParse(raw)
    if (!bond.success || SKIP.test(bond.data.treasuryBondName)) continue
    const rate = parseRate(bond.data.investmentProfitabilityIndexerName)
    if (!rate) continue
    offers.push({
      id: `tesouro-${bond.data.treasuryBondCode}`,
      product: 'TESOURO',
      name: bond.data.treasuryBondName,
      issuer: 'Tesouro Nacional',
      ...rate,
      maturity: bond.data.maturityDate.slice(0, 10),
      // Every bond can be sold back any business day, but only Selic bonds sell at a stable price
      liquidity: rate.indexer === 'SELIC+' ? 'daily' : 'maturity',
      minimum: bond.data.investmentBondMinimumValue,
      platform: TESOURO_PLATFORM,
      source: { kind: 'tesouro', url: PRICES_PAGE, title: 'Tesouro Direto: preços e taxas' },
    })
  }
  if (!offers.length) throw new SourceError('Tesouro Direto', 'no bonds on sale')
  return offers
}

export async function fetchTesouro(): Promise<Offer[]> {
  return parseTesouro(await getJson('Tesouro Direto', TESOURO_URL))
}
