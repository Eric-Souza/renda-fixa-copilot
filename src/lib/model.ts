// Which models run. Both need GROQ_API_KEY by default; Groq's free tier covers a daily run.
//   SEARCH_MODEL  searches the web for bank offers, with Groq's built-in browser_search tool
//   AI_PROVIDER   writes the summary: groq or google
//   AI_MODEL      overrides that provider's default model
// Groq's rate limits are per model, so the summary uses a different one than the search, which
// uses up the minute's token budget on its own.

import { google } from '@ai-sdk/google'
import { groq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'

export const DEFAULT_SEARCH_MODEL = 'openai/gpt-oss-120b'

export const DEFAULT_MODELS = {
  groq: 'openai/gpt-oss-20b',
  google: 'gemini-3.5-flash-lite',
} as const

type Provider = keyof typeof DEFAULT_MODELS
type Env = Record<string, string | undefined>

export function modelConfig(env: Env = process.env) {
  const provider = (env.AI_PROVIDER || 'groq').toLowerCase()
  if (!(provider in DEFAULT_MODELS)) {
    throw new Error(`AI_PROVIDER must be one of ${Object.keys(DEFAULT_MODELS).join(', ')}, got "${provider}"`)
  }
  const p = provider as Provider
  return { provider: p, modelId: env.AI_MODEL || DEFAULT_MODELS[p] }
}

export function getModel(env: Env = process.env): LanguageModel {
  const { provider, modelId } = modelConfig(env)
  return provider === 'google' ? google(modelId) : groq(modelId)
}
