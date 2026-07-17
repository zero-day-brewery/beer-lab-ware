/**
 * File-level parsing + entity classification for Brewfather JSON exports.
 * Pure — no I/O. Accepts any of the shapes Brewfather produces:
 *
 *   - an array of entities            (recipes.json, batches.json, hops.json, …)
 *   - a single entity object          (per-recipe / per-batch export)
 *   - a container object              ({ recipes: [...], batches: [...], … })
 *
 * Classification uses the file name as a hint (Brewfather names its export
 * files after the collection) and falls back to content heuristics. Anything
 * unclassifiable is skipped with a warning — a malformed entity never fails
 * the whole file.
 */
import type { BfInventoryKind } from './map-inventory'

export type BfEntityKind = 'recipe' | 'batch' | BfInventoryKind

export interface BfEntity {
  kind: BfEntityKind
  raw: unknown
}

export interface ParsedBrewfatherFile {
  fileName: string
  entities: BfEntity[]
  warnings: string[]
}

const CONTAINER_KEYS: Record<string, BfEntityKind> = {
  recipes: 'recipe',
  batches: 'batch',
  fermentables: 'fermentable',
  hops: 'hop',
  yeasts: 'yeast',
  miscs: 'misc',
}

function fileNameHint(fileName: string): BfEntityKind | null {
  const lower = fileName.toLowerCase()
  if (lower.includes('batch')) return 'batch'
  if (lower.includes('recipe')) return 'recipe'
  if (lower.includes('ferment')) return 'fermentable'
  if (lower.includes('hop')) return 'hop'
  if (lower.includes('yeast')) return 'yeast'
  if (lower.includes('misc')) return 'misc'
  return null
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Content heuristics — used when the file name gives no hint. */
function classifyByContent(obj: Record<string, unknown>): BfEntityKind | null {
  // Batch: carries an embedded recipe and/or brew-day measurements.
  if (isRecord(obj.recipe) || 'brewDate' in obj || 'measuredOg' in obj) return 'batch'
  // Recipe: carries ingredient arrays / a mash profile / a batch size.
  if (
    Array.isArray(obj.fermentables) ||
    Array.isArray(obj.hops) ||
    Array.isArray(obj.yeasts) ||
    isRecord(obj.mash) ||
    typeof obj.batchSize === 'number'
  ) {
    return 'recipe'
  }
  // Inventory kinds by their distinguishing fields.
  if ('alpha' in obj) return 'hop'
  if ('attenuation' in obj || 'laboratory' in obj || 'productId' in obj) return 'yeast'
  if ('potential' in obj || 'potentialPercentage' in obj || 'grainCategory' in obj)
    return 'fermentable'
  if ('use' in obj && typeof obj.name === 'string') return 'misc'
  return null
}

function classifyEntity(
  obj: unknown,
  hint: BfEntityKind | null,
  index: number,
  warnings: string[],
): BfEntity | null {
  if (!isRecord(obj)) {
    warnings.push(`Entity #${index + 1} skipped — not a JSON object`)
    return null
  }
  // Content wins for recipe-vs-batch (a batches file's entities carry the
  // telltale embedded recipe); the hint decides inventory kinds and ties.
  const content = classifyByContent(obj)
  if (content === 'batch' || content === 'recipe') {
    return { kind: content, raw: obj }
  }
  if (hint !== null) return { kind: hint, raw: obj }
  if (content !== null) return { kind: content, raw: obj }
  warnings.push(`Entity #${index + 1} skipped — could not tell what it is`)
  return null
}

export function parseBrewfatherFile(fileName: string, text: string): ParsedBrewfatherFile {
  const warnings: string[] = []
  const entities: BfEntity[] = []

  let root: unknown
  try {
    root = JSON.parse(text)
  } catch {
    return { fileName, entities, warnings: [`${fileName}: not valid JSON — file skipped`] }
  }

  const hint = fileNameHint(fileName)

  const pushAll = (items: unknown[], itemHint: BfEntityKind | null) => {
    for (const [i, item] of items.entries()) {
      const entity = classifyEntity(item, itemHint, i, warnings)
      if (entity) entities.push(entity)
    }
  }

  if (Array.isArray(root)) {
    pushAll(root, hint)
  } else if (isRecord(root)) {
    // Container object ({ recipes: [...], ... })? Only when the root has no
    // entity identity of its own — a single exported recipe also carries
    // `hops`/`fermentables` arrays but always has a name/_id/batchSize.
    const containerKeys = Object.keys(CONTAINER_KEYS).filter((k) => Array.isArray(root[k]))
    const looksLikeEntity =
      root._id !== undefined || root.name !== undefined || root.batchSize !== undefined
    if (containerKeys.length > 0 && !looksLikeEntity) {
      for (const k of containerKeys) {
        pushAll(root[k] as unknown[], CONTAINER_KEYS[k])
      }
    } else {
      pushAll([root], hint)
    }
  } else {
    warnings.push(`${fileName}: JSON root is not an object or array — file skipped`)
  }

  return {
    fileName,
    entities,
    warnings: warnings.map((w) => (w.startsWith(fileName) ? w : `${fileName}: ${w}`)),
  }
}
