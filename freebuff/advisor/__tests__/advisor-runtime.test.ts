import { describe, expect, it, mock } from 'bun:test'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type { RunState } from '@codebuff/sdk'

import { ADVISOR_AGENT_ID, buildAdvisorAgentDefinition } from '../advisor-agent'
import {
  AdvisorRuntime,
  extractInterruptText,
  isInterruptOpinion,
  serializeTranscript,
  type AdvisorRunOptions,
} from '../advisor-runtime'
import { ADVISOR_TAG } from '../transcript-diff'

type MockRun = (options: AdvisorRunOptions) => Promise<RunState>

const CONFIG = {
  name: 'guard',
  model: 'deepseek/deepseek-v4-pro',
  allowedMethods: [] as string[],
  prompt: 'Be critical.',
}

const SUCCESS_STATE = {
  output: {
    type: 'lastMessage',
    value: [
      {
        role: 'assistant',
        content: [{ type: 'text', text: 'review opinion' }],
      },
    ],
  },
} as unknown as RunState

function textMessage(
  role: Message['role'],
  text: string,
  tags?: string[],
  toolName?: string,
): Message {
  return {
    role,
    ...(role === 'tool' && toolName ? { toolName, toolCallId: 'tc-1' } : {}),
    content: [{ type: 'text', text }],
    ...(tags ? { tags } : {}),
  } as Message
}

function makeRuntime(run: MockRun): {
  runtime: AdvisorRuntime
  runMock: ReturnType<typeof mock<MockRun>>
} {
  const runMock = mock<MockRun>(run)
  const runtime = new AdvisorRuntime({ config: CONFIG, run: runMock })
  return { runtime, runMock }
}

describe('serializeTranscript', () => {
  it('prefixes roles and skips empty parts', () => {
    const text = serializeTranscript([
      textMessage('user', 'hello'),
      textMessage('assistant', 'hi'),
      textMessage('tool', 'x', ['TOOL_RESULT'], 'read_files'),
    ])
    expect(text).toContain('user: hello')
    expect(text).toContain('assistant: hi')
    expect(text).toContain('tool: [read_files]')
  })
})

describe('AdvisorRuntime.onTurnEnd', () => {
  it('runs the advisor on the delta and queues the opinion', async () => {
    const { runtime, runMock } = makeRuntime(async () => SUCCESS_STATE)
    await runtime.onTurnEnd([textMessage('user', 'u1')])

    expect(runMock).toHaveBeenCalledTimes(1)
    const options = runMock.mock.calls[0][0]
    expect(options.agent).toBe(ADVISOR_AGENT_ID)
    expect(options.agentDefinitions?.[0]).toMatchObject({
      id: 'advisor',
      model: 'deepseek/deepseek-v4-pro',
      instructionsPrompt: 'Be critical.',
    })
    expect(options.prompt).toContain('user: u1')

    expect(runtime.drainOpinions()).toEqual(['review opinion'])
    expect(runtime.drainOpinions()).toEqual([])
  })

  it('does not run the advisor on an empty delta', async () => {
    const { runtime, runMock } = makeRuntime(async () => SUCCESS_STATE)
    await runtime.onTurnEnd([])
    expect(runMock).not.toHaveBeenCalled()
    expect(runtime.drainOpinions()).toEqual([])
  })

  it('reviews only the delta since the last turn end', async () => {
    const { runtime, runMock } = makeRuntime(async () => SUCCESS_STATE)
    await runtime.onTurnEnd([
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
    ])
    await runtime.onTurnEnd([
      textMessage('user', 'u1'),
      textMessage('assistant', 'a1'),
      textMessage('user', 'u2'),
    ])

    expect(runMock).toHaveBeenCalledTimes(2)
    expect(runMock.mock.calls[1][0].prompt).toContain('u2')
    expect(runMock.mock.calls[1][0].prompt).not.toContain('u1')
  })

  it('never re-reviews advisor-injected messages (loop prevention)', async () => {
    const { runtime, runMock } = makeRuntime(async () => SUCCESS_STATE)
    await runtime.onTurnEnd([textMessage('user', 'u1')])
    // The queued opinion (simulating injection before the next turn end) and
    // a real follow-up message.
    await runtime.onTurnEnd([
      textMessage('user', 'u1'),
      textMessage('user', 'opinion from advisor', [ADVISOR_TAG]),
      textMessage('assistant', 'real reply'),
    ])

    const secondPrompt = runMock.mock.calls[1][0].prompt
    expect(secondPrompt).toContain('real reply')
    expect(secondPrompt).not.toContain('opinion from advisor')
  })

  it('advances the baseline before queueing, so the opinion is not diffed again', async () => {
    const { runtime, runMock } = makeRuntime(async () => SUCCESS_STATE)
    const history: Message[] = [textMessage('user', 'u1')]
    await runtime.onTurnEnd(history)
    // Inject the opinion (tagged) as if drained at the next step boundary.
    history.push(runtime.makeAdvisorMessage('injected opinion'))
    // Next turn adds one real message.
    history.push(textMessage('assistant', 'a2'))
    await runtime.onTurnEnd(history)

    expect(runMock.mock.calls[1][0].prompt).toContain('a2')
    expect(runMock.mock.calls[1][0].prompt).not.toContain('injected opinion')
  })

  it('swallows advisor run failures', async () => {
    const { runtime, runMock } = makeRuntime(async () => {
      throw new Error('advisor boom')
    })
    await expect(
      runtime.onTurnEnd([textMessage('user', 'u1')]),
    ).resolves.toBeUndefined()
    expect(runMock).toHaveBeenCalledTimes(1)
    expect(runtime.drainOpinions()).toEqual([])
  })

  it('ignores empty or error advisor output', async () => {
    const { runtime } = makeRuntime(
      async () =>
        ({
          output: { type: 'error', message: 'nope' },
        }) as unknown as RunState,
    )
    await runtime.onTurnEnd([textMessage('user', 'u1')])
    expect(runtime.drainOpinions()).toEqual([])
  })
})

