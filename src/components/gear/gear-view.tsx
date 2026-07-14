'use client'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { EquipmentRow } from '@/components/system/equipment-row'
import { GEAR_CATEGORY_LABELS, groupGearByCategory } from '@/lib/brewing/gear/group-by-category'
import {
  type GearCategory,
  type GearCondition,
  type GearItem,
  GearItemSchema,
} from '@/lib/brewing/types/gear'
import { gearRepo } from '@/lib/db/repos/gear'
import { newId } from '@/lib/utils/id'
import { useGearStore } from '@/stores/gear-store'

const CATEGORY_ICONS: Record<GearCategory, string> = {
  kettle: '🍲',
  'mash-tun': '🛢️',
  fermenter: '🫙',
  pump: '⚙️',
  instrument: '🧪',
  kegging: '🛢️',
  bottling: '🍾',
  cleaning: '🧽',
  storage: '📦',
  other: '🔧',
}

const CONDITION_CLASS: Record<GearCondition, string> = {
  new: 'cond cond-new',
  good: 'cond cond-good',
  worn: 'cond cond-worn',
  broken: 'cond cond-broken',
  retired: 'cond cond-retired',
}

const VIEW_MODE_KEY = 'gear-view-mode'
const COLLAPSED_KEY = 'gear-collapsed-cats'

