import {
  GEAR_COLUMNS,
  INGREDIENT_COLUMNS,
  type ReportColumn,
  type ReportContext,
} from '@/lib/brewing/report/columns'
import type { InventoryReport, ReportGroup } from '@/lib/brewing/report/inventory-report'

function GroupTable<T extends { id: string; name: string }>({
  group,
  columns,
  ctx,
}: {
  group: ReportGroup<T>
  columns: ReportColumn<T>[]
  ctx: ReportContext
}) {
  return (
    <div className="report-group">
      <h3 className="report-group-title">
        {group.label} <span className="report-group-count">({group.count})</span>
      </h3>
      <div className="report-scroll">
        <table className="report-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.header}>{c.header}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {group.items.map((item) => (
              <tr key={item.id}>
                {columns.map((c) => (
                  <td key={c.header}>{c.get(item, ctx)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

export function ReportView({ report }: { report: InventoryReport }) {
  const ctx: ReportContext = { generatedAt: new Date(report.generatedAtISO) }
  return (
    <article className="report-body">
      <header className="report-header">
        <span className="eyebrow print:hidden">📋 Inventory Report</span>
        <h1>🍺 {report.title}</h1>
        <p className="report-subtitle">{report.subtitle}</p>
        <p className="report-meta">
          Generated {report.generatedAtISO.slice(0, 10)} · Gear: {report.gear.totalCount} ·
          Ingredients: {report.ingredients.totalCount} · Low stock:{' '}
          {report.ingredients.lowStockCount} · Past best-by: {report.ingredients.pastBestByCount}
        </p>
      </header>

      <section className="report-section">
        <h2>Gear &amp; Equipment</h2>
        {report.gear.groups.length === 0 ? (
          <p className="report-empty">No gear recorded.</p>
        ) : (
          report.gear.groups.map((g) => (
            <GroupTable key={g.key} group={g} columns={GEAR_COLUMNS} ctx={ctx} />
          ))
        )}
      </section>

      <section className="report-section">
        <h2>Ingredients &amp; Consumables</h2>
        {report.ingredients.groups.length === 0 ? (
          <p className="report-empty">No ingredients recorded.</p>
        ) : (
          report.ingredients.groups.map((g) => (
            <GroupTable key={g.key} group={g} columns={INGREDIENT_COLUMNS} ctx={ctx} />
          ))
        )}
      </section>
    </article>
  )
}
