import { useEffect, useState } from 'react'
import { cancelDispense, requestDispense } from '../lib/supabase'
import { countdown, dayLabel, formatTime12, type UpcomingDose } from '../lib/time'
import { slotStatus, type Notify, type Slot } from '../types'

type Props = {
  slot: Slot
  nextDose?: UpcomingDose
  scheduleCount: number
  /** True while ANY slot has a request waiting — the dispenser does one thing at a time. */
  dispenserBusy: boolean
  notify: Notify
  onEdit: () => void
  onRefill: () => void
  onChanged: () => void
}

const STATUS_LABEL = { ok: 'In stock', low: 'Low stock', empty: 'Empty' }

export function SlotCard({ slot, nextDose, scheduleCount, dispenserBusy, notify, onEdit, onRefill, onChanged }: Props) {
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(() => Date.now())
  const pending = slot.remote_dispense_qty > 0
  const status = slotStatus(slot)
  const pct = slot.max_capacity > 0 ? Math.min(100, Math.round((slot.current_stock / slot.max_capacity) * 100)) : 0
  const waitedSec = Math.max(0, Math.round((now - new Date(slot.updated_at).getTime()) / 1000))

  // Tick every second while waiting so the elapsed counter moves.
  useEffect(() => {
    if (!pending) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [pending])

  async function dispenseOne() {
    if (slot.current_stock < 1) return notify(`Slot ${slot.slot_number} is empty`, 'error')
    setBusy(true)
    try {
      const res = await requestDispense(slot.slot_number, 1)
      if (res === 'busy') notify('A request for this slot is already pending', 'info')
      else notify(`Sent to dispenser: 1 × ${slot.pill_name}`, 'success')
      onChanged()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function cancel() {
    setBusy(true)
    try {
      await cancelDispense(slot.slot_number)
      notify('Request cancelled', 'info')
      onChanged()
    } catch (e) {
      notify((e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`slot-card status-${status}`}>
      <header className="slot-head">
        <div className="slot-num">{slot.slot_number}</div>
        <div className="slot-title">
          <h3 title={slot.pill_name}>{slot.pill_name}</h3>
          <p className="muted">{slot.dosage_notes || `Channel ${slot.pca_channel}`}</p>
        </div>
        <button className="icon-btn" onClick={onEdit} aria-label="Edit slot" title="Edit slot">✎</button>
      </header>

      <div className="stock">
        <div className="stock-top">
          <span className="stock-count">
            <strong>{slot.current_stock}</strong>
            <span className="muted"> / {slot.max_capacity} pills</span>
          </span>
          <span className={`badge badge-${status}`}>{STATUS_LABEL[status]}</span>
        </div>
        <div className="bar"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
      </div>

      <div className="slot-meta">
        <span className="muted">Next scheduled dose</span>
        {nextDose ? (
          <span>
            {dayLabel(nextDose.offset, nextDose.date)} · {formatTime12(nextDose.schedule.schedule_time)} ·{' '}
            {nextDose.schedule.dose_qty} pc <span className="muted">({countdown(nextDose)})</span>
          </span>
        ) : (
          <span className="muted">{scheduleCount ? 'None in next 7 days' : 'No schedule'}</span>
        )}
      </div>

      {pending ? (
        <div className="pending">
          <span className="spinner" />
          <div>
            <strong>Dispensing 1 pill…</strong>
            <p className="muted">
              Waiting for dispenser ({waitedSec}s)
              {waitedSec > 30 && ' — check if the ESP32 is online'}
            </p>
          </div>
          <button className="btn ghost sm" onClick={cancel} disabled={busy}>Cancel</button>
        </div>
      ) : (
        <div className="slot-actions">
          <button
            className="btn primary grow"
            onClick={dispenseOne}
            disabled={busy || dispenserBusy || slot.current_stock === 0}
            title={dispenserBusy ? 'Dispenser is busy — wait for the current dispense to finish' : undefined}
          >
            {dispenserBusy ? 'Dispenser busy…' : 'Dispense 1'}
          </button>
          <button className="btn secondary" onClick={onRefill} disabled={slot.current_stock >= slot.max_capacity}>
            Refill
          </button>
        </div>
      )}
    </article>
  )
}
