'use client'
import {
  Activity,
  BookMarked,
  Bot,
  Boxes,
  Calculator,
  ClipboardList,
  Dna,
  Droplets,
  Menu,
  NotebookText,
  Settings,
  SlidersHorizontal,
  Upload,
  Workflow,
  Wrench,
  X,
} from 'lucide-react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { type ReactNode, useEffect, useState } from 'react'
import { CompanionDrawer } from '@/components/ai/companion-drawer'
import { maxSeverity, severityTint, useInsights } from '@/components/ai/use-insights'
import { BrandMarkSmall } from '@/components/brand/brand-mark'
import { ThemeSwitcher } from './theme-switcher'

const NAV_LINKS = [
  { href: '/', label: 'Recipes', icon: NotebookText, match: ['/', '/recipes'] },
  { href: '/system', label: 'Brew Flow', icon: Workflow, match: ['/system'] },
  { href: '/logbook', label: 'Logbook', icon: BookMarked, match: ['/logbook'] },
  { href: '/inventory', label: 'Inventory', icon: Boxes, match: ['/inventory'] },
  { href: '/yeast', label: 'Yeast Bank', icon: Dna, match: ['/yeast'] },
  { href: '/gear', label: 'Gear', icon: Wrench, match: ['/gear'] },
  { href: '/water', label: 'Water', icon: Droplets, match: ['/water'] },
  { href: '/calculators', label: 'Calculators', icon: Calculator, match: ['/calculators'] },
  { href: '/report', label: 'Report', icon: ClipboardList, match: ['/report'] },
  { href: '/equipment', label: 'Equipment', icon: SlidersHorizontal, match: ['/equipment'] },
  { href: '/import', label: 'Import', icon: Upload, match: ['/import'] },
  { href: '/settings', label: 'Settings', icon: Settings, match: ['/settings'] },
  { href: '/diagnostics', label: 'Diagnostics', icon: Activity, match: ['/diagnostics'] },
] as const

function isActive(pathname: string, match: readonly string[]): boolean {
  return match.some((m) =>
    m === '/' ? pathname === '/' : pathname === m || pathname.startsWith(`${m}/`),
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname() ?? '/'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [companionOpen, setCompanionOpen] = useState(false)

  // v3 Stage B — deterministic, token-free proactive insights. Computed locally
  // (no AI/key) so the badge + heads-up panel show regardless of provider setup.
  const { insights, dismiss } = useInsights()
  const topSeverity = maxSeverity(insights)
  const badgeTint = topSeverity ? severityTint(topSeverity) : null
  const companionLabel =
    insights.length > 0
      ? `Open brewing companion — ${insights.length} heads-up`
      : 'Open brewing companion'

  // Close the mobile drawer whenever the route changes.
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on navigation
  useEffect(() => {
    setDrawerOpen(false)
  }, [pathname])

  return (
    <div className="app-layout">
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {/* Mobile top bar */}
      <header className="mobile-topbar lg:hidden">
        <button
          type="button"
          className="icon-btn"
          aria-label="Open menu"
          aria-expanded={drawerOpen}
          onClick={() => setDrawerOpen(true)}
        >
          <Menu size={20} aria-hidden="true" />
        </button>
        <Link href="/" className="brand-link brand-link--sm">
          <span aria-hidden="true" className="brand-glyph">
            <BrandMarkSmall size={20} />
          </span>
          <span>Beer-Lab-Ware</span>
        </Link>
        <span aria-hidden="true" className="w-10" />
      </header>

      {/* Drawer backdrop (mobile) */}
      {drawerOpen && (
        <button
          type="button"
          className="sidebar-backdrop lg:hidden"
          aria-label="Close menu"
          onClick={() => setDrawerOpen(false)}
        />
      )}

      {/* Sidebar / drawer */}
      <aside className={`sidebar ${drawerOpen ? 'is-open' : ''}`} aria-label="Primary">
        <div className="sidebar-brand">
          <Link href="/" className="brand-link">
            <span aria-hidden="true" className="brand-glyph">
              <BrandMarkSmall size={22} />
            </span>
            <span>Beer-Lab-Ware</span>
          </Link>
          <button
            type="button"
            className="icon-btn lg:hidden"
            aria-label="Close menu"
            onClick={() => setDrawerOpen(false)}
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="sidebar-nav" aria-label="Sections">
          {NAV_LINKS.map((l) => {
            const Icon = l.icon
            const active = isActive(pathname, l.match)
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`side-link ${active ? 'is-active' : ''}`}
                aria-current={active ? 'page' : undefined}
              >
                <Icon size={18} aria-hidden="true" className="side-link-icon" />
                <span>{l.label}</span>
              </Link>
            )
          })}
        </nav>

        <div className="sidebar-foot">
          <ThemeSwitcher />
        </div>
      </aside>

      {/* Main content */}
      <div className="app-main-wrap">
        <main id="main" className="app-main" aria-label="Main content">
          {children}
        </main>
      </div>

      {/* AI brewing companion — trigger present on every page + the slide-over drawer */}
      <button
        type="button"
        className="companion-fab"
        aria-label={companionLabel}
        aria-haspopup="dialog"
        aria-expanded={companionOpen}
        onClick={() => setCompanionOpen(true)}
      >
        <Bot size={20} aria-hidden="true" />
        <span className="companion-fab-label">Ask AI</span>
        {insights.length > 0 && (
          <span className={`companion-fab-badge mini-alert ${badgeTint}`} aria-hidden="true">
            {insights.length}
          </span>
        )}
      </button>
      <CompanionDrawer
        open={companionOpen}
        onClose={() => setCompanionOpen(false)}
        insights={insights}
        onDismiss={dismiss}
      />
    </div>
  )
}
