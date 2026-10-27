// Who guarantees the money. The FGC (Fundo Garantidor de Créditos) covers bank-issued products up
// to R$250,000 per CPF per financial group, interest included, with a R$1 million cap on payouts
// every four years. Tesouro Direto bonds are federal government debt and need no FGC.

import type { Product } from './offer'

export const FGC_LIMIT = 250_000
export const FGC_FOUR_YEAR_CAP = 1_000_000

const FGC_COVERED: readonly Product[] = ['CDB', 'LCI', 'LCA', 'LC', 'RDB']

export interface Guarantee {
  kind: 'fgc' | 'government' | 'none'
  label: string
  /** Set when the amount at maturity goes past what the FGC would pay back */
  warning?: string
}

export function guarantee(product: Product, valueAtMaturity: number): Guarantee {
  if (product === 'TESOURO') return { kind: 'government', label: 'Federal government (Tesouro Nacional)' }
  if (!FGC_COVERED.includes(product)) return { kind: 'none', label: 'Not covered by the FGC' }
  const fmt = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 })
  return {
    kind: 'fgc',
    label: `FGC, up to ${fmt(FGC_LIMIT)} per CPF per institution`,
    warning:
      valueAtMaturity > FGC_LIMIT
        ? `${fmt(valueAtMaturity)} at maturity is above the FGC limit; split it across institutions`
        : undefined,
  }
}
