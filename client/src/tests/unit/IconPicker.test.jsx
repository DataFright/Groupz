import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import IconPicker from '../../components/IconPicker.jsx'
import { ICONS } from '../../constants/icons.js'

describe('Unit tests — IconPicker', () => {
  it('renders exactly 20 icon buttons', () => {
    render(<IconPicker value={ICONS[0]} onChange={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(20)
  })

  it('every button has an aria-label matching its emoji', () => {
    render(<IconPicker value={ICONS[0]} onChange={() => {}} />)
    for (const icon of ICONS) {
      expect(screen.getByLabelText(icon)).toBeInTheDocument()
    }
  })

  it('all buttons are type="button" to prevent accidental form submission', () => {
    const { container } = render(<IconPicker value={ICONS[0]} onChange={() => {}} />)
    for (const btn of container.querySelectorAll('button')) {
      expect(btn.type).toBe('button')
    }
  })

  it('calls onChange with the clicked icon', () => {
    const onChange = vi.fn()
    render(<IconPicker value={ICONS[0]} onChange={onChange} />)
    fireEvent.click(screen.getByLabelText(ICONS[4]))
    expect(onChange).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenCalledWith(ICONS[4])
  })

  it('the selected icon button has the selected CSS class', () => {
    const { container } = render(<IconPicker value={ICONS[3]} onChange={() => {}} />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[3].className).toMatch(/selected/)
  })

  it('only the selected icon has the selected CSS class', () => {
    const { container } = render(<IconPicker value={ICONS[3]} onChange={() => {}} />)
    const buttons = container.querySelectorAll('button')
    buttons.forEach((btn, i) => {
      if (i === 3) expect(btn.className).toMatch(/selected/)
      else expect(btn.className).not.toMatch(/selected/)
    })
  })

  it('changing value prop updates which icon appears selected', () => {
    const { rerender, container } = render(<IconPicker value={ICONS[0]} onChange={() => {}} />)
    rerender(<IconPicker value={ICONS[7]} onChange={() => {}} />)
    const buttons = container.querySelectorAll('button')
    expect(buttons[7].className).toMatch(/selected/)
    expect(buttons[0].className).not.toMatch(/selected/)
  })

  it('ICONS array contains exactly 20 entries', () => {
    expect(ICONS).toHaveLength(20)
  })

  it('all ICONS are unique', () => {
    expect(new Set(ICONS).size).toBe(ICONS.length)
  })
})
