import { supabase } from '../config/supabase.js';
import { sendSmsNotification } from '../services/textifySmsService.js';

export const getCommunicationTemplates = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('communication_templates')
      .select('*')
      .order('template_key', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ status: 'success', count: data.length, data });
  } catch (error) {
    console.error('getCommunicationTemplates exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve communication templates' });
  }
};

export const previewRenderedTemplate = async (req, res) => {
  try {
    const { template_key, variables = {} } = req.body;
    if (!template_key) return res.status(400).json({ error: 'template_key is required' });

    const { data: template, error } = await supabase
      .from('communication_templates')
      .select('*')
      .eq('template_key', template_key)
      .maybeSingle();

    if (error) return res.status(500).json({ error: error.message });
    if (!template) return res.status(404).json({ error: `Template with key '${template_key}' not found` });

    let renderedBody = template.body_template;
    let renderedSubject = template.subject || '';
    for (const [key, val] of Object.entries(variables)) {
      const regex = new RegExp(`{{${key}}}`, 'g');
      renderedBody = renderedBody.replace(regex, String(val));
      renderedSubject = renderedSubject.replace(regex, String(val));
    }

    return res.status(200).json({
      status: 'success', template_key, channel: template.channel,
      rendered_subject: renderedSubject || undefined,
      rendered_body: renderedBody, variables_applied: variables
    });
  } catch (error) {
    console.error('previewRenderedTemplate exception:', error);
    return res.status(500).json({ error: 'Failed to render template preview' });
  }
};

export const sendTestCommunication = async (req, res) => {
  try {
    const { channel = 'SMS', recipient, message } = req.body;
    if (!recipient) return res.status(400).json({ error: 'Recipient phone number or email is required' });

    const textMessage = message || `[Tour de Rotary DSM 2026] Test dispatch to ${recipient}`;
    if (channel.toUpperCase() === 'SMS') {
      const result = await sendSmsNotification(recipient, textMessage);
      await supabase.from('audit_logs').insert([{
        action: 'COMMUNICATION_SMS_DISPATCH', target_resource: recipient,
        details_json: { status: result?.status || 'dispatched' }, actor_role: 'admin'
      }]);
      return res.status(200).json({ status: 'success', channel: 'SMS', provider: 'Textify Africa', recipient, result });
    }

    await supabase.from('audit_logs').insert([{
      action: 'COMMUNICATION_EMAIL_DISPATCH', target_resource: recipient,
      details_json: { channel: 'EMAIL' }, actor_role: 'admin'
    }]);
    return res.status(200).json({ status: 'success', channel: 'EMAIL', provider: 'Resend', recipient, message: `Email dispatch queued for ${recipient}` });
  } catch (error) {
    console.error('sendTestCommunication exception:', error);
    return res.status(500).json({ error: 'Failed to send test communication' });
  }
};

export const getCommunicationLogs = async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('audit_logs').select('*').ilike('action', '%COMMUNICATION%')
      .order('created_at', { ascending: false }).limit(50);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ status: 'success', count: data.length, data });
  } catch (error) {
    console.error('getCommunicationLogs exception:', error);
    return res.status(500).json({ error: 'Failed to retrieve communication logs' });
  }
};
