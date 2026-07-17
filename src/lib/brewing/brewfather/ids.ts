import { v5 as uuidv5 } from 'uuid'

/**
 * Dedicated uuidv5 namespace for ids derived from Brewfather exports. Minted
 * once (2026-07-17) and FROZEN — changing it would break re-import idempotency
 * for everyone who has already migrated. Not shared with any other subsystem.
 */
export const BREWFATHER_NAMESPACE = '286971fb-e7d7-42d1-9e29-1903917c70ec'

/**
 * Deterministic app id for a Brewfather entity: the same `kind` + `key`
 * (normally the Brewfather `_id`) always yields the same uuid, so re-importing
 * the same export can never duplicate rows — the second pass sees the row
 * already exists and skips it.
 */
export function brewfatherId(kind: string, key: string): string {
  return uuidv5(`${kind}:${key}`, BREWFATHER_NAMESPACE)
}