describe('AdvisorRuntime interrupt channel', () => {
  it('interrupt() aborts via callback and queues an interrupting opinion', () => {
    const aborts: number[] = []
    const runtime = new AdvisorRuntime({
      config: CONFIG,
      run: async () => SUCCESS_STATE,
      onAbortRequested: () => aborts.push(1),
    })

    runtime.interrupt('URGENT: check this')

    expect(aborts).toHaveLength(1)
    expect(runtime.drainInterruptOpinions()).toEqual(['URGENT: check this'])
    expect(runtime.drainOpinions()).toEqual([])
  })

  it('interrupt() is safe without an abort callback', () => {
    const runtime = new AdvisorRuntime({
      config: CONFIG,
      run: async () => SUCCESS_STATE,
    })
    runtime.interrupt('opinion')
    expect(runtime.drainInterruptOpinions()).toEqual(['opinion'])
  })

  it('ignores empty interrupt opinions', () => {
    const aborts: number[] = []
    const runtime = new AdvisorRuntime({
      config: CONFIG,
      run: async () => SUCCESS_STATE,
      onAbortRequested: () => aborts.push(1),
    })
    runtime.interrupt('   ')
    expect(aborts).toHaveLength(0)
    expect(runtime.drainInterruptOpinions()).toEqual([])
  })

  it('escalates advisor output with the INTERRUPT: prefix and strips it', async () => {
    const aborts: number[] = []
    const runtime = new AdvisorRuntime({
      config: CONFIG,
      run: async () =>
        ({
          output: {
            type: 'lastMessage',
            value: [
              {
                role: 'assistant',
                content: [{ type: 'text', text: 'INTERRUPT: stop now' }],
              },
            ],
          },
        }) as unknown as RunState,
      onAbortRequested: () => aborts.push(1),
    })

    await runtime.onTurnEnd([textMessage('user', 'u1')])

    expect(aborts).toHaveLength(1)
    expect(runtime.drainInterruptOpinions()).toEqual(['stop now'])
    expect(runtime.drainOpinions()).toEqual([])
  })

  it('keeps normal opinions out of the interrupt queue and vice versa', async () => {
    const runtime = new AdvisorRuntime({
      config: CONFIG,
      run: async () => SUCCESS_STATE,
    })
    await runtime.onTurnEnd([textMessage('user', 'u1')]) // normal opinion queued
    runtime.interrupt('interrupting opinion')

    expect(runtime.drainInterruptOpinions()).toEqual(['interrupting opinion'])
    expect(runtime.drainOpinions()).toEqual(['review opinion'])
  })

  it('parses interrupt prefix helpers', () => {
    expect(isInterruptOpinion('INTERRUPT: stop')).toBe(true)
    expect(isInterruptOpinion('  INTERRUPT:  stop  ')).toBe(true)
    expect(isInterruptOpinion('regular opinion')).toBe(false)
    expect(extractInterruptText('INTERRUPT: stop now')).toBe('stop now')
    expect(extractInterruptText('  INTERRUPT:  stop  ')).toBe('stop')
  })
})

describe('buildAdvisorAgentDefinition round-trip', () => {
  it('builds the same definition the runtime passes to the run', () => {
    const definition = buildAdvisorAgentDefinition(CONFIG)
    expect(definition.id).toBe('advisor')
    expect(definition.spawnableAgents).toEqual([])
  })
})
