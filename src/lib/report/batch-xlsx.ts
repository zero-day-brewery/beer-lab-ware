import type ExcelJS from 'exceljs'
import { costPerDisplayVolume } from '@/lib/brewing/report/batch-cost'
import {
  BATCH_COST_COLUMNS,
  type BatchRecord,
  batchLogColumns,
  batchReadingColumns,
  batchRecordFilename,
} from '@/lib/brewing/report/batch-record'
import type { ReportColumn, ReportContext } from '@/lib/brewing/report/columns'
import { downloadBlob } from '@/lib/report/download'

/**
 * Completed-batch record workbook — Batch (metadata, results vs targets,
 * tasting), Timeline (log entries), Readings, and Cost (the per-batch COGS
 * report, included only when the batch has costed ledger lines). Follows the
 * inventory workbook's structure: title block, styled header row, frozen
 * header + autofilter on the tabular sheets.
 */

const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFF3E8D8' },
}

function addTitle(ws: ExcelJS.Worksheet, record: BatchRecord, colCount: number): number {
  const merge = (row: number) => ws.mergeCells(row, 1, row, Math.max(colCount, 2))
  ws.getCell('A1').value = `🍺 ${record.title}`
  ws.getCell('A1').font = { bold: true, size: 16 }
  merge(1)
  ws.getCell('A2').value = record.subtitle
  ws.getCell('A2').font = { italic: true, size: 12 }
  merge(2)
  ws.getCell('A3').value = `Generated ${record.generatedAtISO.slice(0, 10)}`
  merge(3)
  return 5
}

/** Write a header + data table at `startRow`; returns the row AFTER the table. */
function writeTable<T>(
  ws: ExcelJS.Worksheet,
  startRow: number,
  columns: ReportColumn<T>[],
  rows: readonly T[],
  ctx: ReportContext,
): number {
  const header = ws.getRow(startRow)
  header.values = columns.map((c) => c.header)
  header.font = { bold: true }
  header.eachCell((cell) => {
    cell.fill = HEADER_FILL
  })
  columns.forEach((c, i) => {
    const col = ws.getColumn(i + 1)
    col.width = Math.max(col.width ?? 0, c.width ?? 16)
  })
  let r = startRow + 1
  if (rows.length === 0) {
    ws.getCell(r, 1).value = 'No entries'
    r += 1
  } else {
    for (const row of rows) {
      ws.getRow(r).values = columns.map((c) => c.get(row, ctx))
      r += 1
    }
  }
  return r
}

/** A tabular sheet (title block + one table) with frozen header + autofilter. */
function addTableSheet<T>(
  wb: ExcelJS.Workbook,
  name: string,
  record: BatchRecord,
  columns: ReportColumn<T>[],
  rows: readonly T[],
  ctx: ReportContext,
  summaryLines: string[] = [],
): void {
  const ws = wb.addWorksheet(name)
  let r = addTitle(ws, record, columns.length)
  for (const line of summaryLines) {
    ws.getCell(r, 1).value = line
    ws.mergeCells(r, 1, r, columns.length)
    r += 1
  }
  if (summaryLines.length > 0) r += 1
  const headerRowIdx = r
  const end = writeTable(ws, headerRowIdx, columns, rows, ctx)
  ws.views = [{ state: 'frozen', ySplit: headerRowIdx }]
  ws.autoFilter = {
    from: { row: headerRowIdx, column: 1 },
    to: { row: Math.max(end - 1, headerRowIdx), column: columns.length },
  }
}

const TARGET_ACTUAL_COLUMNS: ReportColumn<BatchRecord['targetsVsActuals'][number]>[] = [
  { header: 'Metric', get: (r) => r.metric, width: 22 },
  { header: 'Target', get: (r) => r.target, width: 14 },
  { header: 'Actual', get: (r) => r.actual, width: 14 },
]

function addBatchSheet(wb: ExcelJS.Workbook, record: BatchRecord, ctx: ReportContext): void {
  const ws = wb.addWorksheet('Batch')
  let r = addTitle(ws, record, 3)

  for (const kv of record.meta) {
    ws.getCell(r, 1).value = kv.label
    ws.getCell(r, 1).font = { bold: true }
    ws.getCell(r, 2).value = kv.value
    r += 1
  }
  r += 1

  ws.getCell(r, 1).value = 'Results vs targets'
  ws.getCell(r, 1).font = { bold: true, size: 12 }
  r += 1
  r = writeTable(ws, r, TARGET_ACTUAL_COLUMNS, record.targetsVsActuals, ctx)
  r += 1

  if (record.tasting.length > 0) {
    ws.getCell(r, 1).value = 'Tasting'
    ws.getCell(r, 1).font = { bold: true, size: 12 }
    r += 1
    for (const kv of record.tasting) {
      ws.getCell(r, 1).value = kv.label
      ws.getCell(r, 1).font = { bold: true }
      ws.getCell(r, 2).value = kv.value
      r += 1
    }
  }
  ws.getColumn(1).width = 22
  ws.getColumn(2).width = 40
  ws.getColumn(3).width = 14
}

function costSummaryLines(record: BatchRecord): string[] {
  const cost = record.cost
  const lines = [`Known cost: $${cost.knownCost.toFixed(2)} ${cost.currency}`]
  const perVol = costPerDisplayVolume(cost, record.units)
  if (perVol) {
    lines.push(`Cost per ${perVol.volumeUnit}: $${perVol.value.toFixed(2)} ${cost.currency}`)
  }
  const n = cost.unknownLines.length
  if (n > 0) {
    lines.push(`${n} item${n === 1 ? '' : 's'} unpriced — excluded from the total`)
  }
  return lines
}

export async function buildBatchWorkbook(record: BatchRecord): Promise<ExcelJS.Workbook> {
  const ExcelJSModule = await import('exceljs')
  const Workbook = ExcelJSModule.default?.Workbook ?? ExcelJSModule.Workbook
  const wb: ExcelJS.Workbook = new Workbook()
  wb.creator = record.title
  const ctx: ReportContext = { generatedAt: new Date(record.generatedAtISO) }

  addBatchSheet(wb, record, ctx)
  addTableSheet(wb, 'Timeline', record, batchLogColumns(record.units), record.logs, ctx)
  addTableSheet(wb, 'Readings', record, batchReadingColumns(record.units), record.readings, ctx)
  if (record.cost.lines.length > 0) {
    addTableSheet(
      wb,
      'Cost',
      record,
      BATCH_COST_COLUMNS,
      record.cost.lines,
      ctx,
      costSummaryLines(record),
    )
  }
  return wb
}

export async function downloadBatchWorkbook(record: BatchRecord): Promise<void> {
  const wb = await buildBatchWorkbook(record)
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  downloadBlob(blob, batchRecordFilename(record))
}
