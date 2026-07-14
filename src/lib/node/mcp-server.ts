/**
 * Terminal/MCP Stage B — the runnable MCP stdio server.
 *
 * Wraps Stage A's file-backed brewery adapter ({@link openBrewery}) + the
 * portable tool engine (`buildTools` / `buildWriteTools` / `applyAction`) as a
 * real Model-Context-Protocol server so ANY MCP client (Claude Desktop, Claude
 * Code, Cursor) can plug into a brewer's exported `brewery.json` — read it,
 * compute over it, and (client-approval-gated) write changes back. This is the
 * "plug your AI in via the terminal, the way Claude Code is wired" deliverable.
 *
 * WHAT IT EXPOSES
 *   - READ tools  — every tool from `buildTools(toolDeps)`, 1:1 as an MCP tool
 *     (`list_recipes`, `get_recipe`, `calc_recipe`, `inventory_report`, …). The
 *     CallTool handler runs `tool.run(args)` (which Zod-validates first) and
 *     returns the lean JSON result as MCP text content. Annotated `readOnlyHint`.
 *   - WRITE tools — every `propose_*` tool from `buildWriteTools(toolDeps)`,
 *     re-exposed under its MUTATING name (`propose_scale_recipe` → `scale_recipe`,
 *     etc.) with a description that CLEARLY flags it mutates `brewery.json`, so the
 *     MCP client prompts the user to approve. The handler runs the propose tool to
 *     build a truthful {@link Proposal}, commits it through {@link applyAction}
 *     (the ONE atomic write path) over the file-backed write deps, flushes, and
 *     returns a summary of exactly what changed. The client's approval IS the
 *     confirm gate — mirroring how Claude Code gates risky tools.
 *
 * SAFETY
 *   - Writes go through `applyAction` ONLY (re-validates the payload, dispatches to
 *     the atomic repo helper) and persist to the file via the Stage A adapter's
 *     atomic temp+rename. No new write path is introduced.
 *   - Every CallTool is serialized through a mutex so two writes can never
 *     interleave and lose an update (the Stage A note flagged this).
 *   - A tool error becomes an `isError` MCP result — it never crashes the server;
 *     an unknown tool returns an error result too.
 *
 * NODE-ONLY. Pages never import this module (verified: nothing under `src/app` /
 * `src/components` references `@/lib/node/*` or `@modelcontextprotocol/sdk`), so
 * the SDK is tree-shaken from the browser static export.
 */

import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import {
  CallToolRequestSchema,
  type CallToolResult,
  ListToolsRequestSchema,
  type Tool,
} from '@modelcontextprotocol/sdk/types.js'
import { type ApplyOutput, applyAction } from '@/lib/ai/actions/apply'
import type { ActionDescriptor, Proposal } from '@/lib/ai/actions/types'
import { buildTools } from '@/lib/ai/tools'
import { buildWriteTools } from '@/lib/ai/tools/write-tools'
import type { AiTool } from '@/lib/ai/types'
import { type BreweryAdapter, openBrewery } from '@/lib/node'
import { createMutex } from '@/lib/node/mutex'

const SERVER_NAME = 'beer-lab-ware'
const SERVER_VERSION = '0.1.0'

/** A CallTool handler over already-validated params → an MCP result. */
type ToolHandler = (args: unknown) => Promise<CallToolResult>

/** The tool-mapping layer: MCP tool definitions + their handlers, keyed by name. */
export interface McpToolMapping {
  tools: Tool[]
  handlers: Map<string, ToolHandler>
}

const errText = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/** Pretty-printed JSON as a single MCP text-content result. */
function textResult(payload: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(payload, null, 2) }] }
}

/** An MCP error result (never a thrown exception — the server stays up). */
function errorResult(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}

/** `propose_scale_recipe` → `scale_recipe` — the MUTATING public name. */
function mutatingName(proposeToolName: string): string {
  return proposeToolName.replace(/^propose_/, '')
}

/** Human summary of exactly what a committed write changed (returned to the client). */
function summarizeWrite(
  action: ActionDescriptor,
  output: ApplyOutput,
  filePath: string,
): Record<string, unknown> {
  return {
    applied: true,
    action: action.type,
    title: action.title,
    // The truthful before→after preview computed at propose time.
    preview: action.preview,
    result: output,
    file: filePath,
    note: 'Written to brewery.json via the atomic write path. Re-import in the app (Settings → Import backup JSON) to sync the browser copy.',
  }
}

/** Wrap one read tool as an MCP tool + handler (runs the tool, returns its JSON). */
function readMapping(tool: AiTool): { def: Tool; handler: ToolHandler } {
  const def: Tool = {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema as Tool['inputSchema'],
    annotations: { readOnlyHint: true },
  }
  const handler: ToolHandler = async (args) => {
    try {
      return textResult(await tool.run(args ?? {}))
    } catch (err) {
      return errorResult(`${tool.name} failed: ${errText(err)}`)
    }
  }
  return { def, handler }
}

/**
 * Wrap one `propose_*` tool as a MUTATING MCP tool + handler. The handler runs the
 * propose tool to build a {@link Proposal}, commits it via {@link applyAction}
 * (the sole atomic write path) over the adapter's file-backed write deps, flushes
 * to disk, and returns a summary. The description flags the mutation so the client
 * gates it behind user approval.
 */
