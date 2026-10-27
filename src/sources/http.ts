export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`)
    this.name = 'SourceError'
  }
}

/** GET a JSON API with a timeout, turning failures into a SourceError that names the source */
export async function getJson(source: string, url: string, timeoutMs = 20_000): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      headers: { accept: 'application/json', 'user-agent': 'Mozilla/5.0 (renda-fixa-copilot)' },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    throw new SourceError(source, error instanceof Error && error.name === 'TimeoutError' ? 'timed out' : String(error))
  }
  if (!res.ok) throw new SourceError(source, `HTTP ${res.status}`)
  try {
    return await res.json()
  } catch {
    throw new SourceError(source, 'response was not JSON')
  }
}
