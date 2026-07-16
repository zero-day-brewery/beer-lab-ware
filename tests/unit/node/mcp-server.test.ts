/**
 * Terminal/MCP Stage B — the MCP stdio server (no browser, no real stdio).
 *
 * Two layers are proven here:
 *   1. The tool-mapping layer (`buildMcpTools`) over a fixture-file adapter:
 *      engine read tools map 1:1 (readOnlyHint); propose tools re-expose under
 *      their MUTATING names with a MUTATES-flagged description (destructiveHint);
 *      a read handler returns real data; a write handler commits through
 *      `applyAction` and PERSISTS to the file (a fresh `loadBrewery` reflects it).
 *   2. An in-process smoke: a real MCP {@link Server} + {@link Client} over a
 *      linked in-memory transport handle `tools/list` and `tools/call` for a READ,
 *      a WRITE (persisted), and an UNKNOWN tool (isError) — the same JSON-RPC path
 *      a stdio client uses.
 */

import * as fs from 'node:fs/promises'
import * as os from 'node:os'
import * as path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { loadBrewery, openBrewery } from '@/lib/node'
import { buildMcpTools, createBreweryMcpServer, isReadOnlyModeEnv } from '@/lib/node/mcp-server'
import {
  BATCH_ID,
  fixtureEnvelope,
  INV_ID,
  NOW,
  RECIPE_ID,
} from '../../fixtures/node/brewery-fixture'

let dir: string
let file: string

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'mcp-server-'))
  file = path.join(dir, 'brewery.json')
  await fs.writeFile(file, JSON.stringify(fixtureEnvelope(), null, 2), 'utf8')
})

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true })
})

/** Extract the concatenated text content of an MCP CallTool result. */
function resultText(res: { content: Array<{ type: string; text?: string }> }): string {
  return res.content
    .filter((c) => c.type === 'text')
    .map((c) => c.text ?? '')
    .join('\n')
}

describe('MCP tool-mapping layer (buildMcpTools)', () => {
  it('maps read tools 1:1 and re-exposes propose tools as MUTATING writes', async () => {
    const adapter = await openBrewery(file, { now: () => NOW })
    const { tools, handlers } = buildMcpTools(adapter)

    const names = tools.map((t) => t.name)
    // 11 read tools + 4 write tools, every one has a handler + an object schema.
    expect(tools).toHaveLength(15)
    expect(handlers.size).toBe(15)
    for (const t of tools) expect(t.inputSchema).toMatchObject({ type: 'object' })

    // Reads keep their engine names + are annotated read-only.
    expect(names).toContain('list_recipes')
    expect(names).toContain('get_recipe')
    const read = tools.find((t) => t.name === 'list_recipes')
    expect(read?.annotations?.readOnlyHint).toBe(true)

    // Propose tools drop the `propose_` prefix and are flagged mutating.
    expect(names).toContain('scale_recipe')
    expect(names).toContain('adjust_inventory')
    expect(names).not.toContain('propose_scale_recipe')
    const write = tools.find((t) => t.name === 'adjust_inventory')
    expect(write?.annotations?.destructiveHint).toBe(true)
    expect(write?.annotations?.readOnlyHint).toBe(false)
    expect(write?.description).toMatch(/MUTATES brewery\.json/)
  })

  it('a read handler returns real data through the mapping', async () => {
    const adapter = await openBrewery(file, { now: () => NOW })
    const { handlers } = buildMcpTools(adapter)
    const res = await handlers.get('list_recipes')?.({})
    expect(res?.isError).toBeFalsy()
    const data = JSON.parse(resultText(res as never)) as Array<{ id: string; name: string }>
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({ id: RECIPE_ID, name: 'SMaSH Pale' })
  })

  it('a write handler commits via applyAction AND persists to the file', async () => {
    const adapter = await openBrewery(file, { now: () => NOW })
    const { handlers } = buildMcpTools(adapter)

    const res = await handlers.get('adjust_inventory')?.({ inventoryItemId: INV_ID, delta: -12 })
    expect(res?.isError).toBeFalsy()
    const summary = JSON.parse(resultText(res as never)) as {
      applied: boolean
      action: string
      result: { kind: string; newAmount: number }
    }
    expect(summary.applied).toBe(true)
    expect(summary.action).toBe('adjust_inventory')
    expect(summary.result).toMatchObject({ kind: 'inventory', newAmount: 38 })

    // A fresh, independent load sees the mutation persisted to disk.
    const reloaded = await loadBrewery(file)
    const item = reloaded.inventoryItems.find((i) => i.id === INV_ID)
    expect(item?.amount).toBe(38)
    // Ledger invariant: amount === Σ deltas (opening +50, adjust −12).
    const sum = reloaded.stockTransactions
      .filter((t) => t.inventoryItemId === INV_ID)
      .reduce((s, t) => s + t.delta, 0)
    expect(sum).toBe(38)
  })

  it('a failing write returns an isError result and writes NOTHING', async () => {
    const adapter = await openBrewery(file, { now: () => NOW })
    const { handlers } = buildMcpTools(adapter)
    // Unknown inventory item → propose tool throws → isError, file untouched.
    const res = await handlers.get('adjust_inventory')?.({
      inventoryItemId: '00000000-0000-4000-8000-000000000000',
      delta: -5,
    })
    expect(res?.isError).toBe(true)
    expect(resultText(res as never)).toMatch(/adjust_inventory failed/)

    const reloaded = await loadBrewery(file)
    expect(reloaded.inventoryItems.find((i) => i.id === INV_ID)?.amount).toBe(50)
    expect(reloaded.stockTransactions).toHaveLength(1)
  })

  it('MCP_READ_ONLY mode: the 4 write tools are not built at all', async () => {
    const adapter = await openBrewery(file, { now: () => NOW })
    const { tools, handlers } = buildMcpTools(adapter, { readOnly: true })

    const names = tools.map((t) => t.name)
    // 11 read tools, 0 write tools — every one still has a handler.
    expect(tools).toHaveLength(11)
    expect(handlers.size).toBe(11)
    expect(names).toContain('list_recipes')
    expect(names).toContain('get_recipe')
    for (const writeName of ['scale_recipe', 'create_recipe', 'log_reading', 'adjust_inventory']) {
      expect(names).not.toContain(writeName)
      expect(handlers.has(writeName)).toBe(false)
    }
  })

  it('default mode (readOnly omitted/false) is unchanged: writes still register', async () => {
    const adapter = await openBrewery(file, { now: () => NOW })
    expect(buildMcpTools(adapter).tools).toHaveLength(15)
    expect(buildMcpTools(adapter, { readOnly: false }).tools).toHaveLength(15)
  })
})

