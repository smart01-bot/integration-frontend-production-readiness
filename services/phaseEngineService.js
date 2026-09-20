import { supabase } from '../config/supabase.js';

/**
 * Phase Engine (proposal §03 "Phase-aware site behaviour" / journey O)
 *
 * The latest event edition's phase is derived from its configured
 * event_date and persisted to event_editions.current_phase whenever it
 * changes. The frontend (which reads Supabase directly) and every
 * phase-aware backend endpoint then pick up the right experience
 * automatically — pre-event, event_day, post_event — without a code
 * change or manual console action. HQ can still override the phase via
 * PATCH /api/v1/admin/events/phase; the engine simply corrects it as
 * the schedule passes.
 *
 * Phase window: event_day starts at flag-off (event_date) and lasts 24h
 * (configurable per edition via config_json.event_day_duration_hours).
 */
export async function runPhaseEngine() {
  try {
    const { data: edition, error } = await supabase
      .from('event_editions')
      .select('id, year, title, event_date, current_phase, config_json')
      .order('year', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) {
      console.error('[Phase Engine] Failed to read event edition:', error.message);
      return;
    }
    if (!edition?.event_date) {
      return; // No scheduled edition yet — nothing to drive.
    }

    const now = Date.now();
    const flagOff = new Date(edition.event_date).getTime();
    const durationHours = edition.config_json?.event_day_duration_hours || 24;
    const eventDayEnd = flagOff + durationHours * 60 * 60 * 1000;
    // §17 ARCHIVE: after event_day ends, the platform stays in post_event
    // (MEMORY) for a configurable window, then becomes a read-only archive.
    // Default: 30 days after flag-off (config_json.archive_after_days).
    const archiveAfterDays = edition.config_json?.archive_after_days ?? 30;
    const archiveAt = eventDayEnd + archiveAfterDays * 24 * 60 * 60 * 1000;

    // 'archive' is a valid event_config/event_lifecycle state (001/017 CHECKs)
    // but NOT a valid event_editions.current_phase (001 CHECK). The edition
    // therefore caps at post_event while config/lifecycle go to archive.
    const derivedPhase =
      now < flagOff ? 'pre_event'
      : now < eventDayEnd ? 'event_day'
      : 'post_event';
    const derivedConfigPhase = now >= archiveAt ? 'archive' : derivedPhase;

    // ── Reconcile drift EVERY cycle (audit gaps 17/23/24/28) ────────────────
    // The original engine only wrote event_config on transitions, so any
    // manual edit to event_config or event_lifecycle (e.g. someone setting
    // archive then flipping lifecycle back to live) stayed contradictory
    // forever: config=archive while lifecycle=live. We now compare the
    // desired derived phase against BOTH satellite tables each cycle and
    // correct them in place.
    //
    // Reconcile policy for event_lifecycle.current_mode (avoid fighting the
    // 002 bidirectional triggers and legitimate admin overrides):
    //  - desiredMode is archive once the archive window passes (gap 24).
    //  - memory/archive BEFORE flag-off is drift and reverts to live.
    //  - live AFTER the archive window is drift and reverts to archive.
    //  - memory during post_event is a legitimate admin choice — preserved.
    const desiredMode =
      now >= archiveAt ? 'archive'
      : derivedPhase === 'post_event' ? 'memory'
      : 'live';

    const [configRes, lifecycleRes] = await Promise.all([
      supabase.from('event_config').select('phase').eq('id', 1).maybeSingle(),
      supabase.from('event_lifecycle').select('current_mode, archive_date, memory_mode_unlocked_at').limit(1).maybeSingle()
    ]);

    // Event-config reconcile: archive is a valid config phase; the edition
    // row caps at post_event so its CHECK is respected (gap 24).
    if (configRes.data && configRes.data.phase !== derivedConfigPhase) {
      const { error: cfgErr } = await supabase
        .from('event_config')
        .update({ phase: derivedConfigPhase, updated_at: new Date().toISOString() })
        .eq('id', 1);
      if (cfgErr) {
        console.error('[Phase Engine] Reconcile event_config failed:', cfgErr.message);
      } else {
        console.log(`[Phase Engine] Reconciled event_config.phase ${configRes.data.phase} -> ${derivedConfigPhase}`);
        await supabase.from('audit_logs').insert([{
          action: 'PHASE_ENGINE_RECONCILE',
          target_resource: 'event_config:1',
          details_json: { from_phase: configRes.data.phase, to_phase: derivedConfigPhase, derived_from: 'event_date' },
          actor_role: 'system'
        }]);
      }
    }

    // Lifecycle reconcile (gaps 24 + 28). Two drift shapes:
    //  1. memory/archive BEFORE flag-off — reverts to live.
    //  2. live AFTER the archive window — advances to archive (§17's third
    //     act finally reachable without manual SQL).
    // memory during post_event (legitimate admin override) is preserved.
    const mode = lifecycleRes.data?.current_mode;
    const preEventDrift = mode && mode !== 'live' && derivedPhase === 'pre_event';
    const archiveDue = mode && mode !== 'archive' && now >= archiveAt;
    if (preEventDrift || archiveDue) {
      const targetMode = archiveDue ? 'archive' : 'live';
      const { error: lcErr, data: lcData } = await supabase
        .from('event_lifecycle')
        .update({
          current_mode: targetMode,
          updated_at: new Date().toISOString(),
          // Gap 28: clear contradictory metadata when reverting to live.
          ...(targetMode === 'live' ? { archive_date: null, memory_mode_unlocked_at: null } : {}),
          ...(targetMode === 'archive' ? { archive_date: new Date().toISOString() } : {})
        })
        .neq('current_mode', targetMode)
        .select();
      if (lcErr) {
        console.error('[Phase Engine] Reconcile event_lifecycle failed:', lcErr.message);
      } else if ((lcData || []).length > 0) {
        const reason = archiveDue
          ? `archive window (${archiveAfterDays}d) elapsed`
          : 'archive/memory before flag-off is drift';
        console.log(`[Phase Engine] Reconciled event_lifecycle mode ${mode} -> ${targetMode} (${reason})`);
        await supabase.from('audit_logs').insert([{
          action: 'PHASE_ENGINE_RECONCILE',
          target_resource: 'event_lifecycle',
          details_json: { from_mode: mode, to_mode: targetMode, reason },
          actor_role: 'system'
        }]);
      }
    } else if (mode === 'live' && (lifecycleRes.data?.archive_date || lifecycleRes.data?.memory_mode_unlocked_at)) {
      // Gap 28 (metadata-only drift): mode is live but stale archive/memory
      // timestamps from an earlier incident remain. Clear them — the state
      // itself is correct, the metadata contradicts it.
      const { error: metaErr } = await supabase
        .from('event_lifecycle')
        .update({ archive_date: null, memory_mode_unlocked_at: null, updated_at: new Date().toISOString() })
        .eq('current_mode', 'live');
      if (metaErr) console.error('[Phase Engine] Metadata cleanup failed:', metaErr.message);
      console.log('[Phase Engine] Cleared stale lifecycle metadata (live mode with archive/memory timestamps)');
    }

    if (derivedPhase !== edition.current_phase) {
      const { error: updateErr } = await supabase
        .from('event_editions')
        .update({ current_phase: derivedPhase, updated_at: new Date().toISOString() })
        .eq('id', edition.id);

      if (updateErr) {
        console.error('[Phase Engine] Failed to update phase:', updateErr.message);
        return;
      }

      // event_editions.current_phase is what this backend's own controllers
      // (cartController, campaignController, contentController,
      // volunteerController) gate on. event_config.phase is a SEPARATE row
      // in a separate table, and it's the ONLY thing the frontend
      // (tourderotary-dsm) ever reads for phase-aware behaviour — see
      // src/lib/phase.ts. Without this second write, this whole engine
      // could run forever and never change what a visitor actually sees.
      const { error: configErr } = await supabase
        .from('event_config')
        .update({ phase: derivedPhase, updated_at: new Date().toISOString() })
        .eq('id', 1);

      if (configErr) {
        console.error('[Phase Engine] Failed to sync event_config for frontend:', configErr.message);
      }

      console.log(`[Phase Engine] Edition ${edition.year} phase ${edition.current_phase} -> ${derivedPhase}`);

      await supabase.from('audit_logs').insert([{
        action: 'PHASE_ENGINE_TRANSITION',
        target_resource: `event_editions:${edition.id}`,
        details_json: { from_phase: edition.current_phase, to_phase: derivedPhase, derived_from: 'event_date' },
        actor_role: 'system'
      }]);
    }
  } catch (err) {
    console.error('[Phase Engine] Exception:', err.message || err);
  }
}
