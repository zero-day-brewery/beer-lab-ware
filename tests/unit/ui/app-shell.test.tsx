// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from '@/components/shell/app-shell'
import { ThemeProvider } from '@/components/shell/theme-provider'

function renderShell(child = <div>page-content</div>) {
  return render(
    <ThemeProvider>
      <AppShell>{child}</AppShell>
    </ThemeProvider>,
  )
}

describe('AppShell', () => {
  it('renders brand title', () => {
    renderShell()
    // Rendered twice — mobile header + sidebar brand link both say "Beer-Lab-Ware".
    expect(screen.getAllByText(/beer-lab-ware/i).length).toBeGreaterThan(0)
  })

  it('renders nav links to Recipes, Equipment, Settings', () => {
    renderShell()
    expect(screen.getByRole('link', { name: /recipes/i })).toHaveAttribute('href', '/')
    expect(screen.getByRole('link', { name: /equipment/i })).toHaveAttribute('href', '/equipment')
    expect(screen.getByRole('link', { name: /settings/i })).toHaveAttribute('href', '/settings')
  })

  it('has a Water nav entry pointing at /water', () => {
    renderShell()
    expect(screen.getByRole('link', { name: /water/i })).toHaveAttribute('href', '/water')
  })

  it('has a Diagnostics nav entry pointing at /diagnostics', () => {
    renderShell()
    expect(screen.getByRole('link', { name: /diagnostics/i })).toHaveAttribute(
      'href',
      '/diagnostics',
    )
  })

  it('renders children in main region', () => {
    renderShell()
    expect(screen.getByText('page-content')).toBeInTheDocument()
  })

  it('renders theme switcher', () => {
    renderShell()
    expect(screen.getByRole('combobox', { name: /theme/i })).toBeInTheDocument()
  })

  it('renders the brand mark SVG in both brand placements', () => {
    const { container } = renderShell()
    expect(container.querySelectorAll('.brand-glyph svg').length).toBe(2)
  })

  it('carries no private-brand strings', () => {
    renderShell()
    expect(screen.getAllByText(/beer-lab-ware/i).length).toBeGreaterThan(0)
  })
})
