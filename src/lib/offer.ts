// One investable offer, whatever its source: a Tesouro Direto bond or a bank-issued CDB/LCI/LCA
// found on the web. Everything downstream (simulation, ranking, the email) works on this shape.

export const PRODUCTS = ['CDB', 'LCI', 'LCA', 'LC', 'RDB', 'TESOURO'] as const
export type Product = (typeof PRODUCTS)[number]

/**
 * How the rate is quoted:
 *   CDI     rate is a percent of CDI (110 = 110% of CDI)
 *   CDI+    CDI plus rate percent a year
 *   PRE     rate percent a year, fixed
 *   IPCA+   IPCA inflation plus rate percent a year
 *   SELIC+  Selic plus rate percent a year (Tesouro Selic)
 */
export const INDEXERS = ['CDI', 'CDI+', 'PRE', 'IPCA+', 'SELIC+'] as const
export type Indexer = (typeof INDEXERS)[number]

export interface OfferSource {
  kind: 'tesouro' | 'web'
  url: string
  title?: string
  /** For web offers: the text on the source page that states the rate */
  quote?: string
}

export interface Offer {
  /** Stable across runs, so a report can compare against the previous one */
  id: string
  product: Product
  /** e.g. "Tesouro IPCA+ 2032" or "CDB Banco Pine" */
  name: string
  issuer: string
  indexer: Indexer
  rate: number
  /** YYYY-MM-DD */
  maturity: string
  liquidity: 'daily' | 'maturity'
  minimum?: number
  /** The app or broker to invest through, e.g. "XP", "Nubank", "Inter", "PicPay" */
  platform: string
  source: OfferSource
}

/** Tesouro Direto bonds are sold through nearly every bank and broker app, at the same rate */
export const TESOURO_PLATFORM = 'Any bank or broker app (Nubank, Inter, PicPay, XP, BTG...)'

/** Digital banks sell the CDBs they issue in their own app */
const OWN_APP = /nubank|nu financeira|banco inter|^inter$|picpay|mercado pago|c6|pagbank|sofisa|btg/i

/** Where to invest: what the page says, else the issuer's own app when it has one */
export function platformFor(stated: string | null | undefined, issuer: string): string {
  if (stated?.trim()) return stated.trim()
  if (OWN_APP.test(issuer)) return `${issuer} app`
  return 'Not stated: see the source page'
}

/** "110% do CDI", "IPCA + 7,64%", in the Brazilian format brokers use */
export function rateLabel({ indexer, rate }: Pick<Offer, 'indexer' | 'rate'>): string {
  const n = rate.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
  switch (indexer) {
    case 'CDI':
      return `${n}% do CDI`
    case 'CDI+':
      return `CDI + ${n}%`
    case 'PRE':
      return `${n}% a.a.`
    case 'IPCA+':
      return `IPCA + ${n}%`
    case 'SELIC+':
      return rate === 0 ? 'Selic' : `Selic + ${n}%`
  }
}
