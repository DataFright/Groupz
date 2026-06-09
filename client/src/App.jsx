import { useState, useEffect, useRef } from 'react'
import { socket } from './socket.js'
import Home from './components/Home.jsx'
import GroupMap from './components/GroupMap.jsx'

export default function App() {
  const [view, setView] = useState('home')
  const [groupInfo, setGroupInfo] = useState(null)
  const [members, setMembers] = useState([])
  const [notification, setNotification] = useState('')
  const [isReconnecting, setIsReconnecting] = useState(false)

  const pendingRejoinRef = useRef(null)
  const isRejoiningRef = useRef(false)
  const groupInfoRef = useRef(null)
  useEffect(() => { groupInfoRef.current = groupInfo }, [groupInfo])

  useEffect(() => {
    function onMembersUpdate(list) {
      setMembers(list)
    }

    function onRemovedFromGroup() {
      setView('home')
      setGroupInfo(null)
      setMembers([])
      socket.disconnect()
      setNotification('You were removed from the group by the host.')
    }

    function onGroupEnded() {
      setView('home')
      setGroupInfo(null)
      setMembers([])
      socket.disconnect()
      setNotification('The group was ended by the host.')
    }

    function onLeftGroup() {
      setView('home')
      setGroupInfo(null)
      setMembers([])
      socket.disconnect()
    }

    function onHostChanged({ newHostSocketId }) {
      setGroupInfo(prev => prev
        ? { ...prev, isHost: prev.mySocketId === newHostSocketId, hostSocketId: newHostSocketId }
        : prev
      )
    }

    // 'io client disconnect' = intentional (we called socket.disconnect()); skip.
    // Anything else = unexpected drop — if on the map, enter reconnecting state.
    function onDisconnect(reason) {
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

    // join-confirmed after a reconnect rejoin — update socket ID and clear banner.
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
      setView('home')
      setGroupInfo(null)
      setMembers([])
      setNotification('Could not reconnect. Please rejoin the group.')
    }

    // join-error during a reconnect rejoin (e.g. group was deleted while offline).
    function onReconnectError({ code: errCode }) {
      if (!isRejoiningRef.current) return
      isRejoiningRef.current = false
      pendingRejoinRef.current = null
      setIsReconnecting(false)
      setView('home')
      setGroupInfo(null)
      setMembers([])
      const msg = errCode === 'GROUP_NOT_FOUND'
        ? 'Your group ended while you were away.'
        : 'Could not rejoin the group. Please try again.'
      setNotification(msg)
    }

    // Page Visibility API — kick off reconnect immediately when screen unlocks.
    function onVisibilityChange() {
      if (document.visibilityState === 'visible' && !socket.connected && pendingRejoinRef.current) {
        socket.connect()
      }
    }

    socket.on('members-update', onMembersUpdate)
    socket.on('removed-from-group', onRemovedFromGroup)
    socket.on('group-ended', onGroupEnded)
    socket.on('left-group', onLeftGroup)
    socket.on('host-changed', onHostChanged)
    socket.on('disconnect', onDisconnect)
    socket.on('connect', onConnect)
    socket.on('join-confirmed', onReconnectConfirmed)
    socket.on('join-error', onReconnectError)
    socket.on('reconnect_failed', onReconnectFailed)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      socket.off('members-update', onMembersUpdate)
      socket.off('removed-from-group', onRemovedFromGroup)
      socket.off('group-ended', onGroupEnded)
      socket.off('left-group', onLeftGroup)
      socket.off('host-changed', onHostChanged)
      socket.off('disconnect', onDisconnect)
      socket.off('connect', onConnect)
      socket.off('join-confirmed', onReconnectConfirmed)
      socket.off('join-error', onReconnectError)
      socket.off('reconnect_failed', onReconnectFailed)
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
        <div
          style={{
            position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
            background: '#ef4444', color: '#fff', textAlign: 'center',
            padding: '12px 16px', fontSize: '14px', fontWeight: 500,
            cursor: 'pointer'
          }}
          onClick={() => setNotification('')}
        >
          {notification} (tap to dismiss)
        </div>
      )}
      {view === 'home'
        ? <Home onJoin={handleJoin} />
        : <GroupMap groupInfo={groupInfo} members={members} onLeave={handleLeave} isReconnecting={isReconnecting} />
      }
    </>
  )
}
