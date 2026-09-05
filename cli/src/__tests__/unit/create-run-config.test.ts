import { describe, test, expect } from 'bun:test'

import { createRunConfig, isSensitiveFile } from '../../utils/create-run-config'
import type { EventHandlerState } from '../../utils/sdk-event-handlers'

const mockLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
} as unknown as Parameters<typeof createRunConfig>[0]['logger']

function baseParams() {
  return {
    logger: mockLogger,
    agent: 'base3-free-deepseek-flash',
    prompt: 'hello',
    content: undefined,
    previousRunState: null,
    agentDefinitions: [],
    eventHandlerState: {} as EventHandlerState,
    signal: new AbortController().signal,
  }
}

describe('createRunConfig', () => {
  test('passes drainSteeringMessages through to the run options', () => {
    const drain = () => ['advisor opinion']
    const config = createRunConfig({
      ...baseParams(),
      drainSteeringMessages: drain,
    })
    expect(config.drainSteeringMessages).toBe(drain)
  })

  test('leaves drainSteeringMessages undefined when not provided', () => {
    const config = createRunConfig(baseParams())
    expect(config.drainSteeringMessages).toBeUndefined()
  })

  test('keeps existing core options intact', () => {
    const config = createRunConfig(baseParams())
    expect(config.agent).toBe('base3-free-deepseek-flash')
    expect(config.prompt).toBe('hello')
    expect(config.previousRun).toBeUndefined()
    expect(typeof config.handleStreamChunk).toBe('function')
    expect(typeof config.handleEvent).toBe('function')
    expect(typeof config.fileFilter).toBe('function')
  })
})

describe('isSensitiveFile', () => {
  test.each([
    // Env files (blocked)
    ['.env', true],
    ['.ENV', true],
    ['.env.local', true],
    ['.env/./', true],
    ['.env ', true],
    ['.env:$DATA', true],
    ['config\\.Env.Production', true],
    ['config/.env.production', true],

    // Env templates (allowed)
    ['.env.example', false],
    ['.ENV.EXAMPLE', false],
    ['.env.sample', false],
    ['.env.template', false],

    // Sensitive extensions
    ['private.pem', true],
    ['server.key', true],
    ['cert.p12', true],
    ['app.keystore', true],
    ['server.crt', true],

    // Sensitive basenames
    ['.htpasswd', true],
    ['.netrc', true],
    ['credentials', true],
    ['.npmrc', true],
    ['.yarnrc.yml', true],
    ['auth.json', true],
    ['terraform.tfvars', true],

    // SSH keys (prefix pattern)
    ['id_rsa', true],
    ['id_ed25519', true],
    ['id_rsa_github', true],
    ['id_rsa.pub', false], // public keys allowed

    // Credentials suffix pattern
    ['aws_credentials', true],
    ['db_credentials', true],

    // Substring patterns
    ['kubeconfig', true],
    ['my-kubeconfig.yaml', true],
    ['terraform.tfstate', true],
    ['prod.tfstate.backup', true],

    // Non-sensitive (should NOT be blocked)
    ['package.json', false],
    ['README.md', false],
    ['src/index.ts', false],
    ['.envrc', false],
    ['credentials.ts', false],
    ['terraform.tf', false],
    ['kube-config.ts', false],
  ])('%s → %s', (file, expected) => {
    expect(isSensitiveFile(file)).toBe(expected)
  })
})
