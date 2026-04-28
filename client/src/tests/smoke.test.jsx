import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from '../App.jsx'

vi.mock('../socket.js', () => ({
  socket: { connect: vi.fn(), disconnect: vi.fn(), emit: vi.fn(), on: vi.fn(), off: vi.fn(), once: vi.fn() }
}))

vi.mock('../components/GroupMap.jsx', () => ({
  default: () => <div data-testid="group-map" />
}))

describe('Smoke tests — client', () => {
  beforeEach(() => vi.clearAllMocks())

  it('App renders without crashing', () => {
    render(<App />)
    expect(document.body).toBeTruthy()
  })

  it('shows the Home screen by default', () => {
    render(<App />)
    expect(screen.getByText('Groupz')).toBeInTheDocument()
  })

  it('does not show the map on initial load', () => {
    render(<App />)
    expect(screen.queryByTestId('group-map')).not.toBeInTheDocument()
  })

  it('shows Create Group and Join Group tab buttons', () => {
    render(<App />)
    const tabButtons = screen.getAllByRole('button').filter(b => b.type === 'button')
    const labels = tabButtons.map(b => b.textContent)
    expect(labels).toContain('Create Group')
    expect(labels).toContain('Join Group')
  })

  it('shows the name input field', () => {
    render(<App />)
    expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument()
  })

  it('shows a submit button', () => {
    render(<App />)
    expect(document.querySelector('button[type="submit"]')).toBeTruthy()
  })

  it('shows 20 icon options', () => {
    render(<App />)
    const iconButtons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label'))
    expect(iconButtons).toHaveLength(20)
  })
})