describe('isReadOnlyModeEnv', () => {
  it('is true for "1" and "true" (case-insensitive), false otherwise', () => {
    expect(isReadOnlyModeEnv({ MCP_READ_ONLY: '1' })).toBe(true)
    expect(isReadOnlyModeEnv({ MCP_READ_ONLY: 'true' })).toBe(true)
    expect(isReadOnlyModeEnv({ MCP_READ_ONLY: 'TRUE' })).toBe(true)
    expect(isReadOnlyModeEnv({ MCP_READ_ONLY: ' true ' })).toBe(true)
    expect(isReadOnlyModeEnv({ MCP_READ_ONLY: '0' })).toBe(false)
    expect(isReadOnlyModeEnv({ MCP_READ_ONLY: 'false' })).toBe(false)
    expect(isReadOnlyModeEnv({})).toBe(false)
  })
})

describe('MCP server smoke — real Server + Client over an in-memory transport', () => {
  async function connectClient(
    filePath: string,
    opts: { readOnly?: boolean } = {},
  ): Promise<Client> {
    const adapter = await openBrewery(filePath, { now: () => NOW })
    const server = createBreweryMcpServer(adapter, opts)
    const [clientT, serverT] = InMemoryTransport.createLinkedPair()
    const client = new Client({ name: 'test-client', version: '0.0.0' })
    await Promise.all([server.connect(serverT), client.connect(clientT)])
    return client
  }

  it('tools/list advertises the read + write tools', async () => {
    const client = await connectClient(file)
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_recipes')
    expect(names).toContain('calc_recipe')
    expect(names).toContain('scale_recipe')
    expect(names).toContain('log_reading')
    expect(tools).toHaveLength(15)
    await client.close()
  })

  it('tools/call runs a READ tool and returns its JSON', async () => {
    const client = await connectClient(file)
    const res = await client.callTool({ name: 'list_recipes', arguments: {} })
    expect(res.isError).toBeFalsy()
    const data = JSON.parse(resultText(res as never)) as unknown[]
    expect(data).toHaveLength(1)
    await client.close()
  })

  it('tools/call runs a WRITE tool that persists to the file', async () => {
    const client = await connectClient(file)
    const res = await client.callTool({
      name: 'log_reading',
      arguments: { batchId: BATCH_ID, gravity: 1.008, tempC: 20 },
    })
    expect(res.isError).toBeFalsy()
    const summary = JSON.parse(resultText(res as never)) as { applied: boolean; action: string }
    expect(summary).toMatchObject({ applied: true, action: 'log_reading' })

    // The new reading is durable on disk.
    const reloaded = await loadBrewery(file)
    const forBatch = reloaded.readings.filter((r) => r.batchId === BATCH_ID)
    expect(forBatch.some((r) => r.gravity === 1.008)).toBe(true)
    await client.close()
  })

  it('tools/call for an unknown tool returns an isError result (no crash)', async () => {
    const client = await connectClient(file)
    const res = await client.callTool({ name: 'does_not_exist', arguments: {} })
    expect(res.isError).toBe(true)
    expect(resultText(res as never)).toMatch(/Unknown tool/)
    await client.close()
  })

  it('read-only mode: tools/list omits the write tools entirely', async () => {
    const client = await connectClient(file, { readOnly: true })
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name)
    expect(names).toContain('list_recipes')
    expect(names).toContain('calc_recipe')
    expect(names).not.toContain('scale_recipe')
    expect(names).not.toContain('log_reading')
    expect(tools).toHaveLength(11)
    await client.close()
  })

  it('read-only mode: reads still work; calling a write tool name is an unregistered tool', async () => {
    const client = await connectClient(file, { readOnly: true })

    const readRes = await client.callTool({ name: 'list_recipes', arguments: {} })
    expect(readRes.isError).toBeFalsy()

    const writeRes = await client.callTool({ name: 'log_reading', arguments: {} })
    expect(writeRes.isError).toBe(true)
    expect(resultText(writeRes as never)).toMatch(/Unknown tool/)

    // Confirms it's truly unregistered, not just rejected — the file is untouched
    // (still exactly the 2 fixture readings for this batch, no third added).
    const reloaded = await loadBrewery(file)
    expect(reloaded.readings.filter((r) => r.batchId === BATCH_ID)).toHaveLength(2)
    await client.close()
  })
})
