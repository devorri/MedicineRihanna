# PillBox — Smart Medicine Dispenser (Web)

React + Vite + TypeScript dashboard for the ESP32 / PCA9685 4-slot pill dispenser, backed by Supabase.

## Features
- **Dashboard** – 4 slot cards (stock bar, low/empty alerts, next dose), remote **Dispense** (sets `remote_dispense_qty`; ESP32 picks it up within ~5s), **Refill** (`refill_slot` RPC, capped at max capacity), edit medicine name / notes / capacity / low-stock threshold.
- **Missed-dose alert** – schedules whose time passed today without the ESP32 triggering them, with a "Dispense now" button.
- **Schedules** – add / edit / pause / delete, day-of-week picker, duplicate & low-stock warnings. All times are Philippine time, matching the ESP32's NTP clock.
- **History** – filter logs by slot, action and date range, totals, CSV export.
- **Realtime** – live updates via Supabase Realtime, falls back to 5s polling.

## Setup
1. `npm install`
2. Copy `.env.example` to `.env` and fill in your Supabase URL + anon key (already filled in this copy).
3. In Supabase SQL Editor, run `supabase/realtime.sql` (optional, enables instant updates).
4. `npm run dev` → open the shown URL.

Build for hosting: `npm run build` → upload `dist/` (Vercel / Netlify / GitHub Pages).
