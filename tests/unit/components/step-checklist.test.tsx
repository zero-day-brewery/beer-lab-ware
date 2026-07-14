// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { checklistComplete, StepChecklist } from '@/components/system/run/step-checklist'

const step = {
  id: 'cold-side-sanitation',
  title: 'Full cold-side sanitation pass',
  body_md: 'Sanitize everything wort touches.',
  values: [],
  logs: [
    { key: 'cfc', label: 'CFC Pro flushed', kind: 'bool', required: true },
    { key: 'fermenter', label: 'Fermenter + gaskets', kind: 'bool', required: true },
    { key: 'notes', label: 'Optional note done', kind: 'bool' },
  ],
  timers: [],
} as unknown as Parameters<typeof StepChecklist>[0]['step']

describe('checklistComplete', () => {
  it('false until every required bool is true; ignores optional', () => {
    expect(checklistComplete(step, {})).toBe(false)
    expect(checklistComplete(step, { cfc: true })).toBe(false)
    expect(checklistComplete(step, { cfc: true, fermenter: true })).toBe(true)
  })
})

describe('StepChecklist', () => {
  it('fires onLog when a box is ticked', async () => {
    const onLog = vi.fn()
    render(<StepChecklist step={step} ctx={{}} checked={{}} onLog={onLog} />)
    await userEvent.click(screen.getByLabelText(/CFC Pro flushed/))
    expect(onLog).toHaveBeenCalledWith('cfc', true)
  })
})
