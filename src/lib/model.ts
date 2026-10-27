// Which models run. Both steps need GROQ_API_KEY by default; Groq's free tier covers a daily run.
//   SEARCH_MODEL  searches the web for bank offers (Groq's compound system, which has web search)
//   AI_PROVIDER   reads offers out of the search results and writes the summary: groq or google
//   AI_MODEL      overrides that provider's default model

import { google } from '@ai-sdk/google'
import { groq } from '@ai-sdk/groq'
import type { LanguageModel } from 'ai'

export const DEFAULT_SEARCH_MODEL = 'groq/compound'

export const DEFAULT_MODELS = {
  groq: 'openai/gpt-oss-120b',
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
