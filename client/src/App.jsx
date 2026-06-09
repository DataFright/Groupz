// Root component: owns all socket listeners and view-routing state.
// Only two views: 'home' (the join/create form) and 'map' (the live group map).

import { useState, useEffect, useRef } from 'react'
import { socket } from './socket.js'
import { ErrorCode } from './errorCodes.js'
import Home from './components/Home.jsx'
import GroupMap from './components/GroupMap.jsx'
import styles from './styles/App.module.css'

export default function App() {
  const [view, setView]               = useState('home')
  const [groupInfo, setGroupInfo]     = useState(null)
  const [members, setMembers]         = useState([])
  const [notification, setNotification] = useState('')
  const [isReconnecting, setIsReconnecting] = useState(false)

  // groupInfoRef mirrors groupInfo so the disconnect handler can read the
  // current group without being re-registered every time groupInfo changes.
  const groupInfoRef = useRef(null)
  useEffect(() => { groupInfoRef.current = groupInfo }, [groupInfo])

  // pendingRejoinRef stores groupInfo while the socket is reconnecting so
  // onConnect can re-emit join-group with the original code/name/icon.
  const pendingRejoinRef = useRef(null)

  // isRejoiningRef gates onReconnectConfirmed and onReconnectError so the
  // normal first-time join-confirmed from Home.jsx is not misread as a rejoin.
  const isRejoiningRef = useRef(false)

  useEffect(() => {
    // Resets all group state and returns to the home screen.
    // Accepts an optional notification message to show after navigating home.
    function goHome(msg = '') {
      setView('home')
      setGroupInfo(null)
      setMembers([])
      if (msg) setNotification(msg)
    }

    // ─── Group lifecycle ───────────────────────────────────────────────────

    function onMembersUpdate(list) {
      setMembers(list)
    }

    function onRemovedFromGroup() {
      socket.disconnect()
      goHome('You were removed from the group by the host.')
    }

    function onGroupEnded() {
      socket.disconnect()
      goHome('The group was ended by the host.')
    }

    function onLeftGroup() {
      socket.disconnect()
      goHome()
    }

    function onHostChanged({ newHostSocketId }) {
      setGroupInfo(prev => prev
        ? { ...prev, isHost: prev.mySocketId === newHostSocketId, hostSocketId: newHostSocketId }
        : prev
      )
    }

    // ─── Reconnect flow ────────────────────────────────────────────────────
    // When the socket drops unexpectedly (screen lock, network blip), we store
    // the current group info and show a reconnecting banner instead of going home.
    // On reconnect, we silently re-emit join-group to resume the session.

    function onDisconnect(reason) {
      // 'io client disconnect' = we called socket.disconnect() intentionally; skip.
      if (reason === 'io client disconnect') return
      const current = groupInfoRef.current
      if (current) {
        pendingRejoinRef.current = current
        setIsReconnecting(true)
      } else {
        setNotification('Connection lost. Please check your network and try again.')
      }
    }

    // Fires on both initial connect and every reconnect.
    // Only acts when there's a pending rejoin stored by onDisconnect.
    function onConnect() {
      const rejoin = pendingRejoinRef.current
      if (!rejoin) return
      pendingRejoinRef.current = null
      isRejoiningRef.current = true
      socket.emit('join-group', {
        code: rejoin.code,
        name: rejoin.myName,
        icon: rejoin.myIcon,
      })
    }

    // join-confirmed after a reconnect rejoin — update the socket ID (it changed)
    // and clear the reconnecting banner. Guarded by isRejoiningRef so first-time
    // join-confirmed events from Home.jsx are ignored here.
    function onReconnectConfirmed({ socketId, hostSocketId }) {
      if (!isRejoiningRef.current) return
      isRejoiningRef.current = false
      setGroupInfo(prev => prev ? {
        ...prev,
        mySocketId: socketId,
        isHost: socketId === hostSocketId,
        hostSocketId,
      } : prev)
      setIsReconnecting(false)
    }

    // All Socket.IO reconnect attempts exhausted.
    function onReconnectFailed() {
      pendingRejoinRef.current = null
      isRejoiningRef.current = false
      setIsReconnecting(false)
      goHome('Could not reconnect. Please rejoin the group.')
    }

    // join-error during a reconnect rejoin (e.g. group was deleted while offline).
    function onReconnectError({ code: errCode }) {
      if (!isRejoiningRef.current) return
      isRejoiningRef.current = false
      pendingRejoinRef.current = null
      setIsReconnecting(false)
      const msg = errCode === ErrorCode.GROUP_NOT_FOUND
        ? 'Your group ended while you were away.'
        : 'Could not rejoin the group. Please try again.'
      goHome(msg)
    }

    // Page Visibility API — kick off reconnect immediately on screen unlock
    // rather than waiting for the next Socket.IO retry interval.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !socket.connected && pendingRejoinRef.current) {
        socket.connect()
      }
    }

    // ─── Register / deregister ─────────────────────────────────────────────

    socket.on('members-update',     onMembersUpdate)
    socket.on('removed-from-group', onRemovedFromGroup)
    socket.on('group-ended',        onGroupEnded)
    socket.on('left-group',         onLeftGroup)
    socket.on('host-changed',       onHostChanged)
    socket.on('disconnect',         onDisconnect)
    socket.on('connect',            onConnect)
    socket.on('join-confirmed',     onReconnectConfirmed)
    socket.on('join-error',         onReconnectError)
    socket.on('reconnect_failed',   onReconnectFailed)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      socket.off('members-update',     onMembersUpdate)
      socket.off('removed-from-group', onRemovedFromGroup)
      socket.off('group-ended',        onGroupEnded)
      socket.off('left-group',         onLeftGroup)
      socket.off('host-changed',       onHostChanged)
      socket.off('disconnect',         onDisconnect)
      socket.off('connect',            onConnect)
      socket.off('join-confirmed',     onReconnectConfirmed)
      socket.off('join-error',         onReconnectError)
      socket.off('reconnect_failed',   onReconnectFailed)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [])

  function handleJoin(info) {
    setGroupInfo(info)
    setView('map')
  }

  function handleLeave() {
    socket.emit('leave-group')
  }

  return (
    <>
      {notification && (
        <div className={styles.notification} onClick={() => setNotification('')}>
          {notification} (tap to dismiss)
        </div>
      )}
      {view === 'home'
        ? <Home onJoin={handleJoin} />
        : <GroupMap
            groupInfo={groupInfo}
            members={members}
            onLeave={handleLeave}
            isReconnecting={isReconnecting}
          />
      }
    </>
  )
}
