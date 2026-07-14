'use client'
import { CopyDiagnosticsButton } from '@/components/shell/copy-diagnostics-button'
import { type DbFailure, resetDb, salvageDump } from '@/lib/db/open'

function reload() {
  if (typeof location !== 'undefined') location.reload()
}

async function exportSalvage() {
  const blob = await salvageDump()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `beer-lab-ware-salvage-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}

const TITLES: Record<DbFailure['status'], string> = {
  blocked: 'Database is busy in another tab',
  'version-newer': 'This browser has newer data than the app',
  corrupt: 'The database could not be opened',
  quota: 'Storage is full',
  unknown: 'The database could not be opened',
}

export function DbRecoveryPanel({ result }: { result: DbFailure }) {
  const onReset = async () => {
    if (!confirm('Reset the database? This DELETES all local brewery data on this device.')) return
    if (
      !confirm(
        'Are you absolutely sure? A rescue copy will be exported first. You will need to reconnect your backup folder afterward.',
      )
    )
      return
    await exportSalvage() // export-first
    await resetDb()
    reload()
  }

  return (
    <section className="tap-card m-6 flex max-w-lg flex-col gap-4 p-6" role="alert">
      <h1 className="text-xl font-semibold">{TITLES[result.status]}</h1>

      {result.status === 'version-newer' && (
        <>
          <p className="text-sm opacity-80">
            Close other tabs, or reload after updating the app. Do not reset — that would overwrite
            your newer data.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={exportSalvage} className="btn-ghost">
              Export a rescue copy
            </button>
            <button type="button" onClick={reload} className="btn-primary">
              Reload
            </button>
          </div>
        </>
      )}

      {result.status === 'corrupt' && (
        <>
          <p className="text-sm opacity-80">
            We could not open your local database. Export whatever we can salvage, then reset to
            recover a working app.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={exportSalvage} className="btn-ghost">
              Export what we can
            </button>
            <button type="button" onClick={onReset} className="btn-ghost danger">
              Reset database
            </button>
            <CopyDiagnosticsButton />
          </div>
        </>
      )}

      {result.status === 'quota' && (
        <>
          <p className="text-sm opacity-80">
            The browser is out of storage. Export a backup to free space, then reload.
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={exportSalvage} className="btn-ghost">
              Export backup
            </button>
            <button type="button" onClick={reload} className="btn-primary">
              Reload
            </button>
          </div>
        </>
      )}

      {(result.status === 'blocked' || result.status === 'unknown') && (
        <>
          <p className="text-sm opacity-80">
            {result.status === 'blocked'
              ? 'Another tab is upgrading the database. Close it, then reload.'
              : 'Something unexpected happened opening the database. Reload to try again.'}
          </p>
          <button type="button" onClick={reload} className="btn-primary self-start">
            Reload
          </button>
        </>
      )}
    </section>
  )
}
