import type ExcelJS from 'exceljs'
import {
  GEAR_COLUMNS,
  INGREDIENT_COLUMNS,
  type ReportColumn,
  type ReportContext,
} from '@/lib/brewing/report/columns'
import type {
  GearSection,
  IngredientSection,
  InventoryReport,
  ReportGroup,
} from '@/lib/brewing/report/inventory-report'

export function reportFilename(report: InventoryReport): string {
  return `beer-lab-ware-inventory-${report.generatedAtISO.slice(0, 10)}.xlsx`
}

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3E8D8' },
}

function addSheet<T extends { id: string; name: string }>(
  wb: ExcelJS.Workbook,
  name: string,
  report: InventoryReport,
  columns: ReportColumn<T>[],
  groups: ReportGroup<T>[],
  summaryLines: string[],
  ctx: ReportContext,
): void {
  const ws = wb.addWorksheet(name)
  const colCount = columns.length
  const merge = (row: number) => ws.mergeCells(row, 1, row, colCount)

  ws.getCell('A1').value = `🍺 ${report.title}`
  ws.getCell('A1').font = { bold: true, size: 16 }
  merge(1)
  ws.getCell('A2').value = report.subtitle
  ws.getCell('A2').font = { italic: true, size: 12 }
  merge(2)
  ws.getCell('A3').value = `Generated ${report.generatedAtISO.slice(0, 10)}`
  merge(3)

  let r = 5
  for (const line of summaryLines) {
    ws.getCell(`A${r}`).value = line
    merge(r)
    r += 1
  }
  r += 1

  const headerRowIdx = r
  const header = ws.getRow(headerRowIdx)
  header.values = columns.map((c) => c.header)
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL
  })
  columns.forEach((c, i) => {
    ws.getColumn(i + 1).width = c.width ?? 16
  })

  let dataIdx = headerRowIdx + 1
  if (groups.length === 0) {
    ws.getCell(`A${dataIdx}`).value = 'No items'
    merge(dataIdx)
  } else {
    for (const group of groups) {
      for (const item of group.items) {
        ws.getRow(dataIdx).values = columns.map((c) => c.get(item, ctx))
        dataIdx += 1
      }
    }
  }

  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }]
  const lastDataIdx = Math.max(dataIdx - 1, headerRowIdx)
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: lastDataIdx, column: colCount },
  }
}

function gearSummary(s: GearSection): string[] {
  return [...s.groups.map((g) => `${g.label}: ${g.count}`), `Total gear: ${s.totalCount}`]
}

function ingredientSummary(s: IngredientSection): string[] {
  return [
    ...s.groups.map((g) => `${g.label}: ${g.count}`),
    `Total ingredients: ${s.totalCount}`,
    `Low stock: ${s.lowStockCount}`,
    `Past best-by: ${s.pastBestByCount}`,
  ]
}

export async function buildWorkbook(report: InventoryReport): Promise<ExcelJS.Workbook> {
  const ExcelJSModule = await import('exceljs')
  const Workbook = ExcelJSModule.default?.Workbook ?? ExcelJSModule.Workbook
  const wb: ExcelJS.Workbook = new Workbook()
  wb.creator = report.title
  const ctx: ReportContext = { generatedAt: new Date(report.generatedAtISO) }

  addSheet(wb, 'Gear', report, GEAR_COLUMNS, report.gear.groups, gearSummary(report.gear), ctx)
  addSheet(
    wb,
    'Ingredients',
    report,
    INGREDIENT_COLUMNS,
    report.ingredients.groups,
    ingredientSummary(report.ingredients),
    ctx,
  )
  return wb
}

export async function downloadInventoryWorkbook(report: InventoryReport): Promise<void> {
  const wb = await buildWorkbook(report)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = reportFilename(report)
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
