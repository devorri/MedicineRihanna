import { useEffect, useMemo, useState } from 'react'
import { SlotCard } from '../components/SlotCard'
import { EditSlotModal, RefillModal } from '../components/SlotModals'
import { requestDispense, requestDispenseAll } from '../lib/supabase'
import {
  countdown,
  dayLabel,
  formatDateTime,
  formatTime12,
  manilaDayStart,
  manilaNow,
  missedToday,
  upcomingDoses,
} from '../lib/time'
import { ACTION_LABELS, slotStatus, type DispenseLog, type Notify, type Schedule, type Slot } from '../types'

type Props = {
  slots: Slot[]
  schedules: Schedule[]
  logs: DispenseLog[]
  notify: Notify
  refresh: () => void
}

export function Dashboard({ slots, schedules, logs, notify, refresh }: Props) {
  const [editing, setEditing] = useState<Slot | null>(null)
  const [refilling, setRefilling] = useState<Slot | null>(null)
  const [, setTick] = useState(0)

  // Recompute countdowns / missed doses every 30s.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30000)
    return () => clearInterval(t)
  }, [])

  const now = manilaNow()
  const upcoming = upcomingDoses(schedules, 50)
  const missed = missedToday(schedules)
  const slotByNum = useMemo(() => new Map(slots.map((s) => [s.slot_number, s])), [slots])

  const todayStart = manilaDayStart(now.date).getTime()
  const todayLogs = logs.filter((l) => new Date(l.created_at).getTime() >= todayStart)
  const dispensedToday = todayLogs.filter((l) => l.action_type !== 'refill').reduce((a, l) => a + Math.abs(l.quantity), 0)
  const totalStock = slots.reduce((a, s) => a + s.current_stock, 0)
  const alertSlots = slots.filter((s) => slotStatus(s) !== 'ok')
  const next = upcoming[0]
  const dispenserBusy = slots.some((s) => s.remote_dispense_qty > 0)
  const countBy = (a: DispenseLog['action_type']) =>
    todayLogs.filter((l) => l.action_type === a).reduce((sum, l) => sum + Math.abs(l.quantity), 0)
  const stocked = slots.filter((s) => s.current_stock > 0)

  async function dispenseAll() {
    if (!stocked.length) return notify('All slots are empty', 'error')
    const list = stocked.map((s) => `• Slot ${s.slot_number}: ${s.pill_name}`).join('\n')
    if (!confirm(`Dispense 1 pill from each slot (one slot at a time)?\n\n${list}`)) return
    try {
      const queued = await requestDispenseAll()
      notify(queued.length ? `Queued ${queued.length} slot(s): ${queued.join(', ')}` : 'Nothing to dispense', queued.length ? 'success' : 'info')
      refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  async function giveMissed(s: Schedule) {
    const slot = slotByNum.get(s.slot_number)
    if (!slot) return
    if (!confirm(`Dispense ${s.dose_qty} × ${slot.pill_name} now?`)) return
    try {
      const res = await requestDispense(s.slot_number, s.dose_qty)
      notify(res === 'ok' ? 'Sent to dispenser' : 'A request for this slot is already pending', res === 'ok' ? 'success' : 'info')
      refresh()
    } catch (e) {
      notify((e as Error).message, 'error')
    }
  }

  return (
    <div className="page">
      <section className="stats">
        <div className="stat">
          <span className="stat-label">Pills in dispenser</span>
          <strong className="stat-value">{totalStock}</strong>
          <span className="muted">across {slots.length} slots</span>
        </div>
        <div className={`stat ${alertSlots.length ? 'stat-warn' : ''}`}>
          <span className="stat-label">Needs refill</span>
          <strong className="stat-value">{alertSlots.length}</strong>
          <span className="muted">
            {alertSlots.length ? alertSlots.map((s) => `Slot ${s.slot_number}`).join(', ') : 'All slots stocked'}
          </span>
        </div>
        <div className="stat">
          <span className="stat-label">Dispensed today</span>
          <strong className="stat-value">{dispensedToday}</strong>
          <span className="muted">
            {countBy('dispense_schedule')} scheduled · {countBy('dispense_button')} manual · {countBy('dispense_web')} remote
          </span>
        </div>
        <div className="stat stat-accent">
          <span className="stat-label">Next dose</span>
          {next ? (
            <>
              <strong className="stat-value sm">{formatTime12(next.schedule.schedule_time)}</strong>
              <span>
                {slotByNum.get(next.schedule.slot_number)?.pill_name} · {dayLabel(next.offset, next.date)} {countdown(next)}
              </span>
            </>
          ) : (
            <>
              <strong className="stat-value sm">—</strong>
              <span>No active schedules</span>
            </>
          )}
        </div>
      </section>

      {missed.length > 0 && (
        <section className="alert alert-warn">
          <strong>Missed doses today</strong>
          <p className="muted">These were scheduled but the dispenser didn't trigger them (it may have been offline).</p>
          <ul className="missed">
            {missed.map((s) => (
              <li key={s.id}>
                <span>
                  {formatTime12(s.schedule_time)} · Slot {s.slot_number} · {slotByNum.get(s.slot_number)?.pill_name} × {s.dose_qty}
                </span>
                <button className="btn sm primary" onClick={() => giveMissed(s)}>Dispense now</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="section-head">
          <div>
            <h2>Slots</h2>
            <span className="muted">One pill per click · the dispenser handles one request at a time (~10s pickup)</span>
          </div>
          <button className="btn primary" onClick={dispenseAll} disabled={dispenserBusy || !stocked.length}>
            {dispenserBusy ? 'Dispenser busy…' : 'Dispense all slots'}
          </button>
        </div>
        <div className="slot-grid">
          {slots.map((slot) => (
            <SlotCard
              key={slot.slot_number}
              slot={slot}
              nextDose={upcoming.find((u) => u.schedule.slot_number === slot.slot_number)}
              dispenserBusy={dispenserBusy}
              scheduleCount={schedules.filter((s) => s.slot_number === slot.slot_number && s.is_active).length}
              notify={notify}
              onEdit={() => setEditing(slot)}
              onRefill={() => setRefilling(slot)}
              onChanged={refresh}
            />
          ))}
        </div>
      </section>

      <div className="two-col">
        <section className="panel">
          <div className="section-head"><h2>Upcoming doses</h2></div>
          {upcoming.length === 0 ? (
            <p className="empty">No upcoming doses. Add a schedule in the Schedules tab.</p>
          ) : (
            <ul className="timeline">
              {upcoming.slice(0, 8).map((u) => {
                const slot = slotByNum.get(u.schedule.slot_number)
                const short = slot && slot.current_stock < u.schedule.dose_qty
                return (
                  <li key={`${u.schedule.id}-${u.date}`}>
                    <div className="tl-time">
                      <strong>{formatTime12(u.schedule.schedule_time)}</strong>
                      <span className="muted">{dayLabel(u.offset, u.date)}</span>
                    </div>
                    <div className="tl-body">
                      <span>Slot {u.schedule.slot_number} · {slot?.pill_name}</span>
                      <span className="muted">
                        {u.schedule.dose_qty} pc · {countdown(u)}
                        {short && <span className="badge badge-empty inline">Not enough stock</span>}
                      </span>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="panel">
          <div className="section-head"><h2>Recent activity</h2></div>
          {logs.length === 0 ? (
            <p className="empty">No activity yet.</p>
          ) : (
            <ul className="activity">
              {logs.slice(0, 8).map((l) => (
                <li key={l.id}>
                  <span className={`act-dot act-${l.action_type}`} />
                  <div className="act-body">
                    <span>
                      <strong>{l.quantity > 0 ? `+${l.quantity}` : l.quantity}</strong> {l.pill_name}
                      <span className={`tag tag-${l.action_type}`}>{ACTION_LABELS[l.action_type]}</span>
                    </span>
                    <span className="muted">
                      Slot {l.slot_number} · {formatDateTime(l.created_at)} · {l.remaining_stock} left
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {editing && <EditSlotModal slot={editing} onClose={() => setEditing(null)} notify={notify} onDone={refresh} />}
      {refilling && <RefillModal slot={refilling} onClose={() => setRefilling(null)} notify={notify} onDone={refresh} />}
    </div>
  )
}
