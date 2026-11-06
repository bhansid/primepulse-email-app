// Sends ONE email to ONE patient. The browser calls this once per selected
// patient, so each patient gets a private email and no request runs long.
import {
  json, isAuthed, env, nurses, getPatient, validEmail, buildMime, sendGmail, escapeHtml,
} from '../lib/core.mjs';

const ALLOWED = ['pdf', 'jpg', 'jpeg', 'png', 'doc', 'docx', 'xls', 'xlsx', 'txt'];
const MAX_TOTAL_BYTES = 4 * 1024 * 1024; // Netlify request limit is 6 MB incl. base64 overhead

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);
  if (!isAuthed(req)) return json({ error: 'Please log in again.' }, 401);

  const b = await req.json().catch(() => null);
  if (!b) return json({ error: 'Bad request.' }, 400);

  const nurse = nurses().find((n) => n.id === Number(b.nurseId));
  const subject = String(b.subject || '').trim().slice(0, 200);
  const message = String(b.message || '').trim().slice(0, 20000);
  const patientId = String(b.patientId || '').trim();
  const attachments = Array.isArray(b.attachments) ? b.attachments.slice(0, 10) : [];

  if (!nurse) return json({ error: 'Select a nurse.' }, 400);
  if (!patientId) return json({ error: 'No patient selected.' }, 400);
  if (!subject || !message) return json({ error: 'Subject and message are required.' }, 400);

  let total = 0;
  for (const a of attachments) {
    const ext = String(a.name || '').split('.').pop().toLowerCase();
    if (!ALLOWED.includes(ext)) return json({ error: `File type not allowed: ${a.name}` }, 400);
    if (typeof a.data !== 'string' || !/^[A-Za-z0-9+/=]*$/.test(a.data)) return json({ error: `Bad file: ${a.name}` }, 400);
    total += Math.floor((a.data.length * 3) / 4);
  }
  if (total > MAX_TOTAL_BYTES) return json({ error: 'Attachments are over 4 MB in total.' }, 400);

  try {
    // Recipient is always looked up server-side from CharmHealth.
    const p = await getPatient(patientId);
    if (!validEmail(p.email)) return json({ error: `${p.name} has no valid email on file.` }, 400);

    const first = p.name.split(' ')[0] || 'there';
    const fill = (s) => s.replaceAll('{name}', first);
    const bodyHtml = escapeHtml(fill(message))
      .split(/\n{2,}/)
      .map((para) => `<p style="margin:0 0 14px">${para.replace(/\n/g, '<br>')}</p>`)
      .join('');
    const fromName = env('SENDER_NAME', 'PrimePulse Care Team');

    const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#1f2937;max-width:600px">
${bodyHtml}
<p style="margin:24px 0 0">${escapeHtml(nurse.name)}<br><span style="color:#6b7280">${escapeHtml(fromName)}</span></p>
</div>`;

    const mime = buildMime({
      fromName,
      fromEmail: env('SENDER_EMAIL'),
      to: p.email,
      replyTo: nurse.email ? `${nurse.name.replace(/[^\x20-\x7e]|"/g, '')} <${nurse.email}>` : '',
      subject: fill(subject),
      html,
      attachments,
    });
    await sendGmail(mime);

    console.log(JSON.stringify({ event: 'sent', at: new Date().toISOString(), nurse: nurse.name, patientId }));
    return json({ ok: true, name: p.name });
  } catch (e) {
    console.log(JSON.stringify({ event: 'failed', at: new Date().toISOString(), nurse: nurse.name, patientId, error: e.message }));
    return json({ error: e.message }, 502);
  }
};

export const config = { path: '/api/send' };
