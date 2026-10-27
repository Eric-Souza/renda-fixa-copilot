// Today's CDI and the market's forecasts, and the rate an offer is expected to pay in each year
// until it matures. A CDB at 110% of CDI for 3 years pays 110% of whatever CDI turns out to be, so
// its return is projected from the Focus survey's Selic medians, the same way for every offer.

export interface Benchmarks {
  /** Date of the latest CDI value, YYYY-MM-DD */
  date: string
  /** CDI, percent a year */
  cdi: number
  /** IPCA over the last 12 months, percent */
  ipca12m: number
  /** Focus survey medians by year, percent: Selic at year end and IPCA for the year */
  focus: { date: string; selic: Record<number, number>; ipca: Record<number, number> }
}

/** CDI runs about 0.10 point a year under the Selic target */
const CDI_SPREAD = 0.1

function forYear(table: Record<number, number>, year: number): number | undefined {
  const years = Object.keys(table).map(Number).sort((a, b) => a - b)
  if (!years.length) return undefined
  // Past the survey's last year, assume the last forecast holds
  const y = Math.min(Math.max(year, years[0]), years[years.length - 1])
  return table[y]
}

/** Expected average CDI over a calendar year, percent a year */
export function cdiForYear(b: Benchmarks, year: number): number {
  const current = Number(b.date.slice(0, 4))
  if (year <= current) return b.cdi
  // The Focus survey gives Selic at each year's end; a year's average sits between two year ends
  const start = year - 1 === current ? b.cdi + CDI_SPREAD : forYear(b.focus.selic, year - 1)
  const end = forYear(b.focus.selic, year)
  if (start === undefined || end === undefined) return b.cdi
  return (start + end) / 2 - CDI_SPREAD
}

/** Expected IPCA for a calendar year, percent */
export function ipcaForYear(b: Benchmarks, year: number): number {
  return forYear(b.focus.ipca, year) ?? b.ipca12m
}

/** Annual rate for a percent of CDI, compounded daily over 252 business days as banks do */
export function pctOfCdiAnnual(cdi: number, pct: number): number {
  const daily = Math.pow(1 + cdi / 100, 1 / 252) - 1
  return (Math.pow(1 + (daily * pct) / 100, 252) - 1) * 100
}
