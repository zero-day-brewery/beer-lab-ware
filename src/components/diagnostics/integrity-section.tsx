'use client'
import { useState } from 'react'
import { autoFixLedger, type DoctorReport, runDataDoctor } from '@/lib/db/doctor'
import { reportDbError } from '@/lib/diagnostics/error-log'

export function IntegritySection() {
  const [report, setReport] = useState<DoctorReport | null>(null)
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    try {
      setReport(await runDataDoctor())
    } catch (e) {
      reportDbError('doctor', e)
    } finally {
      setRunning(false)
    }
  }

  // Only C1 exposes an auto-fix today (autoFixLedger recomputes amount = Σ deltas,
  // appends no txn). Re-run the doctor afterwards so the checklist reflects the fix.
  const fix = async () => {
    setRunning(true)
    try {
      await autoFixLedger()
      setReport(await runDataDoctor())
    } catch (e) {
      reportDbError('doctor-fix', e)
    } finally {
      setRunning(false)
    }
  }

  const failed = report?.checks.filter((c) => !c.ok) ?? []

  return (
    <section className="tap-card flex flex-col gap-3 p-5" data-testid="diag-integrity">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold">Integrity</h2>
        <button type="button" className="btn-ghost" onClick={() => void run()} disabled={running}>
          {running ? 'Checking…' : 'Run integrity check'}
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        Reads every brewery table — runs only when you click.
      </p>

      {report ? (
        <div className="flex flex-col gap-2" data-testid="diag-integrity-report">
          <span
            className="inline-flex w-fit items-center gap-1 rounded bg-emerald-500/15 px-2 py-1 text-sm text-emerald-400"
            data-testid="diag-integrity-passed"
          >
            ✓ {report.passed} passed
          </span>

          {failed.length === 0 ? (
            <p className="text-sm text-muted-foreground">No problems found.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {failed.map((c) => (
                <li
                  key={c.id}
                  className="rounded border border-border/70 p-3"
                  data-testid={`diag-check-${c.id}`}
                  data-severity={c.severity}
                >
                  <details>
                    <summary className="cursor-pointer text-sm font-medium">
                      {c.severity === 'warn' ? '🟠' : '🔴'} {c.label} — {c.count}
                    </summary>
                    <p className="mt-2 text-xs text-muted-foreground">{c.message}</p>
                    {c.sampleIds && c.sampleIds.length > 0 ? (
                      <ul className="mt-1 flex flex-col gap-0.5">
                        {c.sampleIds.map((s) => (
                          <li key={s} className="font-mono text-xs">
                            {s}
                          </li>
                        ))}
                      </ul>
                    ) : null}
                    {c.canAutoFix ? (
                      <button
                        type="button"
                        className="btn-ghost mt-2"
                        onClick={() => void fix()}
                        disabled={running}
                      >
                        Fix
                      </button>
                    ) : null}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  )
}
