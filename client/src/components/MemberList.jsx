import { socket } from '../socket.js'
import styles from '../styles/MemberList.module.css'

export default function MemberList({ isOpen, onClose, members, mySocketId, hostSocketId, isHost }) {
  function handleRemove(targetSocketId) {
    socket.emit('remove-member', { targetSocketId })
  }

  return (
    <div className={`${styles.drawer} ${isOpen ? styles.open : ''}`}>
      <div className={styles.header}>
        <span className={styles.title}>Members ({members.length})</span>
        <button className={styles.closeBtn} onClick={onClose} aria-label="Close">✕</button>
      </div>
      <ul className={styles.list}>
        {members.map(m => (
          <li key={m.socketId} className={styles.item}>
            <span className={styles.icon}>{m.icon}</span>
            <span className={styles.name}>
              {m.name}
              {m.socketId === mySocketId && <span className={styles.badge}>You</span>}
              {m.socketId === hostSocketId && <span className={styles.hostBadge}>HOST</span>}
              {!m.active && <span className={styles.inactiveBadge}>inactive</span>}
            </span>
            {isHost && m.socketId !== mySocketId && (
              <button
                className={styles.removeBtn}
                onClick={() => handleRemove(m.socketId)}
                aria-label={`Remove ${m.name}`}
              >
                ✕
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
