-- ==============================================================================
-- 019: FIX PHASE SYNC TRIGGERS & SAFEUPDATE COMPLIANCE
-- ==============================================================================

-- 1. Ensure event_config constraint permits 'archive' alongside pre_event, event_day, post_event
ALTER TABLE public.event_config DROP CONSTRAINT IF EXISTS event_config_phase_check;
ALTER TABLE public.event_config ADD CONSTRAINT event_config_phase_check
  CHECK (phase IN ('pre_event', 'event_day', 'post_event', 'archive'));

-- 2. Fix sync_phase_from_event_config to include WHERE clause and break recursion
CREATE OR REPLACE FUNCTION public.sync_phase_from_event_config()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_mode TEXT;
BEGIN
  target_mode := CASE NEW.phase WHEN 'archive' THEN 'archive' WHEN 'post_event' THEN 'memory' ELSE 'live' END;

  UPDATE public.event_lifecycle SET
    current_mode = target_mode,
    updated_at = NOW()
  WHERE current_mode IS DISTINCT FROM target_mode;

  RETURN NEW;
END;
$$;

-- 2. Fix sync_phase_from_event_lifecycle to prevent infinite trigger recursion
CREATE OR REPLACE FUNCTION public.sync_phase_from_event_lifecycle()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target_phase TEXT;
BEGIN
  target_phase := CASE NEW.current_mode WHEN 'archive' THEN 'archive' WHEN 'memory' THEN 'post_event' ELSE
    (SELECT phase FROM public.event_config WHERE id = 1) END;

  UPDATE public.event_config SET
    phase = target_phase,
    updated_at = NOW()
  WHERE id = 1 AND phase IS DISTINCT FROM target_phase;

  RETURN NEW;
END;
$$;
