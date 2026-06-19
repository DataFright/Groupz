// Fullscreen Leaflet map shown while a user is in an active group.
// MapController is an inner component that lives inside MapContainer so it can
// access the Leaflet map instance via useMap() and run the geolocation loop.

import { useState, useEffect, useReducer, useRef, useCallback } from 'react'
import { MapContainer, TileLayer, Marker, Tooltip, useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { socket } from '../socket.js'
import { computeOverlapOffsets } from '../utils/computeOverlapOffsets.js'
import MemberList from './MemberList.jsx'
import GroupCodeOverlay from './GroupCodeOverlay.jsx'
import styles from '../styles/GroupMap.module.css'

// Fix Leaflet's broken default icon paths in Vite
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon   from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconUrl:       markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl:     markerShadow,
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function createEmojiIcon(icon, isMe, active, dx = 0, dy = 0) {
  const shift = (dx || dy) ? ` style="transform:translate(${dx}px,${dy}px)"` : ''
  return L.divIcon({
    className: '',
    html: `<div class="emoji-marker${isMe ? ' emoji-marker--me' : ''}${!active ? ' emoji-marker--inactive' : ''}"${shift}>${icon}</div>`,
    iconSize:    [44, 44],
    iconAnchor:  [22, 44],
    popupAnchor: [0, -48],
  })
}

// ─── MapController ─────────────────────────────────────────────────────────────
// Runs the geolocation poll loop and renders member markers.
// Must be a child of MapContainer to access the Leaflet map via useMap().
// flyToMeRef is a ref owned by GroupMap — MapController writes a closure into it
// so the re-center FAB can trigger map.flyTo without re-rendering this component.

function MapController({ members, mySocketId, onGeoError, flyToMeRef }) {
  const hasCenteredRef  = useRef(false)
  const mapRef          = useRef(null)
  const myPosRef        = useRef(null)
  const map             = useMap()
  const [, bumpZoom]    = useReducer(x => x + 1, 0)  // triggers re-render on zoom so offsets recalculate

  const getMap = useCallback((m) => {
    mapRef.current = m
    flyToMeRef.current = () => {
      if (mapRef.current && myPosRef.current) {
        mapRef.current.flyTo(myPosRef.current, 15, { duration: 1 })
      }
    }
  }, [flyToMeRef])

  // Pixel distances between markers change on zoom, so recalculate groupings after each zoom.
  useEffect(() => {
    map.on('zoomend', bumpZoom)
    return () => map.off('zoomend', bumpZoom)
  }, [map, bumpZoom])

  useEffect(() => {
    if (!navigator.geolocation) {
      onGeoError('Geolocation is not supported by this browser.')
      return
    }

    const intervalId = setInterval(() => {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const { latitude: lat, longitude: lng } = pos.coords
          myPosRef.current = [lat, lng]
          onGeoError(null)
          socket.emit('location-update', { lat, lng })

          // Fly to the user's position on the first fix only
          if (!hasCenteredRef.current && mapRef.current) {
            mapRef.current.flyTo([lat, lng], 15, { duration: 1 })
            hasCenteredRef.current = true
          }
        },
        (err) => {
          console.warn('Geolocation error:', err.message)
          onGeoError(err.message)
        },
        { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
      )
    }, 2500)

    return () => clearInterval(intervalId)
  }, [onGeoError])

  const visible = members.filter(m => m.lat !== null && m.lng !== null)
  const offsets = computeOverlapOffsets(visible, map)

  return (
    <>
      {visible.map(m => {
        const [dx, dy] = offsets[m.socketId] ?? [0, 0]
        return (
          <Marker
            key={m.socketId}
            position={[m.lat, m.lng]}
            icon={createEmojiIcon(m.icon, m.socketId === mySocketId, m.active, dx, dy)}
          >
            <Tooltip
              key={`${m.socketId}-${dx}-${dy}`}
              permanent
              direction="top"
              offset={[dx, -48 + dy]}
              className="member-tooltip"
            >
              {m.name}
            </Tooltip>
          </Marker>
        )
      })}
      <SetMapRef onMap={getMap} />
    </>
  )
}

// Bridges the react-leaflet context to MapController's callback ref.
// useMap() is only callable inside a MapContainer child, so this thin
// wrapper extracts the map instance and passes it up via onMap().
function SetMapRef({ onMap }) {
  const map = useMap()
  useEffect(() => { onMap(map) }, [map, onMap])
  return null
}

// ─── GroupMap ──────────────────────────────────────────────────────────────────

