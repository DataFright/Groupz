import { useState } from 'react'
import styles from '../styles/GroupMap.module.css'

export default function GroupCodeOverlay({ code }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    const text = code
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => showCopied())
    } else {
      // Fallback for non-HTTPS or older browsers
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      showCopied()
    }
  }

  function showCopied() {
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
