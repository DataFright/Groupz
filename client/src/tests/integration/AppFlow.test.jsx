import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act, waitFor } from '@testing-library/react'
import App from '../../App.jsx'

/**
 * Integration tests for App's view-routing and socket-driven navigation.
 * Socket is mocked; GroupMap is stubbed to avoid leaflet DOM dependency.
 * We capture socket.on handlers so we can simulate server-pushed events.
 */

// vi.mock is hoisted — factories must NOT reference module-level vars.
// Import the mock separately so we can wire up implementations in beforeEach.
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

vi.mock('../../components/GroupMap.jsx', () => ({
  default: ({ groupInfo, members, isReconnecting }) =>
    React.createElement('div', {
      'data-testid':        'group-map',
      'data-code':          groupInfo?.code,
      'data-host':          String(groupInfo?.isHost),
      'data-reconnecting':  String(isReconnecting),
      'data-member-count':  String(members?.length ?? 0),
    })
}))

import React from 'react'
import { socket } from '../../socket.js'

let handlers = {}

function trigger(event, payload = {}) {
  act(() => handlers[event]?.forEach(h => h(payload)))
}

describe('Integration tests — App view routing', () => {
  beforeEach(() => {
    handlers = {}
    vi.clearAllMocks()
    socket.on.mockImplementation((event, fn) => {
      handlers[event] = [...(handlers[event] ?? []), fn]
    })
    socket.off.mockImplementation((event, fn) => {
      handlers[event] = (handlers[event] ?? []).filter(h => h !== fn)
    })
  })

  it('starts on the Home view', () => {
    render(<App />)
    expect(screen.getByText('Groupz')).toBeInTheDocument()
    expect(screen.queryByTestId('group-map')).not.toBeInTheDocument()
  })

  it('registers all navigation socket listeners on mount', () => {
    render(<App />)
    expect(socket.on).toHaveBeenCalledWith('removed-from-group', expect.any(Function))
    expect(socket.on).toHaveBeenCalledWith('group-ended',         expect.any(Function))
    expect(socket.on).toHaveBeenCalledWith('left-group',          expect.any(Function))
    expect(socket.on).toHaveBeenCalledWith('host-changed',        expect.any(Function))
  })

  it('deregisters listeners on unmount', () => {
    const { unmount } = render(<App />)
    unmount()
    expect(socket.off).toHaveBeenCalledWith('removed-from-group', expect.any(Function))
    expect(socket.off).toHaveBeenCalledWith('group-ended',         expect.any(Function))
  })

  it('shows a notification banner on removed-from-group', async () => {
    render(<App />)
    trigger('removed-from-group')
    await waitFor(() =>
      expect(screen.getByText(/removed from the group/i)).toBeInTheDocument()
    )
  })

  it('shows a notification banner on group-ended', async () => {
    render(<App />)
    trigger('group-ended')
    await waitFor(() =>
      expect(screen.getByText(/ended by the host/i)).toBeInTheDocument()
    )
  })

  it('calls socket.disconnect on removed-from-group', () => {
    render(<App />)
    trigger('removed-from-group')
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('calls socket.disconnect on group-ended', () => {
    render(<App />)
    trigger('group-ended')
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('navigates to map view when Home calls onJoin via group-created', async () => {
    render(<App />)

    // Home's useEffect registers a 'group-created' handler on socket.on.
    // Simulate the server sending that event.
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })

    await waitFor(() =>
      expect(screen.getByTestId('group-map')).toBeInTheDocument()
    )
    expect(screen.getByTestId('group-map').dataset.code).toBe('ABCDEF')
  })

  it('host-changed to a different socket marks current user as non-host', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('host-changed', { newHostSocketId: 'other-socket' })
    await waitFor(() =>
      expect(screen.getByTestId('group-map').dataset.host).toBe('false')
    )
  })

  it('registers left-group socket listener on mount', () => {
    render(<App />)
    expect(socket.on).toHaveBeenCalledWith('left-group', expect.any(Function))
  })

  it('calls socket.disconnect on left-group', () => {
    render(<App />)
    trigger('left-group')
    expect(socket.disconnect).toHaveBeenCalled()
  })

  it('group-ended returns the user to the Home view', async () => {
    render(<App />)
    // Enter map view first
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('group-ended')
    await waitFor(() =>
      expect(screen.queryByTestId('group-map')).not.toBeInTheDocument()
    )
    expect(screen.getByText('Groupz')).toBeInTheDocument()
  })

  it('removed-from-group returns the user to the Home view', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('removed-from-group')
    await waitFor(() =>
      expect(screen.queryByTestId('group-map')).not.toBeInTheDocument()
    )
    expect(screen.getByText('Groupz')).toBeInTheDocument()
  })

  it('unexpected disconnect while on map stays on map with isReconnecting=true', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('disconnect', 'transport close')

    await waitFor(() => {
      const map = screen.getByTestId('group-map')
      expect(map).toBeInTheDocument()
      expect(map.dataset.reconnecting).toBe('true')
    })
  })

  it('connect after disconnect emits join-group; join-confirmed clears reconnecting', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('disconnect', 'transport close')
    await waitFor(() => expect(screen.getByTestId('group-map').dataset.reconnecting).toBe('true'))

    trigger('connect')
    expect(socket.emit).toHaveBeenCalledWith('join-group', expect.objectContaining({ code: 'ABCDEF' }))

    trigger('join-confirmed', { socketId: 'test-socket-2', hostSocketId: 'test-socket-2' })
    await waitFor(() => expect(screen.getByTestId('group-map').dataset.reconnecting).toBe('false'))
  })

  it('reconnect_failed sends user home with a notification', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('disconnect', 'transport close')
    trigger('reconnect_failed')

    await waitFor(() => expect(screen.queryByTestId('group-map')).not.toBeInTheDocument())
    expect(screen.getByText(/could not reconnect/i)).toBeInTheDocument()
  })

  it('join-error GROUP_NOT_FOUND during rejoin shows group-ended message and goes home', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('disconnect', 'transport close')
    await waitFor(() => expect(screen.getByTestId('group-map').dataset.reconnecting).toBe('true'))

    trigger('connect')
    trigger('join-error', { code: 'GROUP_NOT_FOUND' })

    await waitFor(() => expect(screen.queryByTestId('group-map')).not.toBeInTheDocument())
    expect(screen.getByText(/group ended while you were away/i)).toBeInTheDocument()
  })

  it('join-confirmed while not in a reconnect flow is ignored — map unchanged', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    // No disconnect — isRejoiningRef is false
    trigger('join-confirmed', { socketId: 'other-socket', hostSocketId: 'other-socket' })

    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('group-map')).toBeInTheDocument()
    expect(screen.getByTestId('group-map').dataset.reconnecting).toBe('false')
  })

  it('join-error while not in a reconnect flow is ignored — map unchanged', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    // No disconnect — isRejoiningRef is false
    trigger('join-error', { code: 'GROUP_NOT_FOUND' })

    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('group-map')).toBeInTheDocument()
    expect(screen.queryByText(/group ended/i)).not.toBeInTheDocument()
  })

  it('intentional disconnect reason does not trigger reconnecting state', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('disconnect', 'io client disconnect')

    await new Promise(r => setTimeout(r, 50))
    expect(screen.getByTestId('group-map')).toBeInTheDocument()
    expect(screen.getByTestId('group-map').dataset.reconnecting).toBe('false')
  })

  it('visibilitychange while disconnected with pending rejoin triggers socket.connect', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('disconnect', 'transport close')
    await waitFor(() => expect(screen.getByTestId('group-map').dataset.reconnecting).toBe('true'))

    // socket.connected is undefined (falsy) on the mock; visibilityState defaults to 'visible' in jsdom
    act(() => document.dispatchEvent(new Event('visibilitychange')))

    expect(socket.connect).toHaveBeenCalled()
  })

  it('members-update event updates the member count passed to GroupMap', async () => {
    render(<App />)
    act(() => {
      handlers['group-created']?.forEach(h =>
        h({ code: 'ABCDEF', socketId: 'test-socket-1', status: 201 })
      )
    })
    await waitFor(() => expect(screen.getByTestId('group-map')).toBeInTheDocument())

    trigger('members-update', [
      { socketId: 'test-socket-1', name: 'Alice', icon: '🦊', lat: null, lng: null, active: true },
      { socketId: 'test-socket-2', name: 'Bob',   icon: '🐻', lat: null, lng: null, active: true },
    ])

    await waitFor(() =>
      expect(screen.getByTestId('group-map').dataset.memberCount).toBe('2')
    )
  })
})
