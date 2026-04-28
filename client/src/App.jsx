import { useState, useEffect } from 'react'
import { socket } from './socket.js'
import Home from './components/Home.jsx'
import GroupMap from './components/GroupMap.jsx'

export default function App() {
  const [view, setView] = useState('home')
  const [groupInfo, setGroupInfo] = useState(null)
  const [notification, setNotification] = useState('')

  useEffect(() => {
    function onRemovedFromGroup() {
      setView('home')
      setGroupInfo(null)
      socket.disconnect()
      setNotification('You were removed from the group by the host.')
    }

    function onGroupEnded() {
      setView('home')
      setGroupInfo(null)
      socket.disconnect()
      setNotification('The group was ended by the host.')
    }

    function onLeftGroup() {
      setView('home')
      setGroupInfo(null)
      socket.disconnect()
    }

    function onHostChanged({ newHostSocketId }) {
      setGroupInfo(prev => prev
        ? { ...prev, isHost: prev.mySocketId === newHostSocketId, hostSocketId: newHostSocketId }
        : prev
      )
    }

    socket.on('removed-from-group', onRemovedFromGroup)
    socket.on('group-ended', onGroupEnded)
    socket.on('left-group', onLeftGroup)
    socket.on('host-changed', onHostChanged)

    return () => {
      socket.off('removed-from-group', onRemovedFromGroup)
      socket.off('group-ended', onGroupEnded)
      socket.off('left-group', onLeftGroup)
      socket.off('host-changed', onHostChanged)
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
        : <GroupMap groupInfo={groupInfo} onLeave={handleLeave} />
      }
    </>
  )
}
