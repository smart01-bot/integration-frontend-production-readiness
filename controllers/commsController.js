import { supabase } from '../config/supabase.js';
import textifySms from '../services/textifySmsService.js';
import resendEmail from '../services/resendEmailService.js';

/**
 * Comms Controller — immediate SMS/email send, matching the frontend's
 * flat contract (src/lib/api.ts: smsApi.send / emailApi.send).
 *
 * This is deliberately separate from /api/v1/communications/send-test
 * (which is a template-preview/testing tool). This is a real send. Access
 * is admin-only — an arbitrary logged-in participant must never be able to
 * send SMS/email to arbitrary recipients through this API.
 */
export const sendSms = async (req, res) => {
  try {
    const { to, message, templateId, variables } = req.body;

    if (!to || (!message && !templateId)) {
      return res.status(400).json({ error: 'to, and either message or templateId, are required' });
    }

    let finalMessage = message;

    if (templateId) {
      const { data: template } = await supabase
        .from('communication_templates')
        .select('body_template')
        .eq('template_key', templateId)
        .eq('channel', 'SMS')
        .maybeSingle();

      if (!template) {
        return res.status(404).json({ error: `SMS template not found: ${templateId}` });
      }

      finalMessage = template.body_template;
      if (variables) {
        for (const [key, value] of Object.entries(variables)) {
          finalMessage = finalMessage.replaceAll(`{{${key}}}`, value);
        }
      }
    }

    const recipients = Array.isArray(to) ? to : [to];
    const results = [];
    for (const recipient of recipients) {
      const result = await textifySms.sendSms({ to: recipient, message: finalMessage });
      results.push({ recipient, ...result });
    }

    const anyFailed = results.some(r => !r.success);
    if (anyFailed && results.every(r => !r.success)) {
      return res.status(502).json({ error: 'SMS dispatch failed', details: results });
    }

    const messageId = `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return res.status(200).json({ messageId });
  } catch (error) {
    console.error('sendSms exception:', error);
    return res.status(500).json({ error: 'Failed to send SMS' });
  }
};

export const sendEmail = async (req, res) => {
  try {
    const { to, templateId, variables = {} } = req.body;

    if (!to || !templateId) {
      return res.status(400).json({ error: 'to and templateId are required' });
    }

    const { data: template } = await supabase
      .from('communication_templates')
      .select('subject, body_template')
      .eq('template_key', templateId)
      .eq('channel', 'EMAIL')
      .maybeSingle();

    if (!template) {
      return res.status(404).json({ error: `Email template not found: ${templateId}` });
    }

    let subject = template.subject || 'Tour de Rotary DSM 2026';
    let html = template.body_template;
    for (const [key, value] of Object.entries(variables)) {
      subject = subject.replaceAll(`{{${key}}}`, value);
      html = html.replaceAll(`{{${key}}}`, value);
    }

    const recipients = Array.isArray(to) ? to : [to];
    const results = [];
    for (const recipient of recipients) {
      const result = await resendEmail.sendEmail({ to: recipient, subject, html });
      results.push({ recipient, ...result });
    }

    const anyFailed = results.some(r => !r.success);
    if (anyFailed && results.every(r => !r.success)) {
      return res.status(502).json({ error: 'Email dispatch failed', details: results });
    }

    const emailId = `email_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    return res.status(200).json({ emailId });
  } catch (error) {
    console.error('sendEmail exception:', error);
    return res.status(500).json({ error: 'Failed to send email' });
  }
};
