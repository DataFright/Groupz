import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import GroupCodeOverlay from '../../components/GroupCodeOverlay.jsx'

function mockClipboard(resolves = true) {
  const fn = resolves
    ? vi.fn().mockResolvedValue(undefined)
    : vi.fn().mockRejectedValue(new Error('Permission denied'))
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: fn },
    writable: true,
    configurable: true,
  })
  return fn
}

function setShare(impl) {
  Object.defineProperty(navigator, 'share', {
    value: impl,
    writable: true,
    configurable: true,
  })
}

describe('GroupCodeOverlay', () => {
  beforeEach(() => {
    mockClipboard()
    setShare(undefined) // default: use clipboard fallback
  })

  afterEach(() => vi.clearAllMocks())

  // ─── Rendering ─────────────────────────────────────────────────────────────

  describe('rendering', () => {
    it('renders the group code value', () => {
      render(<GroupCodeOverlay code="ABC123" />)
      expect(screen.getByText('ABC123')).toBeInTheDocument()
    })

    it('renders the copy button', () => {
      render(<GroupCodeOverlay code="ABC123" />)
      expect(screen.getByRole('button', { name: /copy group code/i })).toBeInTheDocument()
    })

    it('renders the share button', () => {
      render(<GroupCodeOverlay code="ABC123" />)
      expect(screen.getByRole('button', { name: /share join link/i })).toBeInTheDocument()
    })

    it('copy button shows ⎘ by default', () => {
      render(<GroupCodeOverlay code="ABC123" />)
      expect(screen.getByRole('button', { name: /copy group code/i })).toHaveTextContent('⎘')
    })

    it('share button shows ↗ by default', () => {
      render(<GroupCodeOverlay code="ABC123" />)
      expect(screen.getByRole('button', { name: /share join link/i })).toHaveTextContent('↗')
    })
  })

  // ─── Copy button ───────────────────────────────────────────────────────────

  describe('copy button', () => {
    it('writes the raw code to the clipboard', async () => {
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /copy group code/i }))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('ABC123')
    })

    it('shows ✓ feedback after a successful copy', async () => {
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /copy group code/i }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /copy group code/i })).toHaveTextContent('✓')
      )
    })

    it('does not crash when clipboard write fails', async () => {
      mockClipboard(false)
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /copy group code/i }))
      // Component stays rendered — no crash
      expect(screen.getByRole('button', { name: /copy group code/i })).toBeInTheDocument()
    })
  })

  // Timer revert (copy button shows ✓ → reverts to ⎘ after 2s) is covered by the
  // Cypress suite (group-code-copy.cy.js) which already has a cy.wait(2100) check.

  // ─── Share button — native Web Share API ───────────────────────────────────

  describe('share button — native share', () => {
    it('calls navigator.share with the join URL when available', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined)
      setShare(mockShare)
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      expect(mockShare).toHaveBeenCalledWith(expect.objectContaining({
        url: expect.stringContaining('/?join=ABC123'),
      }))
    })

    it('share URL contains the page origin', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined)
      setShare(mockShare)
      render(<GroupCodeOverlay code="XY9F2A" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      const { url } = mockShare.mock.calls[0][0]
      expect(url).toMatch(/^https?:\/\/[^/]+\/\?join=XY9F2A$/)
    })

    it('does NOT write to clipboard when navigator.share is available', async () => {
      const mockShare = vi.fn().mockResolvedValue(undefined)
      setShare(mockShare)
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      expect(navigator.clipboard.writeText).not.toHaveBeenCalled()
    })

    it('handles navigator.share rejection (user cancel) without crashing', async () => {
      setShare(vi.fn().mockRejectedValue(new DOMException('Share cancelled', 'AbortError')))
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      expect(screen.getByRole('button', { name: /share join link/i })).toBeInTheDocument()
    })

    it('handles navigator.share TypeError without crashing', async () => {
      setShare(vi.fn().mockRejectedValue(new TypeError('Invalid share data')))
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      expect(screen.getByRole('button', { name: /share join link/i })).toBeInTheDocument()
    })
  })

  // ─── Share button — clipboard fallback ────────────────────────────────────

  describe('share button — clipboard fallback', () => {
    it('writes the join URL to clipboard when navigator.share is unavailable', async () => {
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
        expect.stringContaining('/?join=ABC123')
      )
    })

    it('written URL matches origin + join param exactly', async () => {
      render(<GroupCodeOverlay code="XY9F2A" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      const [calledUrl] = navigator.clipboard.writeText.mock.calls[0]
      expect(calledUrl).toMatch(/^https?:\/\/[^/]+\/\?join=XY9F2A$/)
    })

    it('shows ✓ feedback after clipboard copy', async () => {
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      await waitFor(() =>
        expect(screen.getByRole('button', { name: /share join link/i })).toHaveTextContent('✓')
      )
    })

    it('does not crash when clipboard write fails', async () => {
      mockClipboard(false)
      render(<GroupCodeOverlay code="ABC123" />)
      await userEvent.click(screen.getByRole('button', { name: /share join link/i }))
      expect(screen.getByRole('button', { name: /share join link/i })).toBeInTheDocument()
    })
  })

  // Timer revert (share button shows ✓ → reverts to ↗ after 2s) is covered by the
  // Cypress suite (share-link.cy.js) which has a cy.wait(2100) check.
})
