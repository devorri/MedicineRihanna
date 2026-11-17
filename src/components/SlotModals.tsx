import { useState, type FormEvent } from 'react'
import { supabase } from '../lib/supabase'
import type { Notify, Slot } from '../types'
import { Modal } from './Modal'

type Props = { slot: Slot; onClose: () => void; notify: Notify; onDone: () => void }

export function EditSlotModal({ slot, onClose, notify, onDone }: Props) {
  const [pillName, setPillName] = useState(slot.pill_name)
  const [notes, setNotes] = useState(slot.dosage_notes ?? '')
  const [maxCap, setMaxCap] = useState(slot.max_capacity)
  const [threshold, setThreshold] = useState(slot.low_stock_threshold)
  const [saving, setSaving] = useState(false)

  const invalid =
    !pillName.trim() || maxCap < 1 || maxCap < slot.current_stock || threshold < 0 || threshold > maxCap

  async function save(e: FormEvent) {
    e.preventDefault()
    if (invalid) return
    setSaving(true)
    const { error } = await supabase
      .from('dispenser_slots')
      .update({
        pill_name: pillName.trim(),
        dosage_notes: notes.trim(),
        max_capacity: maxCap,
        low_stock_threshold: threshold,
        updated_at: new Date().toISOString(),
      })
      .eq('slot_number', slot.slot_number)
    setSaving(false)
    if (error) return notify(error.message, 'error')
    notify(`Slot ${slot.slot_number} updated`)
    onDone()
    onClose()
  }

  return (
    <Modal
      title={`Edit Slot ${slot.slot_number}`}
      subtitle={`PCA9685 channel ${slot.pca_channel}`}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="edit-slot" disabled={invalid || saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </>
      }
    >
      <form id="edit-slot" className="form" onSubmit={save}>
        <label>
          Medicine name
          <input value={pillName} onChange={(e) => setPillName(e.target.value)} maxLength={60} required />
          <small className="muted">Shown on the dispenser's LCD (first 16 characters).</small>
        </label>
        <label>
          Dosage notes
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="e.g. Take after meals" />
        </label>
        <div className="row-2">
          <label>
            Max capacity
            <input type="number" min={Math.max(1, slot.current_stock)} value={maxCap} onChange={(e) => setMaxCap(Number(e.target.value))} />
          </label>
          <label>
            Low-stock alert at
            <input type="number" min={0} max={maxCap} value={threshold} onChange={(e) => setThreshold(Number(e.target.value))} />
          </label>
        </div>
        {maxCap < slot.current_stock && (
          <p className="field-error">Capacity can't be lower than current stock ({slot.current_stock}).</p>
        )}
      </form>
    </Modal>
  )
}

export function RefillModal({ slot, onClose, notify, onDone }: Props) {
  const room = Math.max(0, slot.max_capacity - slot.current_stock)
  const [qty, setQty] = useState(room)
  const [saving, setSaving] = useState(false)
  const valid = qty >= 1 && qty <= room

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!valid) return
    setSaving(true)
    const { error } = await supabase.rpc('refill_slot', { p_slot: slot.slot_number, p_add_qty: qty })
    setSaving(false)
    if (error) return notify(error.message, 'error')
    notify(`Added ${qty} to ${slot.pill_name}`)
    onDone()
    onClose()
  }

  return (
    <Modal
      title={`Refill Slot ${slot.slot_number}`}
      subtitle={slot.pill_name}
      onClose={onClose}
      footer={
        <>
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" form="refill-slot" disabled={!valid || saving}>
            {saving ? 'Saving…' : `Add ${qty || 0} pills`}
          </button>
        </>
      }
    >
      {room === 0 ? (
        <p>This slot is already full ({slot.current_stock}/{slot.max_capacity}).</p>
      ) : (
        <form id="refill-slot" className="form" onSubmit={save}>
          <div className="refill-summary">
            <div><span className="muted">Current</span><strong>{slot.current_stock}</strong></div>
            <div className="arrow">→</div>
            <div><span className="muted">After refill</span><strong>{slot.current_stock + (valid ? qty : 0)}</strong></div>
            <div><span className="muted">Capacity</span><strong>{slot.max_capacity}</strong></div>
          </div>
          <label>
            Pills to add
            <input type="number" min={1} max={room} value={qty} onChange={(e) => setQty(Number(e.target.value))} autoFocus />
          </label>
          <div className="chips">
            {[5, 10, 20].filter((n) => n < room).map((n) => (
              <button type="button" key={n} className="chip" onClick={() => setQty(n)}>+{n}</button>
            ))}
            <button type="button" className="chip" onClick={() => setQty(room)}>Fill to max (+{room})</button>
          </div>
          {!valid && <p className="field-error">Enter 1 to {room}.</p>}
        </form>
      )}
    </Modal>
  )
}
