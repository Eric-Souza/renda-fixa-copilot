export class SourceError extends Error {
  constructor(
    readonly source: string,
    message: string,
  ) {
    super(`${source}: ${message}`)
    this.name = 'SourceError'
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

async function getJsonOnce(source: string, url: string, timeoutMs: number): Promise<unknown> {
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

/**
 * GET a JSON API with a timeout, turning failures into a SourceError that names the source.
 * Government APIs time out now and then, so a failure is retried before giving up.
 */
export async function getJson(source: string, url: string, { timeoutMs = 20_000, retries = 2 } = {}): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await getJsonOnce(source, url, timeoutMs)
    } catch (error) {
      if (attempt >= retries) throw error
      await sleep(2_000 * (attempt + 1))
    }
  }
}
