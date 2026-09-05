import { afterEach, describe, expect, it, mock, spyOn } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

import type { RunState } from '@codebuff/sdk'

import {
  ensureAdvisorRuntime,
  resetAdvisorWiringForTests,
  setAdvisorInterruptHandler,
} from '../../utils/advisor-wiring'
import { logger } from '../../utils/logger'

let tempDir: string

function makeTempDir(): void {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'advisor-wiring-'))
}

afterEach(() => {
  resetAdvisorWiringForTests()
  if (tempDir) {
    rmSync(tempDir, { recursive: true, force: true })
    tempDir = ''
  }
})

const run = mock(async () => ({}) as RunState)

const writeConfig = (content: string): void => {
  writeFileSync(path.join(tempDir, 'advisor.yml'), content)
}

describe('ensureAdvisorRuntime', () => {
  it('returns null when no advisor.yml exists', () => {
    makeTempDir()
    expect(ensureAdvisorRuntime({ configDir: tempDir, run })).toBeNull()
  })

  it('returns null and warns on an invalid config', () => {
    makeTempDir()
    writeConfig('name: [broken\n')
    const warn = spyOn(logger, 'warn')
    expect(ensureAdvisorRuntime({ configDir: tempDir, run })).toBeNull()
    expect(warn).toHaveBeenCalled()
  })

  it('builds a runtime once and caches it', () => {
    makeTempDir()
    writeConfig('name: guard\n')
    const first = ensureAdvisorRuntime({ configDir: tempDir, run })
    const second = ensureAdvisorRuntime({ configDir: tempDir, run })
    expect(first).not.toBeNull()
    expect(second).toBe(first)
  })

  it('re-evaluates after reset', () => {
    makeTempDir()
    writeConfig('name: guard\n')
    const first = ensureAdvisorRuntime({ configDir: tempDir, run })
    resetAdvisorWiringForTests()
    const second = ensureAdvisorRuntime({ configDir: tempDir, run })
    expect(second).not.toBeNull()
    expect(second).not.toBe(first)
  })
})

describe('setAdvisorInterruptHandler', () => {
  it('routes AdvisorRuntime.onAbortRequested to the registered handler', () => {
    makeTempDir()
    writeConfig('name: guard\n')
    const runtime = ensureAdvisorRuntime({ configDir: tempDir, run })
    expect(runtime).not.toBeNull()

    const handled: string[] = []
    setAdvisorInterruptHandler(() => {
      handled.push('aborted')
    })

    runtime?.interrupt('stop now')
    expect(handled).toEqual(['aborted'])
    expect(runtime?.drainInterruptOpinions()).toEqual(['stop now'])
  })

  it('clears the handler with null', () => {
    makeTempDir()
    writeConfig('name: guard\n')
    const runtime = ensureAdvisorRuntime({ configDir: tempDir, run })

    setAdvisorInterruptHandler(() => {
      throw new Error('should not be called')
    })
    setAdvisorInterruptHandler(null)
    runtime?.interrupt('opinion')
    expect(runtime?.drainInterruptOpinions()).toEqual(['opinion'])
  })
})