export default function GroupMap({ groupInfo, members, onLeave, isReconnecting }) {
  const [showMembers,      setShowMembers]      = useState(false)
  const [showEndConfirm,   setShowEndConfirm]   = useState(false)
  const [showLeaveConfirm, setShowLeaveConfirm] = useState(false)
  const [geoError,         setGeoError]         = useState(null)
  const flyToMeRef  = useRef(null)
  const wakeLockRef = useRef(null)
  const { code, mySocketId, isHost, hostSocketId } = groupInfo

  // ─── Wake lock ─────────────────────────────────────────────────────────────
  // Request a screen wake lock while the map is active so the phone doesn't
  // sleep mid-trip. The browser releases the lock automatically on screen-off;
  // we re-acquire it when the page becomes visible again (screen unlock).
  useEffect(() => {
    async function acquireWakeLock() {
      if (!navigator.wakeLock) return
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      } catch {
        // Silently ignore — unsupported browser or permission denied
      }
    }

    function onVisibilityChange() {
      if (document.visibilityState === 'visible') acquireWakeLock()
    }

    acquireWakeLock()
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', onVisibilityChange)
      wakeLockRef.current?.release().catch(() => {})
      wakeLockRef.current = null
    }
  }, [])

  // ─── Actions ───────────────────────────────────────────────────────────────

  function confirmLeave() {
    setShowLeaveConfirm(false)
    onLeave()
  }

  function confirmEnd() {
    setShowEndConfirm(false)
    socket.emit('end-group')
  }

  const activeMemberCount = members.length

  // ─── Render ────────────────────────────────────────────────────────────────

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
        <MapController
          members={members}
          mySocketId={mySocketId}
          onGeoError={setGeoError}
          flyToMeRef={flyToMeRef}
        />
      </MapContainer>

      {/* Reconnecting banner — shown while socket is re-establishing after screen lock */}
      {isReconnecting && (
        <div className={styles.reconnecting}>Reconnecting…</div>
      )}

      {/* Top bar */}
      <div className={styles.topBar}>
        <div className={styles.topLeft}>
          <GroupCodeOverlay code={code} />
        </div>
        <div className={styles.topRight}>
          <span className={styles.memberCount}>
            {activeMemberCount} {activeMemberCount === 1 ? 'member' : 'members'}
          </span>
          {isHost && (
            <button className={styles.endButton} onClick={() => setShowEndConfirm(true)}>
              End Group
            </button>
          )}
        </div>
      </div>

      {/* Compass — north-up indicator */}
      <div className={styles.compass} aria-label="North is up">
        <span className={styles.compassN}>N</span>
      </div>

      {/* Geolocation error banner */}
      {geoError && (
        <div className={styles.geoError}>
          <span>📍 Location unavailable: {geoError}</span>
          <button
            className={styles.geoErrorDismiss}
            onClick={() => setGeoError(null)}
            aria-label="Dismiss location error"
          >
            ✕
          </button>
        </div>
      )}

      {/* Bottom-right FABs */}
      <div className={styles.bottomRight}>
        <button
          className={styles.fab}
          onClick={() => flyToMeRef.current?.()}
          aria-label="Re-center map"
        >
          🎯
        </button>
        <button
          className={styles.fab}
          onClick={() => setShowMembers(v => !v)}
          aria-label="Members"
        >
          👥
        </button>
        <button
          className={`${styles.fab} ${styles.fabLeave}`}
          onClick={() => setShowLeaveConfirm(true)}
          aria-label="Leave"
        >
          🚪
        </button>
      </div>

      {/* Members drawer */}
      <MemberList
        isOpen={showMembers}
        onClose={() => setShowMembers(false)}
        members={members}
        mySocketId={mySocketId}
        hostSocketId={hostSocketId}
        isHost={isHost}
      />

      {/* End Group confirmation */}
      {showEndConfirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <p>End this group for everyone?</p>
            <div className={styles.dialogButtons}>
              <button className={styles.dialogCancel} onClick={() => setShowEndConfirm(false)}>
                Cancel
              </button>
              <button className={styles.dialogConfirm} onClick={confirmEnd}>
                End Group
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Leave Group confirmation */}
      {showLeaveConfirm && (
        <div className={styles.overlay}>
          <div className={styles.dialog}>
            <p>Leave this group?</p>
            <div className={styles.dialogButtons}>
              <button className={styles.dialogCancel} onClick={() => setShowLeaveConfirm(false)}>
                Cancel
              </button>
              <button className={styles.dialogConfirm} onClick={confirmLeave}>
                Leave
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
