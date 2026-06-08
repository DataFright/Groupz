import { useState, useEffect, useRef } from 'react'
import { socket } from '../socket.js'
import { ICONS } from '../constants/icons.js'
import IconPicker from './IconPicker.jsx'
import { ErrorCode } from '../errorCodes.js'
import styles from '../styles/Home.module.css'

export default function Home({ onJoin }) {
  const [tab, setTab] = useState('create')
  const [name, setName] = useState('')
  const [icon, setIcon] = useState(ICONS[0])
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const codeInputRef = useRef(null)
  const nameInputRef = useRef(null)

  useEffect(() => {
    function onGroupCreated({ code: groupCode, socketId }) {
      setLoading(false)
      onJoin({
        code: groupCode,
        mySocketId: socketId,
        myName: name.trim(),
        myIcon: icon,
        isHost: true,
        hostSocketId: socketId
      })
    }

    function onJoinConfirmed({ code: groupCode, socketId, hostSocketId }) {
      setLoading(false)
      onJoin({
        code: groupCode,
        mySocketId: socketId,
        myName: name.trim(),
        myIcon: icon,
        isHost: socketId === hostSocketId,
        hostSocketId
      })
    }

    function onJoinError({ code: errCode, message }) {
      setLoading(false)
      setError(message)
      socket.disconnect()
      // Focus the relevant input based on the specific error
      if (errCode === ErrorCode.GROUP_NOT_FOUND || errCode === ErrorCode.CODE_REQUIRED) {
        setTimeout(() => codeInputRef.current?.focus(), 0)
      } else if (errCode === ErrorCode.INVALID_NAME) {
        setTimeout(() => nameInputRef.current?.focus(), 0)
      }
    }

    socket.on('group-created', onGroupCreated)
    socket.on('join-confirmed', onJoinConfirmed)
    socket.on('join-error', onJoinError)

    return () => {
      socket.off('group-created', onGroupCreated)
      socket.off('join-confirmed', onJoinConfirmed)
      socket.off('join-error', onJoinError)
    }
  }, [name, icon, onJoin])

  function validate() {
    if (!name.trim()) return 'Enter your name'
    if (name.trim().length > 16) return 'Name must be 16 characters or less'
    if (tab === 'join' && !code.trim()) return 'Enter the group code'
    return null
  }

  function handleSubmit(e) {
    e.preventDefault()
    setError('')
    const validationError = validate()
    if (validationError) { setError(validationError); return }

    setLoading(true)
    socket.connect()

    if (tab === 'create') {
      socket.emit('create-group', { name: name.trim(), icon })
    } else {
      socket.emit('join-group', { code: code.trim().toUpperCase(), name: name.trim(), icon })
    }

    // Timeout if server doesn't respond
    const timeout = setTimeout(() => {
      setLoading(false)
      setError('Connection failed. Please try again.')
      socket.disconnect()
    }, 8000)

    socket.once('group-created', () => clearTimeout(timeout))
    socket.once('join-confirmed', () => clearTimeout(timeout))
    socket.once('join-error', () => clearTimeout(timeout))
  }

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        <h1 className={styles.title}>Groupz</h1>
        <p className={styles.subtitle}>Live location sharing for groups</p>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'create' ? styles.activeTab : ''}`}
            onClick={() => { setTab('create'); setError('') }}
          >
            Create Group
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'join' ? styles.activeTab : ''}`}
            onClick={() => { setTab('join'); setError('') }}
          >
            Join Group
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {tab === 'join' && (
            <div className={styles.field}>
              <label className={styles.label}>Group Code</label>
              <input
                ref={codeInputRef}
                className={styles.input}
                type="text"
                placeholder="Enter 6-character code"
                value={code}
                onChange={e => setCode(e.target.value.toUpperCase())}
                maxLength={6}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
              />
            </div>
          )}

          <div className={styles.field}>
            <label className={styles.label}>Your Name</label>
            <input
              ref={nameInputRef}
              className={styles.input}
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={16}
              autoComplete="off"
            />
          </div>

          <div className={styles.field}>
            <label className={styles.label}>Choose Icon</label>
            <IconPicker value={icon} onChange={setIcon} />
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={loading}
          >
            {loading ? 'Connecting…' : tab === 'create' ? 'Create Group' : 'Join Group'}
          </button>
        </form>
      </div>
    </div>
  )
}
