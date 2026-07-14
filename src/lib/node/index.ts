/**
 * Terminal/MCP Stage A — Node, file-backed brewery adapter (barrel).
 *
 * NODE-ONLY. Pages must never import from `@/lib/node/*` — it uses Node `fs` and
 * would break the static browser bundle. Stage B (the MCP server) imports from
 * here to run the existing tool registry + `applyAction` over an exported brewery
 * JSON file instead of Dexie.
 */

export {
  type BreweryAdapter,
  BreweryStore,
  createFileToolDeps,
  createFileWriteDeps,
  openBrewery,
} from '@/lib/node/brewery-adapter'
export {
  atomicWriteJson,
  type BreweryCollections,
  type BreweryFile,
  CURRENT_DUMP_VERSION,
  emptyCollections,
  loadBrewery,
  parseEnvelope,
  saveBrewery,
  validateCollections,
} from '@/lib/node/brewery-store'
