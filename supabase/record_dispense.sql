-- Run once in Supabase SQL Editor (required by the new ESP32 firmware).
-- Atomically subtracts stock and writes the log, so a web refill can never be
-- overwritten by the ESP32 sending an old stock number.
CREATE OR REPLACE FUNCTION public.record_dispense(p_slot INT, p_qty INT, p_action TEXT)
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_stock INT;
  v_pill_name TEXT;
BEGIN
  IF p_action NOT IN ('dispense_button', 'dispense_schedule', 'dispense_web') THEN
    RAISE EXCEPTION 'Invalid action_type: %', p_action;
  END IF;

  UPDATE public.dispenser_slots
  SET current_stock = GREATEST(0, current_stock - p_qty),
      updated_at = NOW()
  WHERE slot_number = p_slot
  RETURNING current_stock, pill_name INTO v_new_stock, v_pill_name;

  INSERT INTO public.dispense_logs (slot_number, pill_name, action_type, quantity, remaining_stock)
  VALUES (p_slot, v_pill_name, p_action, -p_qty, v_new_stock);

  RETURN v_new_stock;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_dispense(INT, INT, TEXT) TO anon, authenticated;
