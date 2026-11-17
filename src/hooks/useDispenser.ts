import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import type { DispenseLog, Schedule, Slot } from '../types'

export function useDispenser() {
  const [slots, setSlots] = useState<Slot[]>([])
  const [schedules, setSchedules] = useState<Schedule[]>([])
  const [logs, setLogs] = useState<DispenseLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [live, setLive] = useState(false)
  const [logsVersion, setLogsVersion] = useState(0)
  const liveRef = useRef(false)
  const pendingRef = useRef(false)

  const loadSlots = useCallback(async () => {
    const { data, error } = await supabase.from('dispenser_slots').select('*').order('slot_number')
    if (error) return setError(error.message)
    setError(null)
    const rows = (data ?? []) as Slot[]
    pendingRef.current = rows.some((r) => r.remote_dispense_qty > 0)
    setSlots(rows)
  }, [])

  const loadSchedules = useCallback(async () => {
    const { data, error } = await supabase.from('pill_schedules').select('*').order('schedule_time')
    if (error) return setError(error.message)
    setSchedules((data ?? []) as Schedule[])
  }, [])

  const loadLogs = useCallback(async () => {
    const { data, error } = await supabase
      .from('dispense_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return setError(error.message)
    setLogs((data ?? []) as DispenseLog[])
  }, [])

  const refresh = useCallback(async () => {
    await Promise.all([loadSlots(), loadSchedules(), loadLogs()])
  }, [loadSlots, loadSchedules, loadLogs])

  useEffect(() => {
    // Initial fetch from Supabase (external system) — intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh().finally(() => setLoading(false))

    const channel = supabase
      .channel('pillbox-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispenser_slots' }, () => loadSlots())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'pill_schedules' }, () => loadSchedules())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'dispense_logs' }, () => {
        loadLogs()
        setLogsVersion((v) => v + 1)
      })
      .subscribe((status) => {
        liveRef.current = status === 'SUBSCRIBED'
        setLive(liveRef.current)
      })

    // Always poll (Realtime only works if supabase/realtime.sql was run).
    // Poll faster while a dispense request is waiting so the card clears as soon as the ESP32 is done.
    let timer: ReturnType<typeof setTimeout>
    const tick = () => {
      timer = setTimeout(
        async () => {
          await refresh()
          setLogsVersion((v) => v + 1)
          tick()
        },
        pendingRef.current ? 3000 : 15000,
      )
    }
    tick()

    return () => {
      clearTimeout(timer)
      supabase.removeChannel(channel)
    }
  }, [refresh, loadSlots, loadSchedules, loadLogs])

  return { slots, schedules, logs, loading, error, live, logsVersion, refresh }
}
