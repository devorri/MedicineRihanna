import { createClient } from '@supabase/supabase-js'

// Values from .env take priority; falls back to the project's public anon key (same one the ESP32 uses).
const url =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? 'https://vtnxediirkonmxgtpzgx.supabase.co'
const key =
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InZ0bnhlZGlpcmtvbm14Z3Rwemd4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTQ4NTM4NjYsImV4cCI6MjExMDQyOTg2Nn0.WIC-6lcLTkYcgoOzTQajylX_EVUigk7EI-sMrqvIydU'

export const supabase = createClient(url, key)

/**
 * Ask the ESP32 to dispense. The ESP32 polls every 5s, sees remote_dispense_qty > 0,
 * dispenses, then resets it to 0 and logs it as 'dispense_web'.
 * The .eq('remote_dispense_qty', 0) guard stops us overwriting a request that's still pending.
 */
export async function requestDispense(slotNumber: number, qty: number): Promise<'ok' | 'busy'> {
  const { data, error } = await supabase
    .from('dispenser_slots')
    .update({ remote_dispense_qty: qty, updated_at: new Date().toISOString() })
    .eq('slot_number', slotNumber)
    .eq('remote_dispense_qty', 0)
    .select('slot_number')
  if (error) throw error
  return data && data.length > 0 ? 'ok' : 'busy'
}

export async function cancelDispense(slotNumber: number) {
  const { error } = await supabase
    .from('dispenser_slots')
    .update({ remote_dispense_qty: 0 })
    .eq('slot_number', slotNumber)
  if (error) throw error
}

/** Queue 1 pill from every slot that has stock and no pending request. The ESP32 dispenses them one slot at a time. */
export async function requestDispenseAll(): Promise<number[]> {
  const { data, error } = await supabase
    .from('dispenser_slots')
    .update({ remote_dispense_qty: 1, updated_at: new Date().toISOString() })
    .eq('remote_dispense_qty', 0)
    .gt('current_stock', 0)
    .select('slot_number')
  if (error) throw error
  return (data ?? []).map((r) => r.slot_number as number)
}
