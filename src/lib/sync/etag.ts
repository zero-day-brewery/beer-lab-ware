/**
 * Shared ETag / If-Match wire-protocol constants for the Track B full-state sync
 * protocol's optimistic-concurrency layer. Isomorphic — imported by BOTH the
 * Node-only sync daemon (`src/lib/node/sync-server.ts`) and the browser-safe
 * transport (`src/lib/sync/transport.ts`), so the wire-level sentinel can never
 * drift between client and server. No Node/DOM-specific imports — safe in either
 * bundle.
 */

/**
 * The well-known ETag value `GET /state` returns — and `PUT /state` accepts as
 * `If-Match` — when the canonical store is EMPTY (nothing written yet). This is
 * the "first-ever PUT" bootstrap case: a client that saw an empty store echoes
 * this sentinel back as its precondition, so a bootstrap race (two devices both
 * seeing empty, both trying to be "first") is rejected exactly like any other
 * stale-precondition race — one wins 200, the other 412.
 *
 * Deliberately NOT RFC 7232's `If-Match: *` wildcard: that means "match ANY
 * current representation" (i.e. "the resource must already exist"), which is
 * the opposite of what an empty-store bootstrap needs, and — more importantly —
 * `*` unconditionally matches for EVERY caller, so two racing first-writers
 * would BOTH pass and the second would silently clobber the first, reintroducing
 * the exact lost-update bug this protocol exists to close. A concrete sentinel
 * value participates in the normal equality-based precondition check like any
 * other ETag, so the mutex-guarded compare-and-write in `sync-server.ts` closes
 * the race for the bootstrap case too, with no special-cased logic.
 *
 * Trivially distinguishable from a real content ETag: a strong content ETag is
 * always a quoted 64-char lowercase-hex sha256 digest; this is a quoted literal
 * that can never look like one.
 */
export const EMPTY_ETAG_SENTINEL = '"empty"'
