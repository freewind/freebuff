import type { AgentDefinition } from '@codebuff/common/templates/initial-agents-dir/types/agent-definition'
import { toolNames } from '@codebuff/common/tools/constants'

import type { AdvisorConfig } from './advisor-config'

/** Agent id the Advisor run uses (passed to client.run via `agent`). */
export const ADVISOR_AGENT_ID = 'advisor'

/**
 * Builds the Advisor's AgentDefinition from a loaded AdvisorConfig.
 *
 * - `toolNames` = config `allowedMethods` intersected with the known tool
 *   name list (unknown names are dropped, not errors — the advisor stays
 *   read-only unless explicitly granted methods).
 * - `model` / `prompt` come from the config (defaults applied at load time).
 * - No `spawnableAgents`: the advisor never spawns further agents.
 */
export function buildAdvisorAgentDefinition(
  config: Pick<AdvisorConfig, 'name' | 'model' | 'allowedMethods' | 'prompt'>,
): AgentDefinition {
  const knownTools = new Set<string>(toolNames)
  return {
    id: ADVISOR_AGENT_ID,
    displayName: config.name,
    model: config.model,
    toolNames: config.allowedMethods.filter((name) => knownTools.has(name)),
    spawnableAgents: [],
    instructionsPrompt: config.prompt,
  }
}
