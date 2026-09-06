import { existsSync, readFileSync } from 'fs'
import os from 'os'
import path from 'path'

/**
 * Shared Freebuff config-directory helpers (ACP server, Advisor, and future
 * headless surfaces all resolve the same user config dir and credentials).
 */

/** Freebuff config dir: ~/.config/manicode[-<env>] (env != prod). */
export function getConfigDir(): string {
  const env = process.env.NEXT_PUBLIC_CB_ENVIRONMENT
  const suffix = env && env !== 'prod' ? `-${env}` : ''
  return path.join(os.homedir(), '.config', `manicode${suffix}`)
}

/** Credentials persisted by the Freebuff login flow (credentials.json). */
export interface StoredCredentials {
  authToken?: string
  fingerprintId?: string
}

export function loadCredentials(): StoredCredentials | null {
  try {
    const file = path.join(getConfigDir(), 'credentials.json')
    if (!existsSync(file)) return null
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf8'))
    if (typeof parsed !== 'object' || parsed === null) return null
    const entry = (parsed as Record<string, unknown>).default
    if (typeof entry !== 'object' || entry === null) return null
    const credentials = entry as Record<string, unknown>
    return {
      authToken:
        typeof credentials.authToken === 'string'
          ? credentials.authToken
          : undefined,
      fingerprintId:
        typeof credentials.fingerprintId === 'string'
          ? credentials.fingerprintId
          : undefined,
    }
  } catch {
    return null
  }
}
