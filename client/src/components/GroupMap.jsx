import { useState, useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { socket } from '../socket.js'
import MemberList from './MemberList.jsx'
import GroupCodeOverlay from './GroupCodeOverlay.jsx'
import styles from '../styles/GroupMap.module.css'

// Fix Leaflet's broken default icon paths in Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow
})

function createEmojiIcon(icon, isMe, active) {
  return L.divIcon({
    className: '',
    html: `<div class="emoji-marker${isMe ? ' emoji-marker--me' : ''}${!active ? ' emoji-marker--inactive' : ''}">${icon}</div>`,
    iconSize: [44, 44],
    iconAnchor: [22, 44],
    popupAnchor: [0, -48]
  })
}

// Inner component that has access to the map instance
function MapController({ members, mySocketId }) {
  const hasCenteredRef = useRef(false)
  const mapRef = useRef(null)

  // Get map instance via ref callback
  const getMap = (map) => { mapRef.current = map }

  useEffect(() => {
    if (!navigator.geolocation) return

    const intervalId = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords
          socket.emit('location-update', { lat, lng })

          if (!hasCenteredRef.current && mapRef.current) {
            mapRef.current.flyTo([lat, lng], 15, { duration: 1 })
            hasCenteredRef.current = true
          }
        },
        (err) => console.warn('Geolocation error:', err.message),
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      )
    }, 2500)

    return () => clearInterval(intervalId)
  }, [])

  return (
    <>
      {members
        .filter(m => m.lat !== null && m.lng !== null)
        .map(m => (
          <Marker
            key={m.socketId}
            position={[m.lat, m.lng]}
            icon={createEmojiIcon(m.icon, m.socketId === mySocketId, m.active)}
          >
            <Tooltip
              permanent
              direction="top"
              offset={[0, -48]}
              className="member-tooltip"
            >
              {m.name}
            </Tooltip>
          </Marker>
        ))
      }
      {/* Store map ref via a hidden element with a ref callback pattern */}
      <SetMapRef onMap={getMap} />
    </>
  )
}

// Utility to grab the map instance from react-leaflet context
import { useMap } from 'react-leaflet'
function SetMapRef({ onMap }) {
  const map = useMap()
  useEffect(() => { onMap(map) }, [map, onMap])
  return null
}

export default function GroupMap({ groupInfo, onLeave }) {
  const [members, setMembers] = useState([])
  const [showMembers, setShowMembers] = useState(false)
  const [showEndConfirm, setShowEndConfirm] = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const { code, mySocketId, isHost, hostSocketId } = groupInfo

  useEffect(() => {
    function onMembersUpdate(list) {
      setMembers(list)
    }
    socket.on('members-update', onMembersUpdate)
    return () => socket.off('members-update', onMembersUpdate)
  }, [])

  function handleLeaveClick() {
    setShowLeaveConfirm(true)
  }

  function confirmLeave() {
    setShowLeaveConfirm(false)
    onLeave()
  }

  function confirmEnd() {
    setShowEndConfirm(false)
    socket.emit('end-group')
  }

  const activeMemberCount = members.filter(m => m.active).length

  return (
    <div className={styles.wrapper}>
      {/* Fullscreen map */}
      <MapContainer
        center={[20, 0]}
        zoom={3}
        className={styles.map}
        zoomControl={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <MapController members={members} mySocketId={mySocketId} />
      </MapContainer>

      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <GroupCodeOverlay code={code} />
          <span className={styles.memberCount}>
            {activeMemberCount} {activeMemberCount === 1 ? 'member' : 'members'}
          </span>
        </div>
        {isHost && (
          <button
            className={styles.endButton}
            onClick={() => setShowEndConfirm(true)}
          >
            End Group
          </button>
        )}
      </div>

      {/* Bottom-right controls */}
      <div className={styles.bottomRight}>
        <button
          className={styles.fab}
          onClick={() => setShowMembers(v => !v)}
          aria-label="Members"
        >
          👥
        </button>
        <button
          className={`${styles.fab} ${styles.fabLeave}`}
          onClick={handleLeaveClick}
          aria-label="Leave"
        >
          🚪
        </button>
      </div>

      {/* Member list drawer */}
      <MemberList
        isOpen={showMembers}
        onClose={() => setShowMembers(false)}
        members={members}
        mySocketId={mySocketId}
        hostSocketId={hostSocketId}
        isHost={isHost}
      />

      {/* End group confirmation */}
      {showEndConfirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <p>End this group for everyone?</p>
            <div className={styles.dialogButtons}>
              <button className={styles.dialogCancel} onClick={() => setShowEndConfirm(false)}>Cancel</button>
              <button className={styles.dialogConfirm} onClick={confirmEnd}>End Group</button>
            </div>
          </div>
        </div>
      )}

      {/* Leave confirmation */}
      {showLeaveConfirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <p>Leave this group?</p>
            <div className={styles.dialogButtons}>
              <button className={styles.dialogCancel} onClick={() => setShowLeaveConfirm(false)}>Cancel</button>
              <button className={styles.dialogConfirm} onClick={confirmLeave}>Leave</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
