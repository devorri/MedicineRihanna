-- Run once in Supabase SQL Editor so the website updates instantly (no 5s polling)
-- when the ESP32 dispenses, refills happen, or schedules change.
ALTER PUBLICATION supabase_realtime ADD TABLE public.dispenser_slots, public.pill_schedules, public.dispense_logs;
