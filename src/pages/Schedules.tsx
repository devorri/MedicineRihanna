import { useState, type FormEvent } from 'react'
import { Modal } from '../components/Modal'
import { supabase } from '../lib/supabase'
import { DAY_LABELS, describeDays, formatTime12, manilaNow } from '../lib/time'
import type { Notify, Schedule, Slot } from '../types'

type Props = { slots: Slot[]; schedules: Schedule[]; notify: Notify; refresh: () => void }

export function Schedules({ slots, schedules, notify, refresh }: Props) {
  const [editing, setEditing] = useState<Schedule | 'new' | null>(null)
  const [filter, setFilter] = useState(0)
  const slotByNum = new Map(slots.map((s) => [s.slot_number, s]))
  const today = manilaNow().date
  const list = schedules.filter((s) => !filter || s.slot_number === filter)

  async function toggle(s: Schedule) {
    const { error } = await supabase.from('pill_schedules').update({ is_active: !s.is_active }).eq('id', s.id)
    if (error) return notify(error.message, 'error')
    notify(s.is_active ? 'Schedule paused' : 'Schedule activated')
    refresh()
  }

  async function remove(s: Schedule) {
    if (!confirm(`Delete the ${formatTime12(s.schedule_time)} schedule for Slot ${s.slot_number}?`)) return
    const { error } = await supabase.from('pill_schedules').delete().eq('id', s.id)
    if (error) return notify(error.message, 'error')
    notify('Schedule deleted')
    refresh()
  }

  return (
    <div className="page">
      <div className="section-head">
        <div>
          <h2>Schedules</h2>
          <span className="muted">The dispenser refreshes this list every minute and fires doses on time (Philippine time).</span>
        </div>
        <div className="head-actions">
          <select value={filter} onChange={(e) => setFilter(Number(e.target.value))}>
            <option value={0}>All slots</option>
            {slots.map((s) => (
              <option key={s.slot_number} value={s.slot_number}>Slot {s.slot_number} · {s.pill_name}</option>
            ))}
          </select>
          <button className="btn primary" onClick={() => setEditing('new')}>+ Add schedule</button>
        </div>
      </div>

      {list.length === 0 ? (
        <div className="panel empty">No schedules yet. Click “Add schedule” to create one.</div>
      ) : (
        <div className="panel table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Time</th>
                <th>Slot / Medicine</th>
                <th>Dose</th>
                <th>Days</th>
                <th>Last given</th>
                <th>Active</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => {
                const slot = slotByNum.get(s.slot_number)
                return (
                  <tr key={s.id} className={s.is_active ? '' : 'row-off'}>
                    <td><strong>{formatTime12(s.schedule_time)}</strong></td>
                    <td>
                      <span className="slot-pill">{s.slot_number}</span> {slot?.pill_name}
                      {slot && slot.current_stock < s.dose_qty && <span className="badge badge-empty inline">Low stock</span>}
                    </td>
                    <td>{s.dose_qty} pc</td>
                    <td>
                      <div className="day-dots">
                        {DAY_LABELS.map((d, i) => (
                          <span key={d} className={s.days_of_week.includes(i) ? 'on' : ''} title={d}>{d[0]}</span>
                        ))}
                      </div>
                    </td>
                    <td>
                      {s.last_triggered_date === today ? (
                        <span className="badge badge-ok">Today</span>
                      ) : (
                        <span className="muted">{s.last_triggered_date ?? 'Never'}</span>
                      )}
                    </td>
                    <td>
                      <label className="switch">
                        <input type="checkbox" checked={s.is_active} onChange={() => toggle(s)} />
                        <span />
                      </label>
                    </td>
                    <td className="row-actions">
                      <button className="btn ghost sm" onClick={() => setEditing(s)}>Edit</button>
                      <button className="btn danger-ghost sm" onClick={() => remove(s)}>Delete</button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <ScheduleModal
          schedule={editing === 'new' ? null : editing}
          slots={slots}
          schedules={schedules}
          defaultSlot={filter || 1}
          onClose={() => setEditing(null)}
          notify={notify}
          onDone={refresh}
        />
      )}
    </div>
  )
}

type ModalProps = {
  schedule: Schedule | null
  slots: Slot[]
  schedules: Schedule[]
  defaultSlot: number
  onClose: () => void
  notify: Notify
  onDone: () => void
}

function ScheduleModal({ schedule, slots, schedules, defaultSlot, onClose, notify, onDone }: ModalProps) {
  const [slotNumber, setSlotNumber] = useState(schedule?.slot_number ?? defaultSlot)
  const [time, setTime] = useState(schedule?.schedule_time.slice(0, 5) ?? '08:00')
  const [dose, setDose] = useState(schedule?.dose_qty ?? 1)
  const [days, setDays] = useState<number[]>(schedule?.days_of_week ?? [0, 1, 2, 3, 4, 5, 6])
  const [active, setActive] = useState(schedule?.is_active ?? true)
  const [saving, setSaving] = useState(false)

  const slot = slots.find((s) => s.slot_number === slotNumber)
  const duplicate = schedules.some(
    (s) => s.id !== schedule?.id && s.slot_number === slotNumber && s.schedule_time.slice(0, 5) === time,
  )
  const firedToday = schedule?.last_triggered_date === manilaNow().date
  const valid = !!time && dose >= 1 && days.length > 0 && !duplicate

  function toggleDay(d: number) {
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort()))
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    const payload = {
      slot_number: slotNumber,
      schedule_time: `${time}:00`,
      dose_qty: dose,
      days_of_week: days,
      is_active: active,
    }
    const { error } = schedule
      ? await supabase.from('pill_schedules').update(payload).eq('id', schedule.id)
      : await supabase.from('pill_schedules').insert(payload)
    setSaving(false)
    if (error) return notify(error.message, 'error')
    notify(schedule ? 'Schedule updated' : 'Schedule added')
    onDone()
    onClose()
  }

  return (
    <Modal
      title={schedule ? 'Edit schedule' : 'New schedule'}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="sched-form" disabled={!valid || saving}>
            {saving ? 'Saving…' : 'Save schedule'}
          </button>
        </>
      }
    >
      <form id="sched-form" className="form" onSubmit={save}>
        <label>
          Slot
          <select value={slotNumber} onChange={(e) => setSlotNumber(Number(e.target.value))}>
            {slots.map((s) => (
              <option key={s.slot_number} value={s.slot_number}>
                Slot {s.slot_number} · {s.pill_name} ({s.current_stock} left)
              </option>
            ))}
          </select>
        </label>
        <div className="row-2">
          <label>
            Time (PH time)
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
          </label>
          <label>
            Pills per dose
            <input type="number" min={1} max={10} value={dose} onChange={(e) => setDose(Number(e.target.value))} />
          </label>
        </div>
        <div>
          <span className="label">Repeat on · <span className="muted">{days.length ? describeDays(days) : 'Pick at least one day'}</span></span>
          <div className="day-picker">
            {DAY_LABELS.map((d, i) => (
              <button type="button" key={d} className={days.includes(i) ? 'on' : ''} onClick={() => toggleDay(i)}>{d}</button>
            ))}
          </div>
          <div className="chips">
            <button type="button" className="chip" onClick={() => setDays([0, 1, 2, 3, 4, 5, 6])}>Every day</button>
            <button type="button" className="chip" onClick={() => setDays([1, 2, 3, 4, 5])}>Weekdays</button>
            <button type="button" className="chip" onClick={() => setDays([0, 6])}>Weekends</button>
          </div>
        </div>
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active
        </label>
        {duplicate && <p className="field-error">This slot already has a schedule at {formatTime12(time)}.</p>}
        {slot && slot.current_stock < dose && (
          <p className="field-warn">Slot {slot.slot_number} only has {slot.current_stock} pill(s) left.</p>
        )}
        {firedToday && (
          <p className="field-warn">This schedule already dispensed today — changes take effect from tomorrow.</p>
        )}
      </form>
    </Modal>
  )
}
