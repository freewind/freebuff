import type { Message } from '@codebuff/common/types/messages/codebuff-message'

/**
 * Incremental transcript diffing for the Advisor: only messages added since
 * the last review are handed to the advisor, and Advisor-injected messages
 * are never re-reviewed (loop prevention).
 *
 * Loop prevention is layered:
 * 1. The runtime updates `lastIndex` to the history length BEFORE injecting an
 *    opinion (so the opinion lands outside the next diff window).
 * 2. As a second line of defense, messages tagged `ADVISOR` are filtered out
 *    here regardless of window position.
 */

/** Tag placed on Advisor-injected messages. */
export const ADVISOR_TAG = 'ADVISOR'

/** Whether a message was injected by the Advisor (loop-prevention filter). */
export function isAdvisorMessage(message: Message): boolean {
  return message.tags?.includes(ADVISOR_TAG) ?? false
}

/** Result of computing the transcript delta since the last review. */
export interface TranscriptDiff {
  /** New non-Advisor messages since `lastIndex`. */
  messages: Message[]
  /** History length at the review point (next review starts from here). */
  nextIndex: number
}

/**
 * Computes the message delta since `lastIndex`. `nextIndex` always advances
 * to the current history length (even when Advisor messages were filtered),
 * so later real messages stay covered by the next review. Out-of-range
 * `lastIndex` (e.g. history compaction rewrote the array) degrades to an
 * empty diff rather than an error.
 */
export function computeTranscriptDiff(
  history: Message[],
  lastIndex: number,
): TranscriptDiff {
  const safeLastIndex = Math.max(0, Math.min(lastIndex, history.length))
  const messages = history
    .slice(safeLastIndex)
    .filter((message) => !isAdvisorMessage(message))
  return { messages, nextIndex: history.length }
}
