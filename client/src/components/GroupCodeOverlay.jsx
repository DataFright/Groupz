import { useState } from 'react'
import styles from '../styles/GroupMap.module.css'

// Displays the group code with copy and share buttons.
// Copy: writes the raw code. Share: writes (or natively shares) a join link.
// Both show a ✓ tick for 2 seconds after a successful clipboard write.
export default function GroupCodeOverlay({ code }) {
  const [copied, setCopied] = useState(false)
  const [shared, setShared] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      })
      .catch(() => {})
  }

  function handleShare() {
    const url = `${window.location.origin}/?join=${code}`
    // Use the native share sheet on mobile if available
    if (navigator.share) {
      navigator.share({ title: 'Join my Groupz group', url }).catch(() => {})
      return
    }
    navigator.clipboard.writeText(url)
      .then(() => {
        setShared(true)
        setTimeout(() => setShared(false), 2000)
      })
      .catch(() => {})
  }

  return (
    <div className={styles.codeBlock}>
      <span className={styles.codeLabel}>CODE</span>
      <span className={styles.codeValue}>{code}</span>
      <button className={styles.copyBtn} onClick={handleCopy} aria-label="Copy group code">
        {copied ? '✓' : '⎘'}
      </button>
      <button className={styles.shareBtn} onClick={handleShare} aria-label="Share join link">
        {shared ? '✓' : '↗'}
      </button>
    </div>
  )
}
