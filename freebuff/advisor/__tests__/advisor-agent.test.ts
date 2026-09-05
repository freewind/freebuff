import { describe, expect, it } from 'bun:test'

import { ADVISOR_AGENT_ID, buildAdvisorAgentDefinition } from '../advisor-agent'

const baseConfig = {
  name: 'code-guardian',
  model: 'deepseek/deepseek-v4-pro',
  allowedMethods: [] as string[],
  prompt: 'Be critical.',
}

describe('buildAdvisorAgentDefinition', () => {
  it('maps id, name, model, and prompt from the config', () => {
    const definition = buildAdvisorAgentDefinition(baseConfig)
    expect(definition.id).toBe(ADVISOR_AGENT_ID)
    expect(definition.displayName).toBe('code-guardian')
    expect(definition.model).toBe('deepseek/deepseek-v4-pro')
    expect(definition.instructionsPrompt).toBe('Be critical.')
    expect(definition.spawnableAgents).toEqual([])
  })

  it('maps allowedMethods to toolNames', () => {
    const definition = buildAdvisorAgentDefinition({
      ...baseConfig,
      allowedMethods: ['read_files', 'code_search'],
    })
    expect(definition.toolNames).toEqual(['read_files', 'code_search'])
  })

  it('drops unknown method names instead of failing', () => {
    const definition = buildAdvisorAgentDefinition({
      ...baseConfig,
      allowedMethods: ['read_files', 'definitely_not_a_tool'],
    })
    expect(definition.toolNames).toEqual(['read_files'])
  })

  it('defaults to no tools for an empty whitelist (read-only reasoning)', () => {
    const definition = buildAdvisorAgentDefinition(baseConfig)
    expect(definition.toolNames).toEqual([])
  })
})