function freshItem(): GearItem {
  const now = new Date().toISOString()
  return {
    id: newId(),
    name: '',
    category: 'other',
    condition: 'good',
    notes_md: '',
    createdAt: now,
    updatedAt: now,
    schemaVersion: 1,
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

function usd0(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`
}

function loadCollapsed(): Set<GearCategory> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as GearCategory[])
  } catch {
    return new Set()
  }
}

function Chevron() {
  return (
    <svg className="ferm-chevron" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        d="M6 9l6 6 6-6"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function GearView() {
  const { items, isLoading } = useGearStore()
  const [editing, setEditing] = useState<GearItem | null>(null)
  const [filterCategory, setFilterCategory] = useState<GearCategory | 'all'>('all')
  const [search, setSearch] = useState('')
  // Single-expand accordion: exactly one gear row is open at a time (mirrors the
  // fermenter rows' `expandedFerm` in system-view).
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [viewMode, setViewMode] = useState<'rows' | 'cards'>(() => {
    if (typeof window === 'undefined') return 'rows'
    return window.localStorage.getItem(VIEW_MODE_KEY) === 'cards' ? 'cards' : 'rows'
  })
  const [collapsed, setCollapsed] = useState<Set<GearCategory>>(loadCollapsed)

  useEffect(() => {
    if (typeof window !== 'undefined') window.localStorage.setItem(VIEW_MODE_KEY, viewMode)
  }, [viewMode])

  useEffect(() => {
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify(Array.from(collapsed)))
    }
  }, [collapsed])

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    return items.filter((i) => {
      if (filterCategory !== 'all' && i.category !== filterCategory) return false
      if (!q) return true
      const hay = [
        i.name,
        GEAR_CATEGORY_LABELS[i.category],
        i.location,
        i.brand,
        i.model,
        i.vendor,
        i.condition,
      ]
      return hay.some((f) => f?.toLowerCase().includes(q))
    })
  }, [items, filterCategory, search])

  const groups = useMemo(() => groupGearByCategory(visibleItems), [visibleItems])

  const toggleSection = (cat: GearCategory) => {
    setCollapsed((cur) => {
      const next = new Set(cur)
      if (next.has(cat)) next.delete(cat)
      else next.add(cat)
      return next
    })
  }

  const onSave = async (item: GearItem) => {
    try {
      const parsed = GearItemSchema.parse(item)
      await gearRepo.save(parsed)
      toast.success(`Saved "${parsed.name}"`)
      setEditing(null)
    } catch (err) {
      toast.error(`Save failed: ${(err as Error).message}`)
    }
  }

  const onDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"?`)) return
    try {
      await gearRepo.delete(id)
      toast.success(`Deleted "${name}"`)
    } catch (err) {
      toast.error(`Delete failed: ${(err as Error).message}`)
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>

  const totalValue = items.reduce((sum, i) => sum + (i.pricePaid_USD ?? 0), 0)
  const unpriced = items.filter((i) => i.pricePaid_USD === undefined).length
  const categoryCount = new Set(items.map((i) => i.category)).size

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-5 border-b border-border/70 pb-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <span className="eyebrow">🦴 Cellar</span>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">Gear inventory</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Every kettle, keg, and hydrometer on the shelf — grouped, valued, and accounted for.
            </p>
          </div>
          <button type="button" onClick={() => setEditing(freshItem())} className="btn-primary">
            <span aria-hidden="true">＋</span>
            <span>Add gear</span>
          </button>
        </div>

        {/* Calm summary strip — cellar-wide roll-up (never touches a single row). */}
        <div className="flex flex-wrap gap-2">
          <div className="stat-tile">
            <span className="num">{items.length}</span>
            <span className="lbl">Items</span>
          </div>
          <div className="stat-tile">
            <span className="num">{usd0(totalValue)}</span>
            <span className="lbl">Value</span>
          </div>
          <div className="stat-tile">
            <span className="num">{categoryCount}</span>
            <span className="lbl">Categories</span>
          </div>
          <div className="stat-tile">
            <span className="num">{unpriced}</span>
            <span className="lbl">Unpriced</span>
          </div>
        </div>

        {/* Controls: search · category filter · rows⇄cards toggle (filter-first). */}
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex-1 text-sm" style={{ minWidth: '12rem' }}>
            <span className="sr-only">Search gear</span>
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, brand, location…"
              aria-label="Search gear"
              className="field w-full"
            />
          </label>

          <label className="text-sm">
            <span className="sr-only">Filter by category</span>
            <select
              aria-label="Filter by category"
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value as GearCategory | 'all')}
              className="field"
            >
              <option value="all">All categories</option>
              {(Object.keys(GEAR_CATEGORY_LABELS) as GearCategory[]).map((key) => (
                <option key={key} value={key}>
                  {CATEGORY_ICONS[key]} {GEAR_CATEGORY_LABELS[key]}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="inline-flex gap-1 border-0 p-0">
            <legend className="sr-only">View mode</legend>
            <button
              type="button"
              onClick={() => setViewMode('rows')}
              aria-pressed={viewMode === 'rows'}
              className={`btn-ghost ${viewMode === 'rows' ? 'is-active' : ''}`}
            >
              Rows
            </button>
            <button
              type="button"
              onClick={() => setViewMode('cards')}
              aria-pressed={viewMode === 'cards'}
              className={`btn-ghost ${viewMode === 'cards' ? 'is-active' : ''}`}
            >
              Cards
            </button>
          </fieldset>
        </div>
      </header>

      {editing && (
        <GearEditForm
          key={editing.id}
          item={editing}
          onSave={onSave}
          onCancel={() => setEditing(null)}
        />
      )}

      {visibleItems.length === 0 && !editing ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="chip-icon mb-4 !h-16 !w-16 !text-4xl">🍺</div>
          <h2 className="text-xl font-semibold">
            {items.length === 0
              ? 'The cellar is empty'
              : filterCategory === 'all'
                ? 'Nothing matches your search'
                : `No ${GEAR_CATEGORY_LABELS[filterCategory]} gear yet`}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted-foreground">
            Track what you own: kettles, hydrometers, kegs, fermenters, capper, CO2 tank — whatever.
          </p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visibleItems.map((item) => (
            <GearCard
              key={item.id}
              item={item}
              onEdit={() => setEditing(item)}
              onDelete={() => onDelete(item.id, item.name)}
            />
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((group) => {
            const isCollapsed = collapsed.has(group.category)
            const groupHasOpen = group.items.some((i) => i.id === expandedId)
            return (
              <section key={group.category} className="ferm-system eq-section">
                <div className="ferm-system-head">
                  <button
                    type="button"
                    className="gear-group-toggle"
                    aria-expanded={!isCollapsed}
                    onClick={() => toggleSection(group.category)}
                  >
                    <span aria-hidden="true">{CATEGORY_ICONS[group.category]}</span>
                    <span className="ferm-system-title">{group.label}</span>
                    <span className="eq-section-count">{group.count}</span>
                    <Chevron />
                  </button>
                  <span className="font-mono text-xs text-muted-foreground">
                    {usd0(group.totalValue)}
                  </span>
                </div>
                {!isCollapsed && (
                  <div className={`ferm-grid group-scroll${groupHasOpen ? ' has-open' : ''}`}>
                    {group.items.map((item) => (
                      <GearRow
                        key={item.id}
                        item={item}
                        expanded={expandedId === item.id}
                        onToggle={() => setExpandedId((cur) => (cur === item.id ? null : item.id))}
                        onEdit={() => setEditing(item)}
                        onDelete={() => onDelete(item.id, item.name)}
                      />
                    ))}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** Compact one-line gear row with inline single-expand detail. Composes the
 *  shared `EquipmentRow` shell (same accent-rail + chevron + reveal as the
 *  fermenter rows), so the whole tab reads as one calm accordion. */
function GearRow({
  item,
  expanded,
  onToggle,
  onEdit,
  onDelete,
}: {
  item: GearItem
  expanded: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const active = item.condition !== 'retired'
  const sub = item.location ?? [item.brand, item.model].filter(Boolean).join(' ')
  return (
    <EquipmentRow
      color="var(--malt, var(--primary))"
      on={active}
      expanded={expanded}
      onToggle={onToggle}
      panelLabel={`${item.name} details`}
      deleteLabel={`Delete ${item.name}`}
      onDelete={onDelete}
      summary={
        <>
          <span className="ferm-dot" />
          <span className="eq-namecol">
            <span className="ferm-name">
              <span aria-hidden="true">{CATEGORY_ICONS[item.category]}</span> {item.name}
            </span>
            {sub && <span className="eq-sub">{sub}</span>}
          </span>
          <span className="eq-summary-right">
            <span className={CONDITION_CLASS[item.condition]}>
              <span className="dot" aria-hidden="true" />
              {item.condition}
            </span>
            <span className="font-mono text-xs text-muted-foreground">
              {item.pricePaid_USD !== undefined ? usd0(item.pricePaid_USD) : '—'}
            </span>
          </span>
        </>
      }
    >
      <dl className="eq-detail-grid">
        {(item.brand || item.model) && (
          <Detail
            label="Brand / Model"
            value={[item.brand, item.model].filter(Boolean).join(' ')}
          />
        )}
        {item.serialNumber && <Detail label="Serial" value={item.serialNumber} mono />}
        {item.vendor && <Detail label="Vendor" value={item.vendor} />}
        {item.location && <Detail label="Location" value={item.location} />}
        {item.purchaseDate && <Detail label="Bought" value={toDateInput(item.purchaseDate)} mono />}
        <Detail
          label="Paid"
          value={item.pricePaid_USD !== undefined ? `$${item.pricePaid_USD.toFixed(2)}` : '—'}
          mono
        />
        <Detail
          label="Replace @"
          value={
            item.replacementCost_USD !== undefined ? `$${item.replacementCost_USD.toFixed(2)}` : '—'
          }
          mono
        />
      </dl>

      {item.notes_md.trim() !== '' && (
        <p className="whitespace-pre-line text-sm text-muted-foreground">{item.notes_md}</p>
      )}

      <div className="flex items-center gap-2">
        <button type="button" onClick={onEdit} className="btn-ghost">
          Edit
        </button>
        <button type="button" onClick={onDelete} className="btn-ghost danger">
          Delete
        </button>
      </div>
    </EquipmentRow>
  )
}

function Detail({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="eq-field">
      <span className="eq-field-label">{label}</span>
      <span className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</span>
    </div>
  )
}

function GearCard({
  item,
  onEdit,
  onDelete,
}: {
  item: GearItem
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="tap-card flex flex-col p-4 text-card-foreground">
      <div className="flex items-start gap-3">
        <span aria-hidden="true" className="chip-icon mt-0.5">
          {CATEGORY_ICONS[item.category]}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[0.95rem] font-semibold leading-tight">{item.name}</h3>
          <p className="mt-0.5 text-[0.7rem] font-medium uppercase tracking-wider text-muted-foreground">
            {GEAR_CATEGORY_LABELS[item.category]}
          </p>
        </div>
        <span className={CONDITION_CLASS[item.condition]}>
          <span className="dot" aria-hidden="true" />
          {item.condition}
        </span>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-1 text-xs text-muted-foreground">
        {(item.brand || item.model) && (
          <Row label="Brand/Model" value={[item.brand, item.model].filter(Boolean).join(' ')} />
        )}
        {item.serialNumber && <Row label="S/N" value={item.serialNumber} mono />}
        {item.vendor && <Row label="Vendor" value={item.vendor} />}
        {item.purchaseDate && <Row label="Bought" value={toDateInput(item.purchaseDate)} mono />}
        {item.location && <Row label="Location" value={item.location} />}
      </dl>

      <div className="mt-4 flex items-center justify-between gap-2 border-t border-border/60 pt-3">
        <div className="flex items-baseline gap-3 font-mono text-sm">
          <span className="flex flex-col leading-tight">
            <span className="font-sans text-[0.6rem] uppercase tracking-wider text-muted-foreground/70">
              Paid
            </span>
            {item.pricePaid_USD !== undefined ? (
              <span className="font-semibold" style={{ color: 'var(--malt, var(--primary))' }}>
                ${item.pricePaid_USD.toFixed(2)}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
          <span className="flex flex-col leading-tight">
            <span className="font-sans text-[0.6rem] uppercase tracking-wider text-muted-foreground/70">
              Replace
            </span>
            {item.replacementCost_USD !== undefined ? (
              <span className="font-semibold text-foreground/85">
                ${item.replacementCost_USD.toFixed(2)}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onEdit} className="btn-ghost">
            Edit
          </button>
          <button type="button" onClick={onDelete} className="btn-ghost danger">
            Delete
          </button>
        </div>
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

function GearEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: GearItem
  onSave: (item: GearItem) => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<GearItem>(item)

  const update = <K extends keyof GearItem>(key: K, value: GearItem[K]) => {
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
        {item.name ? `Edit "${item.name}"` : 'New gear item'}
      </h2>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className="text-sm">Name</span>
          <input
            value={draft.name}
            onChange={(e) => update('name', e.target.value)}
            required
            placeholder="10gal Stainless Kettle"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Category</span>
          <select
            value={draft.category}
            onChange={(e) => update('category', e.target.value as GearCategory)}
            className="field"
          >
            {(Object.keys(GEAR_CATEGORY_LABELS) as GearCategory[]).map((key) => (
              <option key={key} value={key}>
                {CATEGORY_ICONS[key]} {GEAR_CATEGORY_LABELS[key]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Brand</span>
          <input
            value={draft.brand ?? ''}
            onChange={(e) => update('brand', e.target.value || undefined)}
            placeholder="Anvil Brewing"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Model</span>
          <input
            value={draft.model ?? ''}
            onChange={(e) => update('model', e.target.value || undefined)}
            placeholder="Foundry 10.5"
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Serial number</span>
          <input
            value={draft.serialNumber ?? ''}
            onChange={(e) => update('serialNumber', e.target.value || undefined)}
            className="field font-mono"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Condition</span>
          <select
            value={draft.condition}
            onChange={(e) => update('condition', e.target.value as GearCondition)}
            className="field"
          >
            <option value="new">new</option>
            <option value="good">good</option>
            <option value="worn">worn</option>
            <option value="broken">broken</option>
            <option value="retired">retired</option>
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Vendor</span>
          <input
            value={draft.vendor ?? ''}
            onChange={(e) => update('vendor', e.target.value || undefined)}
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Location</span>
          <input
            value={draft.location ?? ''}
            onChange={(e) => update('location', e.target.value || undefined)}
            placeholder="Garage shelf 2"
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
          <span className="text-sm">Price paid (USD)</span>
          <input
            type="number"
            step="0.01"
            value={draft.pricePaid_USD ?? ''}
            onChange={(e) =>
              update('pricePaid_USD', e.target.value ? Number(e.target.value) : undefined)
            }
            className="field"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-sm">Replacement cost (USD)</span>
          <input
            type="number"
            step="0.01"
            value={draft.replacementCost_USD ?? ''}
            onChange={(e) =>
              update('replacementCost_USD', e.target.value ? Number(e.target.value) : undefined)
            }
            placeholder="current price to re-buy"
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
