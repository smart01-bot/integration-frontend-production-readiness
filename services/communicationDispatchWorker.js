import { supabase } from '../config/supabase.js';
import textifySms from './textifySmsService.js';
import resendEmail from './resendEmailService.js';

const MAX_RETRIES = 3;

/**
 * Communication Dispatch Worker
 * Polls `communication_queue` for due (status='pending', scheduled_for <= now)
 * SMS/Email items and sends them via the configured provider. Failed sends
 * are retried up to MAX_RETRIES with the row marked 'retrying', then 'failed'.
 *
 * This is the scheduled-delivery mechanism for Schedule A9 — templates and
 * manual test sends already existed, but nothing previously drained the
 * queue on a schedule.
 */
export async function runCommunicationDispatchWorker() {
  try {
    const nowIso = new Date().toISOString();

    const { data: dueItems, error } = await supabase
      .from('communication_queue')
      .select('*')
      .in('status', ['pending', 'retrying'])
      .lte('scheduled_for', nowIso)
      .lt('retry_count', MAX_RETRIES)
      .order('scheduled_for', { ascending: true })
      .limit(50);

    if (error) {
      console.error('[Comm Dispatch Worker] Failed to query communication_queue:', error.message);
      return;
    }

    if (!dueItems || dueItems.length === 0) {
      return;
    }

    console.log(`[Comm Dispatch Worker] Dispatching ${dueItems.length} due communication(s)...`);

    for (const item of dueItems) {
      let result;

      if (item.channel === 'SMS') {
        result = await textifySms.sendSms({ to: item.recipient, message: item.message_body });
      } else if (item.channel === 'EMAIL') {
        result = await resendEmail.sendEmail({
          to: item.recipient,
          subject: item.subject || 'Tour de Rotary DSM 2026',
          html: item.message_body
        });
      } else {
        result = { success: false, status: 'FAILED', error: `Unknown channel: ${item.channel}` };
      }

      if (result.success) {
        await supabase
          .from('communication_queue')
          .update({ status: 'sent', sent_at: new Date().toISOString() })
          .eq('id', item.id);
      } else {
        const nextRetryCount = (item.retry_count || 0) + 1;
        const nextStatus = nextRetryCount >= MAX_RETRIES ? 'failed' : 'retrying';
        await supabase
          .from('communication_queue')
          .update({
            status: nextStatus,
            retry_count: nextRetryCount,
            last_error: result.error || result.warning || 'Unknown dispatch failure'
          })
          .eq('id', item.id);
      }
    }
  } catch (err) {
    console.error('[Comm Dispatch Worker] Exception:', err.message || err);
  }
}
