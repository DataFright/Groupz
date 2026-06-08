import styles from '../styles/IconPicker.module.css'
import { ICONS } from '../constants/icons.js'

export default function IconPicker({ value, onChange }) {
  return (
    <div className={styles.grid}>
      {ICONS.map(icon => (
        <button
          key={icon}
          type="button"
          className={`${styles.cell} ${value === icon ? styles.selected : ''}`}
          onClick={() => onChange(icon)}
          aria-label={icon}
        >
          {icon}
        </button>
      ))}
    </div>
  )
}
