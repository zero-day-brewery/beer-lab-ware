'use client'
import { liveQuery } from 'dexie'
import Link from 'next/link'
import { type FormEvent, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { InventoryEmptyScene } from '@/components/brand/empty-scenes'
import { ColumnResizeHandle, useResizableColumns } from '@/components/ui/resizable-columns'
import {
  buildInventoryStats,
  hopAge,
  itemFreshness,
  itemValue,
  yeastViability,
} from '@/lib/brewing/inventory/freshness'
import {
  type InventoryItem,
  InventoryItemSchema,
  type InventoryKind,
  isLowStock,
  isPastBestBy,
} from '@/lib/brewing/types/inventory'
import {
  buildStockTransaction,
  runningBalances,
  type StockReason,
  type StockTransaction,
} from '@/lib/brewing/types/stock-transaction'
import { inventoryRepo } from '@/lib/db/repos/inventory'
import { stockTransactionsRepo } from '@/lib/db/repos/stock-transactions'
import { reportDbError } from '@/lib/diagnostics/error-log'
import type { ColumnDef } from '@/lib/ui/column-resize'
import { newId } from '@/lib/utils/id'
import { useInventoryStore } from '@/stores/inventory-store'

/** Adjustable reasons offered in the Ledger modal (opening/brew-deduct are
 *  system-set, not user-picked here). */
const ADJUST_REASONS: {
  value: Extract<StockReason, 'restock' | 'manual-adjust' | 'spoilage'>
  label: string
}[] = [
  { value: 'restock', label: 'Restock (bought more)' },
  { value: 'manual-adjust', label: 'Manual adjust (correction)' },
  { value: 'spoilage', label: 'Spoilage (wrote off)' },
]

const REASON_LABELS: Record<StockReason, string> = {
  opening: 'Opening',
  restock: 'Restock',
  'manual-adjust': 'Manual adjust',
  spoilage: 'Spoilage',
  'brew-deduct': 'Brew deduct',
  'sync-reconcile': 'Sync reconcile',
}

const KIND_LABELS: Record<InventoryKind, string> = {
  fermentable: 'Fermentable',
  hop: 'Hop',
  yeast: 'Yeast',
  misc: 'Misc',
  'water-treatment': 'Water treatment',
  other: 'Other',
}

const KIND_ICONS: Record<InventoryKind, string> = {
  fermentable: '🌾',
  hop: '🌿',
  yeast: '🧫',
  misc: '🧂',
  'water-treatment': '💧',
  other: '📦',
}

type SortKey = 'name' | 'amount' | 'kind' | 'best-by' | 'value'

const SORT_LABELS: Record<SortKey, string> = {
  name: 'Name (A→Z)',
  amount: 'Amount (high→low)',
  kind: 'Kind',
  'best-by': 'Best-by (soonest)',
  value: 'Value (high→low)',
}

const VIEW_MODE_KEY = 'inventory-view-mode'

/**
 * Resizable columns for the pantry table view — the same reusable primitive the
 * Water comparison grid uses, here in `<table>`/`<colgroup>` mode. The trailing
 * actions column flexes; widths persist under `bbc:colw:inventory-table`.
 */
const INVENTORY_TABLE_ID = 'inventory-table'
const INVENTORY_COLUMNS: ColumnDef[] = [
  { id: 'name', label: 'Name', min: 120, initial: 180 },
  { id: 'kind', label: 'Kind', min: 90, initial: 130 },
  { id: 'amount', label: 'Amount', min: 90, initial: 120 },
  { id: 'freshness', label: 'Freshness', min: 110, initial: 150 },
  { id: 'value', label: 'Value', min: 70, initial: 90 },
  { id: 'vendor', label: 'Vendor', min: 90, initial: 130 },
  { id: 'bestby', label: 'Best-by', min: 90, initial: 120 },
  { id: 'par', label: 'Par', min: 70, initial: 90 },
  { id: 'actions', label: 'Actions', min: 150, flex: true },
]

const byName = (a: InventoryItem, b: InventoryItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })

