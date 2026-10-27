// Banco Central's open data: CDI and IPCA from the SGS time series, and the Focus survey of
// market forecasts. No key needed.

import { z } from 'zod'
import type { Benchmarks } from '../lib/benchmarks'
import { getJson, SourceError } from './http'

const SGS = 'https://api.bcb.gov.br/dados/serie/bcdata.sgs'
/** CDI annualized over 252 business days, daily */
const CDI_SERIES = 4389
/** IPCA accumulated over 12 months, monthly */
const IPCA_12M_SERIES = 13522

const FOCUS_URL =
  'https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais' +
  "?$top=40&$filter=(Indicador eq 'Selic' or Indicador eq 'IPCA') and baseCalculo eq 0" +
  '&$orderby=Data desc&$format=json&$select=Indicador,Data,DataReferencia,Mediana'

const sgsSchema = z.array(z.object({ data: z.string(), valor: z.string() })).min(1)

const focusSchema = z.object({
  value: z.array(
    z.object({ Indicador: z.string(), Data: z.string(), DataReferencia: z.string(), Mediana: z.number() }),
  ),
})

/** "26/10/2026" to "2026-10-26" */
const isoDate = (br: string) => br.split('/').reverse().join('-')

async function latest(series: number) {
  const parsed = sgsSchema.safeParse(await getJson('Banco Central', `${SGS}.${series}/dados/ultimos/1?formato=json`))
  if (!parsed.success) throw new SourceError('Banco Central', `unexpected response for series ${series}`)
  const { data, valor } = parsed.data[parsed.data.length - 1]
  return { date: isoDate(data), value: Number(valor) }
}

/** The most recent survey's medians, by year */
export function parseFocus(json: unknown): Benchmarks['focus'] {
  const parsed = focusSchema.safeParse(json)
  if (!parsed.success || !parsed.data.value.length) throw new SourceError('Focus survey', 'unexpected response')
  const date = parsed.data.value.map((r) => r.Data).sort().at(-1)!
  const focus: Benchmarks['focus'] = { date, selic: {}, ipca: {} }
  for (const r of parsed.data.value) {
    if (r.Data !== date) continue
    const table = r.Indicador === 'Selic' ? focus.selic : r.Indicador === 'IPCA' ? focus.ipca : undefined
    if (table) table[Number(r.DataReferencia)] = r.Mediana
  }
  return focus
}

export async function fetchBenchmarks(): Promise<Benchmarks> {
  const [cdi, ipca, focus] = await Promise.all([
    latest(CDI_SERIES),
    latest(IPCA_12M_SERIES),
    getJson('Focus survey', encodeURI(FOCUS_URL)).then(parseFocus),
  ])
  return { date: cdi.date, cdi: cdi.value, ipca12m: ipca.value, focus }
}
