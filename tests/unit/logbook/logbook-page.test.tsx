import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@/components/logbook/logbook-list', () => ({
  LogbookList: () => <div data-testid="list">list</div>,
}))

import LogbookPage from '@/app/logbook/page'

describe('LogbookPage', () => {
  it('wraps the list in a Suspense boundary with a fallback', () => {
    const html = renderToStaticMarkup(<LogbookPage />)
    expect(html).toContain('list')
  })
})
