import { useState } from 'react'
import styles from '../styles/GroupMap.module.css'

// Displays the group code with a one-click copy button.
// Shows a ✓ tick for 2 seconds after a successful copy, then reverts.
export default function GroupCodeOverlay({ code }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    // writeText can throw in non-secure contexts or when permission is denied
    navigator.clipboard.writeText(code)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
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
    </div>
  )
}
