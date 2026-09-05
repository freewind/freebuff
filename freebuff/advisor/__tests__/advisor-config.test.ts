import { afterAll, beforeAll, describe, expect, it } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import os from 'os'
import path from 'path'

import { loadAdvisorConfig } from '../advisor-config'

let tempDir: string

beforeAll(() => {
  tempDir = mkdtempSync(path.join(os.tmpdir(), 'advisor-config-'))
})

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true })
})

const configPath = (): string => path.join(tempDir, 'advisor.yml')

function writeConfig(content: string): void {
  writeFileSync(configPath(), content)
}

describe('loadAdvisorConfig', () => {
  it('returns null config when the file is missing', () => {
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.config).toBeNull()
    expect(result.error).toBeNull()
  })

  it('loads a valid single-advisor config', () => {
    writeConfig(
      [
        'name: code-guardian',
        'model: deepseek/deepseek-v4-pro',
        'allowedMethods:',
        '  - read_files',
        '  - code_search',
        'prompt: Be thorough.',
      ].join('\n'),
    )
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.error).toBeNull()
    expect(result.config).toEqual({
      name: 'code-guardian',
      model: 'deepseek/deepseek-v4-pro',
      allowedMethods: ['read_files', 'code_search'],
      prompt: 'Be thorough.',
    })
  })

  it('applies defaults for missing fields', () => {
    writeConfig('name: guard\n')
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.error).toBeNull()
    expect(result.config?.name).toBe('guard')
    expect(result.config?.model).toBeTruthy() // default Freebuff model
    expect(result.config?.allowedMethods).toEqual([])
    expect(result.config?.prompt).toBeTruthy() // default review prompt
  })

  it('reports invalid YAML syntax', () => {
    writeConfig('name: [unclosed\n')
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.config).toBeNull()
    expect(result.error).toContain('Invalid YAML')
  })

  it('rejects a non-object top-level value (array)', () => {
    writeConfig('- name: a\n- name: b\n')
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.config).toBeNull()
    expect(result.error).toContain('single advisor object')
  })

  it('rejects wrong field types with a field path', () => {
    writeConfig('model: 123\n')
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.config).toBeNull()
    expect(result.error).toContain('model')
  })

  it('rejects empty required fields', () => {
    writeConfig('prompt: ""\n')
    const result = loadAdvisorConfig({ configDir: tempDir })
    expect(result.config).toBeNull()
    expect(result.error).toContain('prompt')
  })
})
