import { useCallback, useEffect, useRef, useState } from 'react'
import { useDispenser } from './hooks/useDispenser'
import { formatClock } from './lib/time'
import { Dashboard } from './pages/Dashboard'
import { Logs } from './pages/Logs'
import { Schedules } from './pages/Schedules'
import type { Notify, ToastKind } from './types'

type Tab = 'dashboard' | 'schedules' | 'logs'
type Toast = { id: number; message: string; kind: ToastKind }

const TABS: { id: Tab; label: string }[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'schedules', label: 'Schedules' },
  { id: 'logs', label: 'History' },
]

function Clock() {
  const [now, setNow] = useState(new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000)
    return () => clearInterval(t)
  }, [])
  return <span className="clock">{formatClock(now)}</span>
}

export default function App() {
  const [tab, setTab] = useState<Tab>('dashboard')
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)
  const { slots, schedules, logs, loading, error, live, logsVersion, refresh } = useDispenser()

  const notify: Notify = useCallback((message, kind = 'success') => {
    const id = nextId.current++
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000)
  }, [])

  const lowCount = slots.filter((s) => s.current_stock <= s.low_stock_threshold).length

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="logo">💊</div>
          <div>
            <h1>PillBox</h1>
            <span className="muted">Smart Medicine Dispenser</span>
          </div>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              {t.label}
              {t.id === 'dashboard' && lowCount > 0 && <span className="tab-badge">{lowCount}</span>}
            </button>
          ))}
        </nav>
        <div className="topbar-right">
          <Clock />
          <span className={`live ${live ? 'on' : ''}`} title={live ? 'Realtime updates connected' : 'Realtime off — refreshing every 15s'}>
            <span className="live-dot" />
            {live ? 'Live' : 'Polling'}
          </span>
        </div>
      </header>

      <main className="main">
        {error && (
          <div className="alert alert-error">
            <strong>Can't reach Supabase</strong>
            <p>{error}</p>
            <button className="btn sm secondary" onClick={refresh}>Retry</button>
          </div>
        )}

        {loading ? (
          <div className="loading"><span className="spinner" /> Loading dispenser…</div>
        ) : tab === 'dashboard' ? (
          <Dashboard slots={slots} schedules={schedules} logs={logs} notify={notify} refresh={refresh} />
        ) : tab === 'schedules' ? (
          <Schedules slots={slots} schedules={schedules} notify={notify} refresh={refresh} />
        ) : (
          <Logs slots={slots} logsVersion={logsVersion} notify={notify} />
        )}
      </main>

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </div>
  )
}
