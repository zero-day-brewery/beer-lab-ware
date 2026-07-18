# Beer-Lab-Ware — MCP server

Plug your AI into your brewery **through the terminal, the way Claude Code is wired.**

The MCP server exposes your exported `brewery.json` to any Model-Context-Protocol
client (Claude Desktop, Claude Code, Cursor, …). The client can then **read** your
recipes/batches/inventory/water, **compute** over them with the real calc engine,
and — behind the client's approval prompt — **write** changes back to the file.

It is the same engine the app runs (`buildTools` / `buildWriteTools` / `applyAction`)
driven over a file instead of the browser's Dexie database. No cloud, no network,
no backend — it reads and writes one local JSON file.

---

## 1. Export your brewery to a file

In the app: **Settings → Export backup (JSON)**. Save it somewhere stable, e.g.:

```
~/brewery/brewery.json
```

That file is the whole brewery (recipes, equipment, inventory, batches, readings,
water, stock ledger). The MCP server reads it on startup and writes approved
changes back to it.

> The server reads any older export version and always writes the **current**
> envelope (v9 at the time of writing — the authoritative value is
> `CURRENT_DUMP_VERSION` in `src/lib/node/brewery-store.ts`).

## 2. Point your MCP client at the server

The server is launched with `tsx` and told which file to open via the
`BREWERY_FILE` environment variable (or the first CLI argument). Use the **absolute
path** to this repo and to your brewery file.

### Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "beer-lab-ware": {
      "command": "npx",
      "args": ["tsx", "src/lib/node/mcp-server.ts"],
      "cwd": "/ABSOLUTE/PATH/TO/beer-lab-ware",
      "env": { "BREWERY_FILE": "/ABSOLUTE/PATH/TO/brewery.json" }
    }
  }
}
```

### Claude Code

Add it to `~/.claude.json` (or run `claude mcp add`), same shape:

```json
{
  "mcpServers": {
    "beer-lab-ware": {
      "command": "npx",
      "args": ["tsx", "src/lib/node/mcp-server.ts"],
      "cwd": "/ABSOLUTE/PATH/TO/beer-lab-ware",
      "env": { "BREWERY_FILE": "/ABSOLUTE/PATH/TO/brewery.json" }
    }
  }
}
```

Equivalent one-liner:

```bash
claude mcp add beer-lab-ware \
  --env BREWERY_FILE=/ABSOLUTE/PATH/TO/brewery.json \
  -- npx tsx /ABSOLUTE/PATH/TO/beer-lab-ware/src/lib/node/mcp-server.ts
```

### Cursor

`~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "beer-lab-ware": {
      "command": "npx",
      "args": ["tsx", "src/lib/node/mcp-server.ts"],
      "cwd": "/ABSOLUTE/PATH/TO/beer-lab-ware",
      "env": { "BREWERY_FILE": "/ABSOLUTE/PATH/TO/brewery.json" }
    }
  }
}
```

> If your client doesn't support `cwd`, use an absolute path to the server file in
> `args` and set `BREWERY_FILE` in `env`, e.g.
> `"args": ["tsx", "/ABSOLUTE/PATH/TO/beer-lab-ware/src/lib/node/mcp-server.ts"]`.

### Run it directly (to sanity-check)

```bash
BREWERY_FILE=/ABSOLUTE/PATH/TO/brewery.json npm run mcp
# stderr prints: "beer-lab-ware MCP server ready over stdio (brewery: …)."
```

The process speaks MCP over stdio, so on its own it just waits for a client.

## 3. Tools

### Read tools (safe — never mutate the file)

| Tool | What it returns |
| --- | --- |
| `list_recipes` | All recipes as lean summaries |
| `get_recipe` | One recipe + computed OG/FG/ABV/IBU/SRM, strike temp, volumes |
| `list_inventory` | Pantry items (optional `kind` filter) with low-stock flags |
| `inventory_report` | Pantry rollup: value, low/expiring counts, shopping list |
| `list_batches` | Brew batches (status, measured ABV, rating, dates) |
| `get_batch` | One batch + results, tasting, readings, recipe drift |
| `list_water_profiles` | Saved source waters + SO4:Cl balance |
| `water_additions` | Salt additions (g) to hit a target water style |
| `calc_recipe` | Run the calc engine on a draft **without saving** (what-if) |
| `batch_stats` | Brew-history rollup |
| `list_equipment` | Equipment profiles |

### Write tools (⚠️ MUTATE `brewery.json` — the client asks you to approve)

Each is annotated `destructiveHint` and its description begins with
`⚠️ WRITE — MUTATES brewery.json`, so an MCP client surfaces an approval prompt
before running it. **The client's approval is the confirm gate.**

| Tool | What it writes |
| --- | --- |
| `scale_recipe` | Saves a NEW recipe scaled to a target batch size or OG |
| `create_recipe` | Saves a NEW recipe from a full draft |
| `log_reading` | Adds a fermentation reading (gravity/temp) to a batch |
| `adjust_inventory` | Applies a signed stock-ledger movement to an item |

On approval the tool: builds a truthful proposal → commits it through
`applyAction` (the single atomic write path, which re-validates the payload) →
persists the file with an atomic temp-file + rename → returns a summary of exactly
what changed (title, before→after preview, and the written result).

## 4. Write-safety notes

- **Writes go to the file, not the app.** The browser app reads its own IndexedDB
  (Dexie), not this JSON. After the AI makes changes, **re-import** the file in the
  app (**Settings → Import backup JSON**) to sync your browser copy.
- **Atomic + serialized.** Every write is a validate → clone → atomic
  temp+rename → swap; all tool calls are serialized so two writes can never
  interleave and lose an update. A failed write leaves the existing file untouched.
- **Nothing else can write.** The server has exactly one write path (`applyAction`).
  Reads can never mutate the file.
- **Keep a backup.** It edits your real export in place. Keep the original export
  (or a copy) until you've re-imported and confirmed the changes in the app.

## 5. How `@/…` imports resolve at runtime

The server and engine use the `@/*` → `./src/*` path alias from `tsconfig.json`.
It runs under [`tsx`](https://tsx.is), which honours those `paths` mappings and
strips types on the fly — so `npm run mcp` (`tsx src/lib/node/mcp-server.ts`) runs
the exact source in a real Node runtime with no separate build step. `tsx` is a
dev dependency; `@modelcontextprotocol/sdk` is a server-only runtime dependency.
Neither is imported by any page, so both are absent from the browser static export.
