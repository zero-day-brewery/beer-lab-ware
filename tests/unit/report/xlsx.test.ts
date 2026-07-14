import { describe, expect, it } from 'vitest'
import { buildInventoryReport } from '@/lib/brewing/report/inventory-report'
import { buildWorkbook, reportFilename } from '@/lib/report/xlsx'

const NOW = new Date('2026-06-05T12:00:00.000Z')

const report = buildInventoryReport({
  gear: [
    {
      id: 'g1',
      name: 'B40 Pro',
      category: 'mash-tun',
      condition: 'good',
      notes_md: '',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      schemaVersion: 1,
    },
  ],
  inventory: [
    {
      id: 'i1',
      name: 'Cascade',
      ingredientKind: 'hop',
      amount: 1,
      amountUnit: 'kg',
      status: 'sealed',
      notes_md: '',
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      schemaVersion: 1,
    },
  ],
  generatedAt: NOW,
})

describe('buildWorkbook', () => {
  it('creates Gear and Ingredients sheets with title + headers + data', async () => {
    const wb = await buildWorkbook(report)
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Gear', 'Ingredients'])

    const gear = wb.getWorksheet('Gear')
    if (!gear) throw new Error('Gear worksheet missing')
    expect(String(gear.getCell('A1').value)).toContain('Beer-Lab-Ware')

    let foundHeader = false
    let dataRows = 0
    gear.eachRow((row) => {
      const vals = (row.values as unknown[]).map((v) => String(v ?? ''))
      if (vals.includes('Name') && vals.includes('Category')) foundHeader = true
      if (vals.includes('B40 Pro')) dataRows += 1
    })
    expect(foundHeader).toBe(true)
    expect(dataRows).toBe(1)
  })

  it('derives a dated filename', () => {
    expect(reportFilename(report)).toBe('beer-lab-ware-inventory-2026-06-05.xlsx')
  })
})
