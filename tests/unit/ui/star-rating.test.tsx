// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { StarRating, StarRatingDisplay } from '@/components/ui/star-rating'

describe('StarRatingDisplay (read-only)', () => {
  it('renders N filled of 5 and an accessible label, with no interactive controls', () => {
    render(<StarRatingDisplay value={3} />)
    expect(screen.getByRole('img', { name: '3 of 5 stars' })).toBeInTheDocument()

    const glyphs = document.querySelectorAll('.star-rating-star')
    expect(glyphs).toHaveLength(5)
    expect(document.querySelectorAll('.star-rating-star.is-filled')).toHaveLength(3)

    // Non-interactive: no buttons / radios.
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('clamps and rounds out-of-range values', () => {
    render(<StarRatingDisplay value={9} />)
    expect(screen.getByRole('img', { name: '5 of 5 stars' })).toBeInTheDocument()
    expect(document.querySelectorAll('.star-rating-star.is-filled')).toHaveLength(5)
  })
})

describe('StarRating (interactive)', () => {
  it('exposes a radiogroup of five star radios with the value checked', () => {
    render(<StarRating value={2} onChange={() => {}} />)
    expect(screen.getByRole('radiogroup', { name: /rating/i })).toBeInTheDocument()
    const radios = screen.getAllByRole('radio')
    expect(radios).toHaveLength(5)
    expect(radios[1]).toHaveAttribute('aria-checked', 'true')
    expect(document.querySelectorAll('.star-rating-star.is-filled')).toHaveLength(2)
  })

  it('clicking a star reports that value via onChange', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StarRating value={0} onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: '4 stars' }))
    expect(onChange).toHaveBeenCalledWith(4)
  })

  it('clicking the active star toggles it back to 0 (clearable)', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StarRating value={3} onChange={onChange} />)

    await user.click(screen.getByRole('radio', { name: '3 stars' }))
    expect(onChange).toHaveBeenCalledWith(0)
  })

  it('keyboard: ArrowRight increments and ArrowLeft decrements from the current value', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StarRating value={2} onChange={onChange} />)

    // Focus a star radio; the keydown handler lives on the radiogroup and catches bubbled events.
    screen.getByRole('radio', { name: '2 stars' }).focus()
    await user.keyboard('{ArrowRight}')
    expect(onChange).toHaveBeenLastCalledWith(3)

    await user.keyboard('{ArrowLeft}')
    expect(onChange).toHaveBeenLastCalledWith(1)
  })

  it('keyboard: Home clears to 0 and End maxes to 5', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<StarRating value={2} onChange={onChange} />)

    screen.getByRole('radio', { name: '2 stars' }).focus()
    await user.keyboard('{Home}')
    expect(onChange).toHaveBeenLastCalledWith(0)
    await user.keyboard('{End}')
    expect(onChange).toHaveBeenLastCalledWith(5)
  })

  it('shows a Clear affordance only when a rating is set', () => {
    const { rerender } = render(<StarRating value={0} onChange={() => {}} />)
    expect(screen.queryByRole('button', { name: /clear rating/i })).not.toBeInTheDocument()
    rerender(<StarRating value={4} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: /clear rating/i })).toBeInTheDocument()
  })
})
