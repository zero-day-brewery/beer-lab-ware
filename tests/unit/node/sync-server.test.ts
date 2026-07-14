/**
 * Track B sync daemon — GET/PUT /state contract, auth, validation, round-trip.
 *
 * Drives a real http.Server on an ephemeral 127.0.0.1 port with fetch, matching
 * what the in-app HttpSyncTransport does. Confirms: mandatory Bearer auth on both
 * methods; 204-when-empty / 200-with-verbatim-body round-trip (meta preserved);
 * 400 on bad JSON / bad envelope / ledger violation; 404 off-route.
 */

import { mkdtemp } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createSyncServer, sha256Hex } from '@/lib/node/sync-server'
import { fixtureCollections } from '../../fixtures/node/brewery-fixture'

const TOKEN = 'device-token-abc123'
const OTHER = 'not-the-token'

function validDump() {
  return {
    version: 8 as const,
    exportedAt: '2026-07-09T00:00:00.000Z',
    meta: { dumpVersion: 8, dbVersion: 8, rowCounts: {}, schemaVersion: 1 as const },
    tables: fixtureCollections(),
  }
}

describe('sync-server /state', () => {
  let server: Server
  let base: string
  let filePath: string

  beforeEach(async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sync-server-'))
    filePath = join(dir, 'brewery.json')
    server = createSyncServer({ filePath, tokenHashes: new Set([sha256Hex(TOKEN)]) })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const { port } = server.address() as AddressInfo
    base = `http://127.0.0.1:${port}`
  })

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  const auth = (t = TOKEN) => ({ authorization: `Bearer ${t}`, 'content-type': 'application/json' })

  it('rejects a missing token with 401 on GET and PUT', async () => {
    expect((await fetch(`${base}/state`)).status).toBe(401)
    const put = await fetch(`${base}/state`, { method: 'PUT', body: '{}' })
    expect(put.status).toBe(401)
  })

  it('rejects a wrong token with 401', async () => {
    expect((await fetch(`${base}/state`, { headers: auth(OTHER) })).status).toBe(401)
  })

  it('returns 204 when no canonical state exists yet', async () => {
    const res = await fetch(`${base}/state`, { headers: auth() })
    expect(res.status).toBe(204)
  })

  it('PUT then GET round-trips the DumpV8 verbatim (meta preserved)', async () => {
    const dump = validDump()
    const put = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(dump),
    })
    expect(put.status).toBe(200)

    const get = await fetch(`${base}/state`, { headers: auth() })
    expect(get.status).toBe(200)
    const body = await get.json()
    expect(body.version).toBe(8)
    expect(body.meta).toEqual(dump.meta)
    expect(body.tables.recipes).toHaveLength(dump.tables.recipes.length)
  })

  it('rejects invalid JSON with 400', async () => {
    const res = await fetch(`${base}/state`, { method: 'PUT', headers: auth(), body: 'not json' })
    expect(res.status).toBe(400)
  })

  it('rejects an unsupported envelope version with 400', async () => {
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify({ version: 99, tables: {} }),
    })
    expect(res.status).toBe(400)
  })

  it('rejects a ledger-invariant violation with 400', async () => {
    const dump = validDump()
    dump.tables.inventoryItems[0] = { ...dump.tables.inventoryItems[0], amount: 999 }
    const res = await fetch(`${base}/state`, {
      method: 'PUT',
      headers: auth(),
      body: JSON.stringify(dump),
    })
    expect(res.status).toBe(400)
  })

  it('404s any path other than /state', async () => {
    const res = await fetch(`${base}/nope`, { headers: auth() })
    expect(res.status).toBe(404)
  })

  it('405s an unsupported method on /state', async () => {
    const res = await fetch(`${base}/state`, { method: 'DELETE', headers: auth() })
    expect(res.status).toBe(405)
  })
})
