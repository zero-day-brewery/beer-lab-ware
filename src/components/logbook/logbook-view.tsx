'use client'
import { useState } from 'react'
import { BatchDashboard } from '@/components/logbook/batch-dashboard'
import { LogbookList } from '@/components/logbook/logbook-list'
import { TrendsView } from '@/components/logbook/trends-view'

/**
 * Thin client wrapper that adds an in-page tab bar over the Logbook — List /
 * Dashboard / Trends — reusing the `.batchlist-filters` pill styling. This also
 * rescues the previously-orphaned Trends view (its `/logbook/trends` route was
 * never linked). No app-shell or route changes: still one `/logbook` nav entry.
 */

type Tab = 'list' | 'dashboard' | 'trends'

const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: 'List' },
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'trends', label: 'Trends' },
]

export function LogbookView() {
  const [tab, setTab] = useState<Tab>('list')

  return (
    <div className="batchlist">
      <div className="batchlist-filters">
        {TABS.map((t) => (
          <button
            type="button"
            key={t.id}
            aria-pressed={tab === t.id}
            className={`batchlist-filter${tab === t.id ? ' is-active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'list' && <LogbookList />}
      {tab === 'dashboard' && <BatchDashboard />}
      {tab === 'trends' && <TrendsView />}
    </div>
  )
}