function sortItems(items: InventoryItem[], key: SortKey): InventoryItem[] {
  const copy = [...items]
  switch (key) {
    case 'name':
      return copy.sort(byName)
    case 'amount':
      return copy.sort((a, b) => b.amount - a.amount)
    case 'kind':
      return copy.sort((a, b) => a.ingredientKind.localeCompare(b.ingredientKind) || byName(a, b))
    case 'best-by':
      return copy.sort((a, b) => {
        const av = a.bestByDate ? new Date(a.bestByDate).getTime() : Number.POSITIVE_INFINITY
        const bv = b.bestByDate ? new Date(b.bestByDate).getTime() : Number.POSITIVE_INFINITY
        return av - bv || byName(a, b)
      })
    case 'value':
      return copy.sort((a, b) => itemValue(b) - itemValue(a) || byName(a, b))
  }
}

function freshItem(): InventoryItem {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name: '',
    ingredientKind: 'fermentable',
    amount: 0,
    amountUnit: 'g',
    status: 'sealed',
    notes_md: '',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
    // openedDate + parLevel intentionally left undefined (optional fields).
  }
}

function toDateInput(iso: string | undefined): string {
  if (!iso) return ''
  return iso.slice(0, 10)
}

function fromDateInput(date: string): string | undefined {
  if (!date) return undefined
  return new Date(`${date}T00:00:00.000Z`).toISOString()
}

function fmtUSD(n: number): string {
  return `$${n.toFixed(2)}`
}

function fmtQty(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2)
}

/** Yeast viability % or hop age, shown alongside the freshness state. */
function freshnessDetail(item: InventoryItem, now: Date): string | null {
  const viability = yeastViability(item, now)
  if (viability !== null) return `~${Math.round(viability)}% est.`
  const age = hopAge(item, now)
  if (age !== null) return `${Math.round(age.months)} mo`
  return null
}

function FreshnessBadge({ item, now }: { item: InventoryItem; now: Date }) {
  const fresh = itemFreshness(item, now)
  const cls =
    fresh.state === 'expired' ? 'cond-broken' : fresh.state === 'aging' ? 'cond-worn' : 'cond-good'
  const detail = freshnessDetail(item, now)
  return (
    <span className={`cond ${cls}`} title={fresh.reason ?? fresh.state}>
      <span className="dot" aria-hidden="true" />
      <span>
        {fresh.state}
        {detail ? ` · ${detail}` : ''}
      </span>
    </span>
  )
}