function writeMapping(
  proposeTool: AiTool,
  adapter: BreweryAdapter,
): { def: Tool; handler: ToolHandler } {
  const name = mutatingName(proposeTool.name)
  const def: Tool = {
    name,
    description:
      `⚠️ WRITE — MUTATES brewery.json. ${proposeTool.description} ` +
      'On approval the change is applied immediately through the atomic write path and the file is re-exported.',
    inputSchema: proposeTool.inputSchema as Tool['inputSchema'],
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  }
  const handler: ToolHandler = async (args) => {
    try {
      // 1. Build the proposal (validates inputs + looks up rows; never writes).
      const proposal = (await proposeTool.run(args ?? {})) as Proposal
      // 2. Commit through the ONE atomic write path (re-validates the payload).
      const applied = await applyAction(proposal.action, adapter.writeDeps)
      if (!applied.ok) return errorResult(`${name} failed: ${applied.error}`)
      // 3. Flush the durable file (the file-backed write deps already persist per
      //    commit; this is an explicit belt-and-suspenders re-export of the
      //    committed state so the on-disk brewery.json is guaranteed current).
      await adapter.flush()
      return textResult(summarizeWrite(proposal.action, applied.result, adapter.store.filePath))
    } catch (err) {
      return errorResult(`${name} failed: ${errText(err)}`)
    }
  }
  return { def, handler }
}

/**
 * Build the MCP tool-mapping layer over an open brewery: the engine's read tools
 * (1:1) plus the propose tools re-exposed as mutating writes. Pure + injectable —
 * tests drive it over a fixture-file adapter with no transport.
 */
export function buildMcpTools(adapter: BreweryAdapter): McpToolMapping {
  const tools: Tool[] = []
  const handlers = new Map<string, ToolHandler>()

  for (const tool of buildTools(adapter.toolDeps)) {
    const { def, handler } = readMapping(tool)
    tools.push(def)
    handlers.set(def.name, handler)
  }
  for (const proposeTool of buildWriteTools(adapter.toolDeps)) {
    const { def, handler } = writeMapping(proposeTool, adapter)
    tools.push(def)
    handlers.set(def.name, handler)
  }
  return { tools, handlers }
}

/**
 * Create a configured (but not-yet-connected) MCP {@link Server} over an open
 * brewery. Registers ListTools (advertises the mapped tools) + CallTool (dispatch
 * through the mutex; unknown tool → error result). Transport is attached by the
 * caller (`server.connect(transport)`), so this is unit-testable in-process over
 * an in-memory transport.
 */
export function createBreweryMcpServer(adapter: BreweryAdapter): Server {
  const { tools, handlers } = buildMcpTools(adapter)
  const runExclusive = createMutex()

  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      capabilities: { tools: {} },
      instructions:
        `Beer-Lab-Ware — brewery over ${adapter.store.filePath}. ` +
        'Read tools (list_recipes, get_recipe, calc_recipe, inventory_report, …) are safe. ' +
        'Write tools (scale_recipe, create_recipe, log_reading, adjust_inventory) MUTATE brewery.json and require approval.',
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params
    const handler = handlers.get(name)
    if (!handler) return errorResult(`Unknown tool: ${name}`)
    // Serialize ALL calls so a write's clone→save→swap completes before the next.
    return runExclusive(() => handler(args))
  })

  return server
}

/** Resolve the brewery export path from `BREWERY_FILE` or the first CLI arg. */
export function resolveBreweryPath(argv: string[] = process.argv): string | null {
  const fromEnv = process.env.BREWERY_FILE?.trim()
  if (fromEnv) return fromEnv
  const fromArg = argv[2]?.trim()
  return fromArg && fromArg.length > 0 ? fromArg : null
}

/**
 * Entrypoint: resolve the file, open the brewery (fails clearly if the file is
 * missing/invalid), wire the server, and serve over stdio until the client
 * disconnects.
 */
export async function main(): Promise<void> {
  const path = resolveBreweryPath()
  if (!path) {
    process.stderr.write(
      'beer-lab-ware MCP server: no brewery file given.\n' +
        'Set BREWERY_FILE=/path/to/brewery.json (or pass it as the first argument).\n',
    )
    process.exit(2)
  }

  let adapter: BreweryAdapter
  try {
    adapter = await openBrewery(path)
  } catch (err) {
    process.stderr.write(`beer-lab-ware MCP server: cannot open "${path}": ${errText(err)}\n`)
    process.exit(1)
    return
  }

  const server = createBreweryMcpServer(adapter)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(
    `beer-lab-ware MCP server ready over stdio (brewery: ${adapter.store.filePath}).\n`,
  )
}

// Run only when invoked directly (`tsx src/lib/node/mcp-server.ts`), never when
// imported by tests. Format-agnostic: works whether the runner loads this as ESM
// or CJS (tsx supplies `import.meta.url` in both).
const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] != null &&
  import.meta.url === pathToFileURL(process.argv[1]).href

if (invokedDirectly) {
  main().catch((err) => {
    process.stderr.write(`beer-lab-ware MCP server: fatal: ${errText(err)}\n`)
    process.exit(1)
  })
}
