export type Slot = {
  slot_number: number
  pca_channel: number
  pill_name: string
  dosage_notes: string | null
  current_stock: number
  max_capacity: number
  low_stock_threshold: number
  remote_dispense_qty: number
  updated_at: string
}

export type Schedule = {
  id: string
  slot_number: number
  schedule_time: string // HH:MM:SS
  dose_qty: number
  days_of_week: number[] // 0=Sun ... 6=Sat
  is_active: boolean
  last_triggered_date: string | null
  created_at: string
}

export type ActionType = 'dispense_button' | 'dispense_schedule' | 'dispense_web' | 'refill'

export type DispenseLog = {
  id: number
  slot_number: number
  pill_name: string
  action_type: ActionType
  quantity: number
  remaining_stock: number
  created_at: string
}

export type ToastKind = 'success' | 'error' | 'info'
export type Notify = (message: string, kind?: ToastKind) => void

export const ACTION_LABELS: Record<ActionType, string> = {
  dispense_button: 'Manual',
  dispense_schedule: 'Scheduled',
  dispense_web: 'Remote',
  refill: 'Refill',
}

export function slotStatus(slot: Slot): 'empty' | 'low' | 'ok' {
  if (slot.current_stock <= 0) return 'empty'
  if (slot.current_stock <= slot.low_stock_threshold) return 'low'
  return 'ok'
}
