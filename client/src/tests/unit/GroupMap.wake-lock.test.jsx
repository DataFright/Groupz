import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, act, waitFor } from '@testing-library/react'
import React from 'react'

// Mock Leaflet and react-leaflet to avoid canvas/DOM map dependency
vi.mock('leaflet', () => ({
  default: {
    divIcon: vi.fn(() => ({})),
    Icon: {
      Default: {
        prototype: { _getIconUrl: vi.fn() },
        mergeOptions: vi.fn(),
      },
    },
  },
}))

vi.mock('react-leaflet', () => ({
  MapContainer: ({ children }) => React.createElement('div', { 'data-testid': 'map' }, children),
  TileLayer: () => null,
  Marker: ({ children }) => React.createElement('div', null, children ?? null),
  Tooltip: ({ children }) => React.createElement('div', null, children ?? null),
  useMap: () => ({ flyTo: vi.fn() }),
}))

vi.mock('../../socket.js', () => ({
  socket: { emit: vi.fn(), on: vi.fn(), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
}))

vi.mock('../../components/MemberList.jsx', () => ({ default: () => null }))
vi.mock('../../components/GroupCodeOverlay.jsx', () => ({ default: () => null }))

import GroupMap from '../../components/GroupMap.jsx'

const defaultProps = {
  groupInfo: { code: 'ABCDEF', mySocketId: 'sock1', isHost: false, hostSocketId: 'sock2' },
  members: [],
  onLeave: vi.fn(),
  isReconnecting: false,
}

// ─── Wake Lock ───────────────────────────────────────────────────────────────

describe('GroupMap — wake lock', () => {
  let mockRelease
  let mockRequest

  beforeEach(() => {
    mockRelease = vi.fn().mockResolvedValue(undefined)
    mockRequest = vi.fn().mockResolvedValue({ release: mockRelease })
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: mockRequest },
      writable: true,
      configurable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    vi.clearAllMocks()
  })

  it('requests a screen wake lock on mount', async () => {
    await act(async () => {
      render(<GroupMap {...defaultProps} />)
    })
    expect(mockRequest).toHaveBeenCalledWith('screen')
  })

  it('re-requests the wake lock when the page becomes visible again', async () => {
    await act(async () => {
      render(<GroupMap {...defaultProps} />)
    })
    expect(mockRequest).toHaveBeenCalledTimes(1)

    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'))
    })
    expect(mockRequest).toHaveBeenCalledTimes(2)
  })

  it('releases the wake lock on unmount', async () => {
    let unmount
    await act(async () => {
      ;({ unmount } = render(<GroupMap {...defaultProps} />))
    })
    // Verify the lock was acquired before we unmount
    await waitFor(() => expect(mockRequest).toHaveBeenCalledTimes(1))
    unmount()
    expect(mockRelease).toHaveBeenCalled()
  })

  it('is a no-op when navigator.wakeLock is unavailable', async () => {
    Object.defineProperty(navigator, 'wakeLock', {
      value: undefined,
      writable: true,
      configurable: true,
    })
    await expect(
      act(async () => { render(<GroupMap {...defaultProps} />) })
    ).resolves.not.toThrow()
  })

  it('handles a rejected wake lock request without throwing', async () => {
    mockRequest.mockRejectedValue(new DOMException('Not allowed', 'NotAllowedError'))
    await expect(
      act(async () => { render(<GroupMap {...defaultProps} />) })
    ).resolves.not.toThrow()
  })
})