export function InventoryView() {
  const { items, isLoading } = useInventoryStore()
  const [editing, setEditing] = useState<InventoryItem | null>(null)
  const [ledgerItem, setLedgerItem] = useState<InventoryItem | null>(null)
  const [filterKind, setFilterKind] = useState<InventoryKind | 'all'>('all')
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('name')
  const [viewMode, setViewMode] = useState<'card' | 'table'>(() => {
    if (typeof window === 'undefined') return 'card'
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'table' ? 'table' : 'card'
  })

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  const now = useMemo(() => new Date(), [])
  const stats = useMemo(() => buildInventoryStats(items, now), [items, now])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    const filtered = items.filter((i) => {
      if (filterKind !== 'all' && i.ingredientKind !== filterKind) return false
      if (!q) return true
      return i.name.toLowerCase().includes(q) || (i.vendor?.toLowerCase().includes(q) ?? false)
    })
    return sortItems(filtered, sortKey)
  }, [items, filterKind, search, sortKey])

  const onSave = async (item: InventoryItem) => {
    try {
      const parsed = InventoryItemSchema.parse(item)
      // Capture the pre-save amount so we can log the ledger delta. `get` is null
      // for a brand-new item (its opening stock) vs an existing one (an edit).
      const prev = await inventoryRepo.get(parsed.id)
      // Ledger wiring — keep `amount === Σ deltas`. New item → log its initial qty
      // as a `restock`; an edit that changes amount → log the signed difference as
      // a `manual-adjust`. Non-amount edits (and a zero delta) write no txn.
      // Item + txn commit together via the atomic `saveItemWithTxn` (no window
      // where `amount` changed but the matching ledger row is missing).
      const at = new Date().toISOString()
      const stampedItem = InventoryItemSchema.parse({ ...parsed, updatedAt: at })
      let txn: StockTransaction | null = null
      if (!prev) {
        if (parsed.amount !== 0) {
          txn = buildStockTransaction({
            id: newId(),
            item: parsed,
            delta: parsed.amount,
            reason: 'restock',
            at,
          })
        }
      } else {
        const delta = parsed.amount - prev.amount
        if (delta !== 0) {
          txn = buildStockTransaction({
            id: newId(),
            item: parsed,
            delta,
            reason: 'manual-adjust',
            at,
          })
        }
      }
      await stockTransactionsRepo.saveItemWithTxn(stampedItem, txn)
      toast.success(`Saved "${parsed.name}"`)
      setEditing(null)
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await inventoryRepo.delete(id)
      // Cascade the ledger so no orphan transactions survive the item.
      await stockTransactionsRepo.deleteByItem(id)
      toast.success(`Deleted "${name}"`)
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="eyebrow">🌾 Pantry</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Ingredient inventory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Grain, hops, yeast, and salts on hand — value, freshness, and what to restock.
            </p>
          </div>
          <button type="button" onClick={() => setEditing(freshItem())} className="btn-primary">
            <span aria-hidden="true">＋</span>
            <span>Add item</span>
          </button>
        </div>

        {/* KPI row — pantry-wide roll-up (value never touches a single card). */}
        <div className="flex flex-wrap gap-2">
          <div className="stat-tile">
            <span className="num">{fmtUSD(stats.totalValue_USD)}</span>
            <span className="lbl">Total value</span>
          </div>
          <div className="stat-tile">
            <span className="num">{stats.lowStockCount}</span>
            <span className="lbl">Low stock</span>
          </div>
          <div className="stat-tile">
            <span className="num">{stats.expiringSoonCount}</span>
            <span className="lbl">Expiring soon</span>
          </div>
          <div className="stat-tile">
            <span className="num">{stats.itemCount}</span>
            <span className="lbl">Items</span>
          </div>
        </div>

        {/* Controls: search · sort · kind filter · view toggle */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex-1 text-sm" style={{ minWidth: '12rem' }}>
            <span className="sr-only">Search by name or vendor</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name or vendor…"
              aria-label="Search by name or vendor"
              className="field w-full"
            />
          </label>

          <label className="text-sm">
            <span className="sr-only">Sort by</span>
            <select
              aria-label="Sort by"
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              className="field"
            >
              {(Object.keys(SORT_LABELS) as SortKey[]).map((key) => (
                <option key={key} value={key}>
                  {SORT_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="sr-only">Filter by kind</span>
            <select
              aria-label="Filter by kind"
              value={filterKind}
              onChange={(e) => setFilterKind(e.target.value as InventoryKind | 'all')}
              className="field"
            >
              <option value="all">All kinds</option>
              {Object.entries(KIND_LABELS).map(([key, label]) => (
                <option key={key} value={key}>
                  {KIND_ICONS[key as InventoryKind]} {label}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="inline-flex gap-1 border-0 p-0">
            <legend className="sr-only">View mode</legend>
            <button
              type="button"
              onClick={() => setViewMode('card')}
              aria-pressed={viewMode === 'card'}
              className={`btn-ghost ${viewMode === 'card' ? 'is-active' : ''}`}
            >
              Cards
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              aria-pressed={viewMode === 'table'}
              className={`btn-ghost ${viewMode === 'table' ? 'is-active' : ''}`}
            >
              Table
            </button>
          </fieldset>
        </div>
      </header>

      {editing && (
        <InventoryEditForm
          key={editing.id}
          item={editing}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {filterKind === 'yeast' && (
        <Link href="/yeast" className="tap-card flex items-center justify-between gap-3 p-4">
          <span className="flex items-center gap-3">
            <span className="chip-icon !h-10 !w-10 !text-xl" aria-hidden="true">
              🧬
            </span>
            <span className="flex flex-col">
              <span className="text-sm font-semibold">Yeast Bank</span>
              <span className="text-xs text-muted-foreground">
                Lot-level viability, generations, and repitch lineage live here now
              </span>
            </span>
          </span>
          <span className="text-sm text-muted-foreground" aria-hidden="true">
            →
          </span>
        </Link>
      )}

      {stats.shopping.length > 0 && <ShoppingList shopping={stats.shopping} />}

      {visibleItems.length === 0 && !editing ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          {items.length === 0 ? (
            <InventoryEmptyScene className="mb-4" />
          ) : (
            <div className="chip-icon mb-4 !h-16 !w-16 !text-4xl">🌾</div>
          )}
          <h2 className="text-xl font-semibold">
            {items.length === 0
              ? 'The pantry is empty'
              : filterKind === 'all'
                ? 'Nothing matches your search'
                : `No ${KIND_LABELS[filterKind]} yet`}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Add what's in your pantry/freezer so you can plan brews against real stock.
          </p>
        </div>
      ) : viewMode === 'table' ? (
        <InventoryTable
          items={visibleItems}
          now={now}
          onEdit={setEditing}
          onDelete={onDelete}
          onLedger={setLedgerItem}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => (
            <InventoryCard
              key={item.id}
              item={item}
              now={now}
              onEdit={() => setEditing(item)}
              onDelete={() => onDelete(item.id, item.name)}
              onLedger={() => setLedgerItem(item)}
            />
          ))}
        </div>
      )}

      {ledgerItem && <LedgerModal itemId={ledgerItem.id} onClose={() => setLedgerItem(null)} />}
    </div>
  )
}

function ShoppingList({
  shopping,
}: {
  shopping: ReturnType<typeof buildInventoryStats>['shopping']
}) {
  const total = shopping.reduce((sum, line) => sum + line.estCost, 0)
  return (
    <section className="tap-card flex flex-col gap-2 p-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-base font-semibold">🛒 To buy</h2>
        <span className="font-mono text-sm" style={{ color: 'var(--malt, var(--primary))' }}>
          ~{fmtUSD(total)}
        </span>
      </div>
      <ul className="flex flex-col divide-y divide-border/60">
        {shopping.map((line) => (
          <li
            key={line.item.id}
            className="flex items-baseline justify-between gap-3 py-1.5 text-sm"
          >
            <span className="min-w-0 flex-1 truncate">{line.item.name}</span>
            <span className="shrink-0 font-mono text-muted-foreground">
              buy {fmtQty(line.deficit)} {line.item.amountUnit}
            </span>
            <span className="shrink-0 font-mono text-foreground/85">
              {line.estCost > 0 ? fmtUSD(line.estCost) : '—'}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function InventoryTable({
  items,
  now,
  onEdit,
  onDelete,
  onLedger,
}: {
  items: InventoryItem[]
  now: Date
  onEdit: (item: InventoryItem) => void
  onDelete: (id: string, name: string) => void
  onLedger: (item: InventoryItem) => void
}) {
  const { getColStyle, getHandleProps } = useResizableColumns(INVENTORY_TABLE_ID, INVENTORY_COLUMNS)
  return (
    <div className="report-scroll">
      <table className="report-table rz-table">
        <colgroup>
          {INVENTORY_COLUMNS.map((c) => (
            <col key={c.id} style={getColStyle(c.id)} />
          ))}
        </colgroup>
        <thead>
          <tr>
            <th>
              Name
              <ColumnResizeHandle {...getHandleProps('name')} />
            </th>
            <th>
              Kind
              <ColumnResizeHandle {...getHandleProps('kind')} />
            </th>
            <th>
              Amount
              <ColumnResizeHandle {...getHandleProps('amount')} />
            </th>
            <th>
              Freshness
              <ColumnResizeHandle {...getHandleProps('freshness')} />
            </th>
            <th>
              Value
              <ColumnResizeHandle {...getHandleProps('value')} />
            </th>
            <th>
              Vendor
              <ColumnResizeHandle {...getHandleProps('vendor')} />
            </th>
            <th>
              Best-by
              <ColumnResizeHandle {...getHandleProps('bestby')} />
            </th>
            <th>
              Par
              <ColumnResizeHandle {...getHandleProps('par')} />
            </th>
            <th>
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const low = isLowStock(item)
            return (
              <tr key={item.id}>
                <td>
                  <button
                    type="button"
                    onClick={() => onEdit(item)}
                    className="text-left font-medium underline-offset-2 hover:underline"
                  >
                    {item.name}
                  </button>
                </td>
                <td>
                  {KIND_ICONS[item.ingredientKind]} {KIND_LABELS[item.ingredientKind]}
                </td>
                <td className="font-mono">
                  {item.amount} {item.amountUnit}
                  {low && <span className="mini-alert warn ml-1">low</span>}
                </td>
                <td>
                  <FreshnessBadge item={item} now={now} />
                </td>
                <td className="font-mono">{fmtUSD(itemValue(item))}</td>
                <td>{item.vendor ?? '—'}</td>
                <td className="font-mono">{toDateInput(item.bestByDate) || '—'}</td>
                <td className="font-mono">
                  {item.parLevel !== undefined
                    ? `${fmtQty(item.parLevel)} ${item.amountUnit}`
                    : '—'}
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    <button type="button" onClick={() => onLedger(item)} className="btn-ghost">
                      Ledger
                    </button>
                    <button type="button" onClick={() => onEdit(item)} className="btn-ghost">
                      Edit
                    </button>
                    <button
                      type="button"
                      onClick={() => onDelete(item.id, item.name)}
                      className="btn-ghost danger"
                    >
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function InventoryCard({
  item,
  now,
  onEdit,
  onDelete,
  onLedger,
}: {
  item: InventoryItem
  now: Date
  onEdit: () => void
  onDelete: () => void
  onLedger: () => void
}) {
  const low = isLowStock(item)
  const stale = isPastBestBy(item, now)

  return (
    <div className="tap-card flex flex-col p-4 text-card-foreground">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="chip-icon mt-0.5">
          {KIND_ICONS[item.ingredientKind]}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.95rem] font-semibold leading-tight">{item.name}</h3>
          <p className="mt-0.5 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
            {item.ingredientKind}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {item.status === 'opened' && <span className="mini-alert info">opened</span>}
          {low && <span className="mini-alert warn">low</span>}
          {stale && <span className="mini-alert warn">expired</span>}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <div
          className="font-mono text-lg font-semibold"
          style={{ color: 'var(--malt, var(--primary))' }}
        >
          {item.amount} <span className="text-sm text-muted-foreground">{item.amountUnit}</span>
        </div>
        <FreshnessBadge item={item} now={now} />
      </div>

      <dl className="mt-2 grid grid-cols-1 gap-1 text-xs text-muted-foreground">
        {item.vendor && <Row label="Vendor" value={item.vendor} />}
        {item.purchaseDate && <Row label="Bought" value={toDateInput(item.purchaseDate)} mono />}
        {item.bestByDate && <Row label="Best by" value={toDateInput(item.bestByDate)} mono />}
        {item.storageLocation && <Row label="Location" value={item.storageLocation} />}
        {item.pricePerUnit_USD !== undefined && (
          <Row
            label="Price"
            value={`$${item.pricePerUnit_USD.toFixed(2)} / ${item.amountUnit}`}
            mono
          />
        )}
        {item.parLevel !== undefined && (
          <Row label="Par" value={`${fmtQty(item.parLevel)} ${item.amountUnit}`} mono />
        )}
        <Row label="Value" value={fmtUSD(itemValue(item))} mono />
      </dl>

      <div className="mt-4 flex items-center justify-end gap-2 border-t border-border/60 pt-3">
        <button type="button" onClick={onLedger} className="btn-ghost">
          📒 Ledger
        </button>
        <button type="button" onClick={onEdit} className="btn-ghost">
          Edit
        </button>
        <button type="button" onClick={onDelete} className="btn-ghost danger">
          Delete
        </button>
      </div>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="shrink-0 text-[0.7rem] uppercase tracking-wide text-muted-foreground/70">
        {label}
      </dt>
      <dd className={`truncate text-foreground/85 ${mono ? 'font-mono' : ''}`}>{value}</dd>
    </div>
  )
}

function InventoryEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: InventoryItem
  onSave: (item: InventoryItem) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<InventoryItem>(item)

  const update = <K extends keyof InventoryItem>(key: K, value: InventoryItem[K]) => {
    setDraft((d) => ({ ...d, [key]: value }))
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        onSave(draft)
      }}
      className="tap-card flex flex-col gap-3 p-5"
    >
      <h2 className="text-lg font-semibold">
        {item.name ? `Edit "${item.name}"` : 'New inventory item'}
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Name</span>
          <input
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            required
            placeholder="Cascade pellets 2024"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Kind</span>
          <select
            value={draft.ingredientKind}
            onChange={(e) => update('ingredientKind', e.target.value as InventoryKind)}
            className="field"
          >
            {Object.entries(KIND_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {KIND_ICONS[key as InventoryKind]} {label}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Amount</span>
          <input
            type="number"
            step="0.01"
            value={draft.amount}
            onChange={(e) => update('amount', Number(e.target.value))}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Unit</span>
          <select
            value={draft.amountUnit}
            onChange={(e) => update('amountUnit', e.target.value as InventoryItem['amountUnit'])}
            className="field"
          >
            <option value="g">g</option>
            <option value="kg">kg</option>
            <option value="oz">oz</option>
            <option value="lb">lb</option>
            <option value="ml">ml</option>
            <option value="L">L</option>
            <option value="each">each</option>
            <option value="packets">packets</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Low-stock threshold</span>
          <input
            type="number"
            step="0.01"
            value={draft.lowStockThreshold ?? ''}
            onChange={(e) =>
              update('lowStockThreshold', e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="Alert when below…"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Par level</span>
          <input
            type="number"
            step="0.01"
            value={draft.parLevel ?? ''}
            onChange={(e) =>
              update('parLevel', e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="Restock target…"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Status</span>
          <select
            value={draft.status}
            onChange={(e) => update('status', e.target.value as InventoryItem['status'])}
            className="field"
          >
            <option value="sealed">sealed</option>
            <option value="opened">opened</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Opened date</span>
          <input
            type="date"
            value={toDateInput(draft.openedDate)}
            onChange={(e) => update('openedDate', fromDateInput(e.target.value))}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Vendor</span>
          <input
            value={draft.vendor ?? ''}
            onChange={(e) => update('vendor', e.target.value || undefined)}
            placeholder="Yakima Valley Hops"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Storage location</span>
          <input
            value={draft.storageLocation ?? ''}
            onChange={(e) => update('storageLocation', e.target.value || undefined)}
            placeholder="Freezer #2"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Purchase date</span>
          <input
            type="date"
            value={toDateInput(draft.purchaseDate)}
            onChange={(e) => update('purchaseDate', fromDateInput(e.target.value))}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Best-by date</span>
          <input
            type="date"
            value={toDateInput(draft.bestByDate)}
            onChange={(e) => update('bestByDate', fromDateInput(e.target.value))}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Price per unit (USD)</span>
          <input
            type="number"
            step="0.01"
            value={draft.pricePerUnit_USD ?? ''}
            onChange={(e) =>
              update('pricePerUnit_USD', e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="0.50"
            className="field"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-sm">Notes</span>
        <textarea
          value={draft.notes_md}
          onChange={(e) => update('notes_md', e.target.value)}
          rows={2}
          className="field"
        />
      </label>

      <div className="mt-1 flex items-center gap-2">
        <button type="submit" className="btn-primary">
          Save
        </button>
        <button type="button" onClick={onCancel} className="btn-ghost">
          Cancel
        </button>
      </div>
    </form>
  )
}

/** Live-query one item's stock ledger, chronological. Mirrors `useReadings`. */
function useStockLedger(itemId: string): StockTransaction[] {
  const [rows, setRows] = useState<StockTransaction[]>([])
  useEffect(() => {
    const sub = liveQuery(() => stockTransactionsRepo.listByItem(itemId)).subscribe({
      next: (r) => setRows(r),
      error: (e) => reportDbError('stock-ledger', e),
    })
    return () => sub.unsubscribe()
  }, [itemId])
  return rows
}

/**
 * Stock-ledger modal: current on-hand + an Adjust-± form (routes through the
 * atomic `applyStockChange`) + a chronological history timeline with running
 * balance. Reuses the proven `.water-overlay`/`.water-modal` pattern.
 */
function LedgerModal({ itemId, onClose }: { itemId: string; onClose: () => void }) {
  const { items } = useInventoryStore()
  const item = items.find((i) => i.id === itemId) ?? null
  const ledger = useStockLedger(itemId)
  const balances = useMemo(() => runningBalances(ledger), [ledger])

  const [direction, setDirection] = useState<'add' | 'remove'>('add')
  const [magnitude, setMagnitude] = useState('')
  const [reason, setReason] =
    useState<Extract<StockReason, 'restock' | 'manual-adjust' | 'spoilage'>>('restock')
  const [note, setNote] = useState('')

  // If the item is deleted out from under the modal, close it.
  useEffect(() => {
    if (!item) onClose()
  }, [item, onClose])
  if (!item) return null

  const mag = Number(magnitude)
  const validMag = Number.isFinite(mag) && mag > 0
  const delta = direction === 'remove' ? -mag : mag

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!validMag) return
    try {
      const balance = await stockTransactionsRepo.applyStockChange({
        inventoryItemId: itemId,
        delta,
        reason,
        note: note.trim() === '' ? undefined : note.trim(),
      })
      toast.success(`Adjusted "${item.name}" → ${fmtQty(balance)} ${item.amountUnit}`)
      setMagnitude('')
      setNote('')
    } catch (err) {
      toast.error(`Adjust failed: ${(err as Error).message}`)
    }
  }

  return (
    <div
      className="water-overlay"
      style={{ background: 'color-mix(in oklab, black 55%, transparent)' }}
    >
      <div className="water-modal tap-card">
        <header className="water-modal-head">
          <h3 className="text-base font-semibold">📒 {item.name} — stock ledger</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close ledger">
            ✕
          </button>
        </header>

        <div className="stat-tile self-start">
          <span className="num">
            {fmtQty(item.amount)} {item.amountUnit}
          </span>
          <span className="lbl">On hand</span>
        </div>

        <form className="flex flex-col gap-3" onSubmit={onSubmit}>
          <div className="water-field">
            <span>Direction</span>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.25rem' }}>
              <button
                type="button"
                className={direction === 'add' ? 'btn-primary' : 'btn-ghost'}
                aria-pressed={direction === 'add'}
                onClick={() => {
                  setDirection('add')
                  setReason('restock')
                }}
              >
                ＋ Add
              </button>
              <button
                type="button"
                className={direction === 'remove' ? 'btn-primary' : 'btn-ghost'}
                aria-pressed={direction === 'remove'}
                onClick={() => {
                  setDirection('remove')
                  setReason('spoilage')
                }}
              >
                − Remove
              </button>
            </div>
          </div>

          <label className="water-field">
            <span>Amount ({item.amountUnit})</span>
            <input
              type="number"
              step="0.01"
              min="0"
              value={magnitude}
              onChange={(e) => setMagnitude(e.target.value)}
              placeholder="0"
              className="field"
              aria-label="Adjust amount"
            />
          </label>

          <label className="water-field">
            <span>Reason</span>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as typeof reason)}
              className="field"
              aria-label="Adjust reason"
            >
              {ADJUST_REASONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>

          <label className="water-field">
            <span>Note (optional)</span>
            <input
              type="text"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. found a second bag"
              className="field"
              aria-label="Adjust note"
            />
          </label>

          <button type="submit" className="btn-primary" disabled={!validMag}>
            {direction === 'remove' ? 'Remove stock' : 'Add stock'}
          </button>
        </form>

        <div>
          <h4 className="mb-2 text-sm font-semibold">History</h4>
          {ledger.length === 0 ? (
            <p className="text-sm text-muted-foreground">No transactions yet.</p>
          ) : (
            <table className="sheet-table ferment-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Reason</th>
                  <th>Change</th>
                  <th>Balance</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {ledger.map((t, i) => (
                  <tr key={t.id}>
                    <td>{new Date(t.at).toLocaleString()}</td>
                    <td>{REASON_LABELS[t.reason]}</td>
                    <td>
                      <span className={`mini-alert ${t.delta >= 0 ? 'go' : 'warn'}`}>
                        {t.delta >= 0 ? '+' : ''}
                        {fmtQty(t.delta)} {t.unit}
                      </span>
                    </td>
                    <td className="font-mono">
                      {fmtQty(balances[i])} {item.amountUnit}
                    </td>
                    <td>{t.note ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  )
}
