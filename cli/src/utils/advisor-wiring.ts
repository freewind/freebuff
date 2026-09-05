import { loadAdvisorConfig } from '@codebuff/freebuff/advisor/advisor-config'
import {
  AdvisorRuntime,
  type AdvisorRunOptions,
} from '@codebuff/freebuff/advisor/advisor-runtime'
import type { RunState } from '@codebuff/sdk'

import { logger } from './logger'

/**
 * CLI-side Advisor wiring: lazy singleton runtime plus an indirect abort
 * handler. use-send-message registers the active run's abort/requeue handler
 * per send (setAdvisorInterruptHandler) so the cached AdvisorRuntime's
 * onAbortRequested always targets the current run without rebuilding the
 * runtime on every render.
 */

let cachedRuntime: AdvisorRuntime | null | undefined
let interruptHandler: (() => void) | null = null

/** Registers the active run's interrupt handler (abort + requeue opinions). */
export function setAdvisorInterruptHandler(fn: (() => void) | null): void {
  interruptHandler = fn
}

export interface EnsureAdvisorRuntimeDeps {
  /** Config dir override (tests); defaults to the Freebuff config dir. */
  configDir?: string
  /** Executes the advisor's review run (client.run equivalent). */
  run: (options: AdvisorRunOptions) => Promise<RunState>
}

/**
 * Lazily loads advisor.yml and builds the AdvisorRuntime once. Missing or
 * invalid config disables the advisor (warn logged, null returned) — never
 * affects the main flow.
 */
export function ensureAdvisorRuntime(
  deps: EnsureAdvisorRuntimeDeps,
): AdvisorRuntime | null {
  if (cachedRuntime !== undefined) return cachedRuntime

  const { config, error } = loadAdvisorConfig({ configDir: deps.configDir })
  if (error) {
    logger.warn({}, `[advisor] ${error}`)
  }
  if (!config) {
    cachedRuntime = null
    return null
  }

  cachedRuntime = new AdvisorRuntime({
    config,
    run: deps.run,
    onAbortRequested: () => interruptHandler?.(),
  })
  return cachedRuntime
}

/** Test seam. */
export function resetAdvisorWiringForTests(): void {
  cachedRuntime = undefined
  interruptHandler = null
}
