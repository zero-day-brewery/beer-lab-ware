import type { GearItem } from '@/lib/brewing/types/gear'
import { type InventoryItem, isLowStock } from '@/lib/brewing/types/inventory'

export interface ReportContext {
  generatedAt: Date
}

export interface ReportColumn<T> {
  header: string
  get: (item: T, ctx: ReportContext) => string
  width?: number
}

const fmtDate = (iso?: string): string => (iso ? iso.slice(0, 10) : '')
const fmtMoney = (n?: number): string => (n === undefined ? '' : `$${n.toFixed(2)}`)
const titleCase = (s: string): string =>
  s
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ')

const KIND_LABEL: Record<string, string> = {
  fermentable: 'Fermentables',
  hop: 'Hops',
  yeast: 'Yeast',
  misc: 'Misc',
  'water-treatment': 'Water Treatment',
  other: 'Other',
}

export const GEAR_COLUMNS: ReportColumn<GearItem>[] = [
  { header: 'Name', get: (g) => g.name, width: 28 },
  { header: 'Category', get: (g) => titleCase(g.category), width: 14 },
  { header: 'Brand', get: (g) => g.brand ?? '', width: 16 },
  { header: 'Model', get: (g) => g.model ?? '', width: 16 },
  { header: 'Serial #', get: (g) => g.serialNumber ?? '', width: 16 },
  { header: 'Condition', get: (g) => titleCase(g.condition), width: 12 },
  { header: 'Location', get: (g) => g.location ?? '', width: 18 },
  { header: 'Vendor', get: (g) => g.vendor ?? '', width: 16 },
  { header: 'Purchase Date', get: (g) => fmtDate(g.purchaseDate), width: 14 },
  { header: 'Price Paid (USD)', get: (g) => fmtMoney(g.pricePaid_USD), width: 14 },
  { header: 'Notes', get: (g) => g.notes_md, width: 40 },
]

export const INGREDIENT_COLUMNS: ReportColumn<InventoryItem>[] = [
  { header: 'Name', get: (i) => i.name, width: 28 },
  { header: 'Kind', get: (i) => KIND_LABEL[i.ingredientKind] ?? i.ingredientKind, width: 16 },
  { header: 'Amount', get: (i) => String(i.amount), width: 10 },
  { header: 'Unit', get: (i) => i.amountUnit, width: 8 },
  { header: 'Status', get: (i) => titleCase(i.status), width: 10 },
  { header: 'Low Stock', get: (i) => (isLowStock(i) ? 'LOW' : ''), width: 10 },
  { header: 'Vendor', get: (i) => i.vendor ?? '', width: 16 },
  { header: 'Best-By', get: (i) => fmtDate(i.bestByDate), width: 12 },
  { header: 'Location', get: (i) => i.storageLocation ?? '', width: 18 },
  { header: 'Price/Unit (USD)', get: (i) => fmtMoney(i.pricePerUnit_USD), width: 14 },
  { header: 'Notes', get: (i) => i.notes_md, width: 40 },
]
