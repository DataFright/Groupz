import { useState, useEffect } from 'react'
import { socket } from './socket.js'
import Home from './components/Home.jsx'
import GroupMap from './components/GroupMap.jsx'

export default function App() {
  const [view, setView] = useState('home')
  const [groupInfo, setGroupInfo] = useState(null)
  const [members, setMembers] = useState([])
  const [notification, setNotification] = useState('')

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

    // 'io client disconnect' means we called socket.disconnect() intentionally;
    // anything else is an unexpected drop — send the user home with a message.
    function onDisconnect(reason) {
      if (reason !== 'io client disconnect') {
        setView('home')
        setGroupInfo(null)
        setMembers([])
        setNotification('Connection lost. Please check your network and try again.')
      }
    }

    socket.on('members-update', onMembersUpdate)
    socket.on('removed-from-group', onRemovedFromGroup)
    socket.on('group-ended', onGroupEnded)
    socket.on('left-group', onLeftGroup)
    socket.on('host-changed', onHostChanged)
    socket.on('disconnect', onDisconnect)

    return () => {
      socket.off('members-update', onMembersUpdate)
      socket.off('removed-from-group', onRemovedFromGroup)
      socket.off('group-ended', onGroupEnded)
      socket.off('left-group', onLeftGroup)
      socket.off('host-changed', onHostChanged)
      socket.off('disconnect', onDisconnect)
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
        : <GroupMap groupInfo={groupInfo} members={members} onLeave={handleLeave} />
      }
    </>
  )
}
