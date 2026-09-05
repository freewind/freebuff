import type { Message } from '@codebuff/common/types/messages/codebuff-message'
import type { CodebuffClientOptions, RunOptions, RunState } from '@codebuff/sdk'
import type { AgentOutput } from '@codebuff/common/types/session-state'

import { ADVISOR_AGENT_ID, buildAdvisorAgentDefinition } from './advisor-agent'
import type { AdvisorConfig } from './advisor-config'
import { ADVISOR_TAG, computeTranscriptDiff } from './transcript-diff'

/** Options accepted by a Freebuff run (RunOptions + client-level options). */
export type AdvisorRunOptions = RunOptions & CodebuffClientOptions

/** Dependencies for the Advisor runtime. `run` is injected for testability. */
export interface AdvisorRuntimeDeps {
  config: AdvisorConfig
  /** Executes the advisor's review run (client.run equivalent). */
  run: (options: AdvisorRunOptions) => Promise<RunState>
}

/**
 * Advisor side-channel runtime (non-interrupting delivery).
 *
 * On each main-agent turn end, computes the transcript delta since the last
 * review, runs the advisor (independent agent definition on the same client
 * stack, read-only by default), and queues the produced opinion for delivery
 * at the next agent step boundary (via drainOpinions → drainSteeringMessages).
 *
 * Loop prevention:
 * 1. `lastAdvisorIndex` advances to the history length BEFORE the opinion is
 *    queued, so the injected opinion lands outside the next diff window.
 * 2. Opinions are delivered as messages tagged `ADVISOR` (makeAdvisorMessage),
 *    which transcript-diff filters regardless of window position.
 */
export class AdvisorRuntime {
  #config: AdvisorConfig
  #run: (options: AdvisorRunOptions) => Promise<RunState>
  #lastAdvisorIndex = 0
  #pendingOpinions: string[] = []

  constructor(deps: AdvisorRuntimeDeps) {
    this.#config = deps.config
    this.#run = deps.run
  }

  /**
   * Called after a main-agent turn finishes. Reviews the transcript delta
   * (if any) and queues the advisor's opinion. Never throws: an advisor
   * failure is swallowed so the main flow is never blocked.
   */
  async onTurnEnd(history: Message[]): Promise<void> {
    const diff = computeTranscriptDiff(history, this.#lastAdvisorIndex)
    // Loop-prevention layer 1: advance the baseline before the opinion can
    // be injected, keeping it outside the next diff window.
    this.#lastAdvisorIndex = diff.nextIndex

    if (diff.messages.length === 0) return

    const opinion = await this.#runAdvisor(diff.messages)
    if (opinion) {
      this.#pendingOpinions.push(opinion)
    }
  }

  /** Returns and clears the opinions queued for the next step boundary. */
  drainOpinions(): string[] {
    return this.#pendingOpinions.splice(0)
  }

  /** Builds a user message tagged ADVISOR for loop-prevention filtering. */
  makeAdvisorMessage(text: string): Message {
    return {
      role: 'user',
      content: [{ type: 'text', text }],
      tags: [ADVISOR_TAG],
    } as Message
  }

  async #runAdvisor(messages: Message[]): Promise<string | null> {
    const definition = buildAdvisorAgentDefinition(this.#config)
    const prompt = serializeTranscript(messages)
    if (!prompt) return null

    try {
      const state = await this.#run({
        agent: ADVISOR_AGENT_ID,
        agentDefinitions: [definition],
        prompt,
      })
      return extractOpinion(state.output)
    } catch {
      // Advisor failures are side-channel noise: never surface them into the
      // main agent flow.
      return null
    }
  }
}

/** Extracts the advisor's written opinion from a run's AgentOutput. */
export function extractOpinion(output: AgentOutput | undefined): string | null {
  if (!output) return null
  if (output.type === 'error') return null
  if (output.type === 'structuredOutput') {
    // The advisor uses plain last-message output; structured output is not
    // part of phase 1.
    return null
  }
  // lastMessage / allMessages: value is the final turn's messages; take the
  // last assistant text content.
  for (const message of [...output.value].reverse()) {
    if (!message || (message as { role?: unknown }).role !== 'assistant')
      continue
    const content = (message as { content?: unknown }).content
    if (!Array.isArray(content)) continue
    const texts = content
      .filter(
        (part): part is { type: 'text'; text: string } =>
          typeof part === 'object' &&
          part !== null &&
          (part as { type?: unknown }).type === 'text' &&
          typeof (part as { text?: unknown }).text === 'string',
      )
      .map((part) => part.text)
    const opinion = texts.join(' ').trim()
    if (opinion) return opinion
  }
  return null
}

/** Serializes the delta messages into a compact review prompt. */
export function serializeTranscript(messages: Message[]): string {
  const parts: string[] = []
  for (const message of messages) {
    const text = extractText(message)
    if (!text) continue
    const role =
      message.role === 'tool'
        ? 'tool'
        : message.role === 'assistant'
          ? 'assistant'
          : 'user'
    parts.push(`${role}: ${text}`)
  }
  return parts.join('\n\n')
}

function extractText(message: Message): string {
  if (message.role === 'tool') {
    return `[${message.toolName}] ${JSON.stringify(message.content)}`
  }
  const texts: string[] = []
  for (const part of message.content) {
    if (part.type === 'text') texts.push(part.text)
    if (part.type === 'tool-call') texts.push(`[tool_call ${part.toolName}]`)
    if (part.type === 'reasoning') texts.push(`[reasoning]`)
  }
  return texts.join(' ')
}
