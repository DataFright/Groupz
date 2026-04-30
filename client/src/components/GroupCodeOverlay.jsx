import { useState } from 'react'
import styles from '../styles/GroupMap.module.css'

export default function GroupCodeOverlay({ code }) {
  const [copied, setCopied] = useState(false)

  function handleCopy() {
    navigator.clipboard.writeText(code).then(() => showCopied())
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
