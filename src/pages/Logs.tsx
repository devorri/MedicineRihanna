import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { addDays, formatDateTime, manilaDayStart, manilaNow } from '../lib/time'
import { ACTION_LABELS, type ActionType, type DispenseLog, type Notify, type Slot } from '../types'

type Props = { slots: Slot[]; logsVersion: number; notify: Notify }

export function Logs({ slots, logsVersion, notify }: Props) {
  const today = manilaNow().date
  const [slot, setSlot] = useState(0)
  const [action, setAction] = useState<ActionType | ''>('')
  const [from, setFrom] = useState(addDays(today, -6))
  const [to, setTo] = useState(today)
  const [rows, setRows] = useState<DispenseLog[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    let q = supabase.from('dispense_logs').select('*').order('created_at', { ascending: false }).limit(1000)
    if (slot) q = q.eq('slot_number', slot)
    if (action) q = q.eq('action_type', action)
    if (from) q = q.gte('created_at', manilaDayStart(from).toISOString())
    if (to) q = q.lt('created_at', manilaDayStart(addDays(to, 1)).toISOString())
    const { data, error } = await q
    setLoading(false)
    if (error) return notify(error.message, 'error')
    setRows((data ?? []) as DispenseLog[])
  }, [slot, action, from, to, notify])

  useEffect(() => {
    // Re-fetch when filters change or a new log arrives.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load()
  }, [load, logsVersion])

  const dispensed = rows.filter((r) => r.action_type !== 'refill').reduce((a, r) => a + Math.abs(r.quantity), 0)
  const refilled = rows.filter((r) => r.action_type === 'refill').reduce((a, r) => a + r.quantity, 0)

  function exportCsv() {
    const header = ['Date/Time (PHT)', 'Slot', 'Medicine', 'Action', 'Quantity', 'Remaining']
    const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`
    const lines = rows.map((r) =>
      [formatDateTime(r.created_at), r.slot_number, r.pill_name, ACTION_LABELS[r.action_type], r.quantity, r.remaining_stock]
        .map(esc)
        .join(','),
    )
    const blob = new Blob([[header.map(esc).join(','), ...lines].join('\n')], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `dispense-logs_${from}_to_${to}.csv`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h2>History</h2>
          <span className="muted">Every dispense and refill recorded by the dispenser and this site.</span>
        </div>
        <button className="btn secondary" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>

      <div className="panel filters">
        <label>
          Slot
          <select value={slot} onChange={(e) => setSlot(Number(e.target.value))}>
            <option value={0}>All slots</option>
            {slots.map((s) => (
              <option key={s.slot_number} value={s.slot_number}>Slot {s.slot_number} · {s.pill_name}</option>
            ))}
          </select>
        </label>
        <label>
          Action
          <select value={action} onChange={(e) => setAction(e.target.value as ActionType | '')}>
            <option value="">All actions</option>
            {(Object.keys(ACTION_LABELS) as ActionType[]).map((a) => (
              <option key={a} value={a}>{ACTION_LABELS[a]}</option>
            ))}
          </select>
        </label>
        <label>
          From
          <input type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
        </label>
        <label>
          To
          <input type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </label>
        <div className="filter-summary">
          <span><strong>{rows.length}</strong> records</span>
          <span><strong>{dispensed}</strong> dispensed</span>
          <span><strong>{refilled}</strong> refilled</span>
        </div>
      </div>

      <div className="panel table-wrap">
        {loading ? (
          <p className="empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="empty">No records for these filters.</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Date / Time</th>
                <th>Slot</th>
                <th>Medicine</th>
                <th>Action</th>
                <th className="num">Qty</th>
                <th className="num">Remaining</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{formatDateTime(r.created_at)}</td>
                  <td><span className="slot-pill">{r.slot_number}</span></td>
                  <td>{r.pill_name}</td>
                  <td><span className={`tag tag-${r.action_type}`}>{ACTION_LABELS[r.action_type]}</span></td>
                  <td className={`num ${r.quantity > 0 ? 'pos' : 'neg'}`}>{r.quantity > 0 ? `+${r.quantity}` : r.quantity}</td>
                  <td className="num">{r.remaining_stock}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
