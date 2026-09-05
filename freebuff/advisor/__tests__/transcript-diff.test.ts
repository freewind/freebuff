import { describe, expect, it } from 'bun:test'
import type { Message } from '@codebuff/common/types/messages/codebuff-message'

import {
  ADVISOR_TAG,
  computeTranscriptDiff,
  isAdvisorMessage,
} from '../transcript-diff'

function message(
  role: Message['role'],
  text: string,
  tags?: string[],
): Message {
  return {
    role,
    content: [{ type: 'text', text }],
    ...(tags ? { tags } : {}),
  } as Message
}

const history: Message[] = [
  message('user', 'u1'),
  message('assistant', 'a1'),
  message('tool', 't1', ['TOOL_RESULT']),
  message('assistant', 'a2'),
  message('user', 'u2'),
]

describe('isAdvisorMessage', () => {
  it('detects the ADVISOR tag', () => {
    expect(isAdvisorMessage(message('user', 'x', [ADVISOR_TAG]))).toBe(true)
    expect(isAdvisorMessage(message('user', 'x', ['STEP_PROMPT']))).toBe(false)
    expect(isAdvisorMessage(message('user', 'x'))).toBe(false)
  })
})

describe('computeTranscriptDiff', () => {
  it('returns the slice since lastIndex and advances the index', () => {
    const diff = computeTranscriptDiff(history, 3)
    expect(diff.messages).toEqual([history[3], history[4]])
    expect(diff.nextIndex).toBe(5)
  })

  it('returns everything for lastIndex 0 and empty for lastIndex at end', () => {
    expect(computeTranscriptDiff(history, 0).messages).toEqual(history)
    expect(computeTranscriptDiff(history, 5).messages).toEqual([])
  })

  it('returns an empty diff for an empty history', () => {
    const diff = computeTranscriptDiff([], 0)
    expect(diff.messages).toEqual([])
    expect(diff.nextIndex).toBe(0)
  })

  it('filters Advisor-tagged messages out of the delta', () => {
    const withAdvisor = [
      ...history,
      message('user', 'advisor opinion', [ADVISOR_TAG]),
    ]
    const diff = computeTranscriptDiff(withAdvisor, 5)
    expect(diff.messages).toEqual([])
    expect(diff.nextIndex).toBe(6)
  })

  it('keeps real messages after an Advisor message and advances past both', () => {
    const withAdvisor = [
      ...history,
      message('user', 'advisor opinion', [ADVISOR_TAG]),
      message('assistant', 'reply'),
    ]
    const diff = computeTranscriptDiff(withAdvisor, 5)
    expect(diff.messages).toEqual([withAdvisor[6]])
    expect(diff.nextIndex).toBe(7)
  })

  it('degrades safely when lastIndex is out of range (compacted history)', () => {
    expect(computeTranscriptDiff(history, 99).messages).toEqual([])
    expect(computeTranscriptDiff(history, 99).nextIndex).toBe(5)
    expect(computeTranscriptDiff(history, -1).messages).toEqual(history)
    expect(computeTranscriptDiff(history, -1).nextIndex).toBe(5)
  })
})
