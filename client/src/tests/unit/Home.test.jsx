import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import Home from '../../components/Home.jsx'

// vi.mock is hoisted — factory must NOT reference module-level vars.
// Import the mocked socket below and wire up implementations in beforeEach.
vi.mock('../../socket.js', () => ({
  socket: {
    connect:    vi.fn(),
    disconnect: vi.fn(),
    emit:       vi.fn(),
    on:         vi.fn(),
    off:        vi.fn(),
    once:       vi.fn(),
  }
}))

import { socket } from '../../socket.js'

// Helper: find the form's submit button (distinct from the type="button" tab buttons)
function submitBtn() {
  return document.querySelector('button[type="submit"]')
}

describe('Home', () => {
  beforeEach(() => vi.clearAllMocks())

  // ─── Rendering ─────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders the Groupz title', () => {
      render(<Home onJoin={vi.fn()} />)
      expect(screen.getByText('Groupz')).toBeInTheDocument()
    })

    it('shows Create Group and Join Group tab buttons', () => {
      render(<Home onJoin={vi.fn()} />)
      const tabs = screen.getAllByRole('button').filter(b => b.type === 'button')
      expect(tabs.map(b => b.textContent)).toEqual(expect.arrayContaining(['Create Group', 'Join Group']))
    })

    it('does not show the code input on the Create tab', () => {
      render(<Home onJoin={vi.fn()} />)
      expect(screen.queryByPlaceholderText('Enter 6-character code')).not.toBeInTheDocument()
    })

    it('shows the name input', () => {
      render(<Home onJoin={vi.fn()} />)
      expect(screen.getByPlaceholderText('Enter your name')).toBeInTheDocument()
    })

    it('shows 20 icon picker buttons', () => {
      render(<Home onJoin={vi.fn()} />)
      const iconButtons = screen.getAllByRole('button').filter(b => b.getAttribute('aria-label'))
      expect(iconButtons).toHaveLength(20)
    })
  })

  // ─── Tab switching ─────────────────────────────────────────────────────────

  describe('tab switching', () => {
    it('switching to Join tab reveals the code input', async () => {
      render(<Home onJoin={vi.fn()} />)
      const joinTab = screen.getAllByRole('button').find(b => b.type === 'button' && b.textContent === 'Join Group')
      await userEvent.click(joinTab)
      expect(screen.getByPlaceholderText('Enter 6-character code')).toBeInTheDocument()
    })

    it('switching back to Create tab hides the code input', async () => {
      render(<Home onJoin={vi.fn()} />)
      const tabs = screen.getAllByRole('button').filter(b => b.type === 'button')
      const createTab = tabs.find(b => b.textContent === 'Create Group')
      const joinTab   = tabs.find(b => b.textContent === 'Join Group')
      await userEvent.click(joinTab)
      await userEvent.click(createTab)
      expect(screen.queryByPlaceholderText('Enter 6-character code')).not.toBeInTheDocument()
    })

    it('switching tabs clears any existing error message', async () => {
      render(<Home onJoin={vi.fn()} />)
      await userEvent.click(submitBtn())
      await waitFor(() => expect(screen.getByText('Enter your name')).toBeInTheDocument())
      const joinTab = screen.getAllByRole('button').find(b => b.type === 'button' && b.textContent === 'Join Group')
      await userEvent.click(joinTab)
      expect(screen.queryByText('Enter your name')).not.toBeInTheDocument()
    })
  })

  // ─── Validation ────────────────────────────────────────────────────────────

  describe('validation', () => {
    it('shows error when submitting with an empty name', async () => {
      render(<Home onJoin={vi.fn()} />)
      await userEvent.click(submitBtn())
      await waitFor(() => expect(screen.getByText('Enter your name')).toBeInTheDocument())
      expect(socket.connect).not.toHaveBeenCalled()
    })

    it('shows error when name exceeds 16 characters', async () => {
      render(<Home onJoin={vi.fn()} />)
      // Use fireEvent to bypass the input's maxLength=16 DOM constraint
      fireEvent.change(screen.getByPlaceholderText('Enter your name'), {
        target: { value: 'A'.repeat(17) }
      })
      await userEvent.click(submitBtn())
      await waitFor(() => expect(screen.getByText(/16 characters/i)).toBeInTheDocument())
      expect(socket.connect).not.toHaveBeenCalled()
    })

    it('shows error when joining without a code', async () => {
      render(<Home onJoin={vi.fn()} />)
      const joinTab = screen.getAllByRole('button').find(b => b.type === 'button' && b.textContent === 'Join Group')
      await userEvent.click(joinTab)
      await userEvent.type(screen.getByPlaceholderText('Enter your name'), 'Alice')
      await userEvent.click(submitBtn())
      await waitFor(() => expect(screen.getByText('Enter the group code')).toBeInTheDocument())
      expect(socket.connect).not.toHaveBeenCalled()
    })
  })

  // ─── Socket interaction ────────────────────────────────────────────────────

  describe('socket interaction', () => {
    it('connects socket and emits create-group on valid Create submit', async () => {
      render(<Home onJoin={vi.fn()} />)
      await userEvent.type(screen.getByPlaceholderText('Enter your name'), 'Alice')
      await userEvent.click(submitBtn())
      expect(socket.connect).toHaveBeenCalledOnce()
      expect(socket.emit).toHaveBeenCalledWith('create-group', {
        name: 'Alice',
        icon: expect.any(String),
      })
    })

    it('connects socket and emits join-group on valid Join submit', async () => {
      render(<Home onJoin={vi.fn()} />)
      const joinTab = screen.getAllByRole('button').find(b => b.type === 'button' && b.textContent === 'Join Group')
      await userEvent.click(joinTab)
      await userEvent.type(screen.getByPlaceholderText('Enter 6-character code'), 'abc123')
      await userEvent.type(screen.getByPlaceholderText('Enter your name'), 'Bob')
      await userEvent.click(submitBtn())
      expect(socket.connect).toHaveBeenCalledOnce()
      expect(socket.emit).toHaveBeenCalledWith('join-group', {
        code: 'ABC123',
        name: 'Bob',
        icon: expect.any(String),
      })
    })

    it('auto-uppercases the group code as the user types', async () => {
      render(<Home onJoin={vi.fn()} />)
      const joinTab = screen.getAllByRole('button').find(b => b.type === 'button' && b.textContent === 'Join Group')
      await userEvent.click(joinTab)
      const codeInput = screen.getByPlaceholderText('Enter 6-character code')
      await userEvent.type(codeInput, 'abc123')
      expect(codeInput.value).toBe('ABC123')
    })

    it('submit button is disabled while loading', async () => {
      render(<Home onJoin={vi.fn()} />)
      await userEvent.type(screen.getByPlaceholderText('Enter your name'), 'Alice')
      await userEvent.click(submitBtn())
      expect(submitBtn()).toBeDisabled()
    })
  })

  // ─── Server error responses ────────────────────────────────────────────────

  describe('server error responses', () => {
    function getJoinErrorHandler() {
      const call = socket.on.mock.calls.find(([event]) => event === 'join-error')
      return call?.[1]
    }

    it('displays GROUP_FULL error message when the server rejects the join', async () => {
      render(<Home onJoin={vi.fn()} />)
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ code: 'GROUP_FULL', message: 'This group is full (max 20 members)', status: 400 })
      })
      await waitFor(() =>
        expect(screen.getByText('This group is full (max 20 members)')).toBeInTheDocument()
      )
    })

    it('displays RATE_LIMITED error message when the server rejects the join', async () => {
      render(<Home onJoin={vi.fn()} />)
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ code: 'RATE_LIMITED', message: 'Too many join attempts. Try again later.', status: 429 })
      })
      await waitFor(() =>
        expect(screen.getByText('Too many join attempts. Try again later.')).toBeInTheDocument()
      )
    })

    it('disconnects the socket on GROUP_FULL or RATE_LIMITED error', async () => {
      render(<Home onJoin={vi.fn()} />)
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ code: 'GROUP_FULL', message: 'This group is full (max 20 members)', status: 400 })
      })
      expect(socket.disconnect).toHaveBeenCalled()
    })

    it('displays GROUP_NOT_FOUND error message', async () => {
      render(<Home onJoin={vi.fn()} />)
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ code: 'GROUP_NOT_FOUND', message: 'Group not found', status: 404 })
      })
      await waitFor(() =>
        expect(screen.getByText('Group not found')).toBeInTheDocument()
      )
    })

    it('displays SERVER_ERROR message when the server has an internal failure', async () => {
      render(<Home onJoin={vi.fn()} />)
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ code: 'SERVER_ERROR', message: 'Could not generate group code', status: 500 })
      })
      await waitFor(() =>
        expect(screen.getByText('Could not generate group code')).toBeInTheDocument()
      )
    })

    it('does not crash when the server sends an error object without a code field', async () => {
      render(<Home onJoin={vi.fn()} />)
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ message: 'Unexpected server error' })
      })
      // App should still be rendered — no thrown exception
      expect(screen.getByText('Groupz')).toBeInTheDocument()
    })

    it('re-enables the submit button after a server error so the user can retry', async () => {
      render(<Home onJoin={vi.fn()} />)
      const user = userEvent.setup()
      await user.type(screen.getByPlaceholderText('Enter your name'), 'Alice')
      await user.click(submitBtn())
      // Button disabled while waiting
      expect(submitBtn()).toBeDisabled()
      const handler = getJoinErrorHandler()
      await act(async () => {
        handler({ code: 'GROUP_NOT_FOUND', message: 'Group not found', status: 404 })
      })
      await waitFor(() => expect(submitBtn()).not.toBeDisabled())
    })
  })
})
