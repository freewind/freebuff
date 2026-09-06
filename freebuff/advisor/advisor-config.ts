import { existsSync, readFileSync } from 'fs'
import path from 'path'

import { load } from 'js-yaml'
import { z } from 'zod/v4'

import { FREEBUFF_DEEPSEEK_V4_FLASH_MODEL_ID } from '@codebuff/common/constants/freebuff-models'

import { getConfigDir } from './config-dir'

/** A single Advisor configuration (one advisor, per the simplified spec). */
export interface AdvisorConfig {
  /** Advisor name (used for identification in injected opinions). */
  name: string
  /** Model id used for the advisor's review run. */
  model: string
  /** Allowed methods/tools whitelist for the advisor (empty = read-only reasoning). */
  allowedMethods: string[]
  /** Review prompt guiding the advisor's critique. */
  prompt: string
}

export const ADVISOR_CONFIG_FILENAME = 'advisor.yml'

export const DEFAULT_ADVISOR_NAME = 'advisor'

export const DEFAULT_ADVISOR_PROMPT = `Review the recent conversation and file changes. Identify issues, risks, and concrete improvements. Be concise and critical. Do not use any tools.`

const advisorConfigSchema = z.object({
  name: z.string().min(1).default(DEFAULT_ADVISOR_NAME),
  model: z.string().min(1).default(FREEBUFF_DEEPSEEK_V4_FLASH_MODEL_ID),
  allowedMethods: z.array(z.string()).default([]),
  prompt: z.string().min(1).default(DEFAULT_ADVISOR_PROMPT),
})

/** Outcome of loading the advisor configuration. */
export interface LoadAdvisorConfigResult {
  /** Parsed config, or null when no usable config is present. */
  config: AdvisorConfig | null
  /** Human-readable problem when a config file exists but is unusable. */
  error: string | null
}

/**
 * Loads the single-advisor configuration from `<configDir>/advisor.yml`
 * (default: the Freebuff config dir). Strategy:
 * - file missing → `{ config: null, error: null }` (advisor disabled, silent)
 * - invalid YAML / wrong shape (array, non-object) / schema violations →
 *   `{ config: null, error }` (caller decides how to surface; CLI warns and disables)
 * - missing fields fall back to defaults (name / model / allowedMethods / prompt)
 */
export function loadAdvisorConfig(options?: {
  configDir?: string
}): LoadAdvisorConfigResult {
  const configDir = options?.configDir ?? getConfigDir()
  const file = path.join(configDir, ADVISOR_CONFIG_FILENAME)

  if (!existsSync(file)) {
    return { config: null, error: null }
  }

  let raw: unknown
  try {
    raw = load(readFileSync(file, 'utf8'))
  } catch (error) {
    return {
      config: null,
      error: `Invalid YAML in ${file}: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  if (raw === null || raw === undefined) {
    return { config: null, error: `${file} is empty` }
  }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return {
      config: null,
      error: `${file} must contain a single advisor object (found ${Array.isArray(raw) ? 'an array' : typeof raw})`,
    }
  }

  const parsed = advisorConfigSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      config: null,
      error: `Invalid advisor config in ${file}: ${parsed.error.issues
        .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
        .join('; ')}`,
    }
  }

  return { config: parsed.data, error: null }
}
