// Shared server-side helpers: auth session, CharmHealth API, Gmail API.
// Nothing in this file is ever sent to the browser.
import crypto from 'node:crypto';

export const env = (k, d = '') => process.env[k] ?? d;

export const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });

/* ------------------------------------------------------------------ */
/* Session (HMAC-signed, HttpOnly cookie)                             */
/* ------------------------------------------------------------------ */
const SESSION_HOURS = 12;
const sign = (v) => crypto.createHmac('sha256', env('SESSION_SECRET')).update(v).digest('base64url');

export function sessionCookie() {
  const payload = Buffer.from(JSON.stringify({ exp: Date.now() + SESSION_HOURS * 3600e3 })).toString('base64url');
  return `pp_session=${payload}.${sign(payload)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_HOURS * 3600}`;
}
export const clearCookie = 'pp_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';

export function isAuthed(req) {
  if (!env('SESSION_SECRET')) return false;
  const m = (req.headers.get('cookie') || '').match(/(?:^|;\s*)pp_session=([^;]+)/);
  if (!m) return false;
  const [p, s] = m[1].split('.');
  if (!p || !s) return false;
  const expected = sign(p);
  if (s.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))) return false;
  try { return JSON.parse(Buffer.from(p, 'base64url').toString()).exp > Date.now(); } catch { return false; }
}

export function passwordOk(input) {
  const real = env('PANEL_PASSWORD');
  if (!real) return false;
  const a = crypto.createHash('sha256').update(String(input ?? '')).digest();
  const b = crypto.createHash('sha256').update(real).digest();
  return crypto.timingSafeEqual(a, b);
}

/* ------------------------------------------------------------------ */
/* Nurses — env NURSES: "Priya Sharma | priya@x.com ; Anjali | a@x.com" */
/* ------------------------------------------------------------------ */
export function nurses() {
  return env('NURSES')
    .split(/[;\n]/)
    .map((l) => l.split('|').map((s) => s.trim()))
    .filter(([name]) => name)
    .map(([name, email], id) => ({ id, name, email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email || '') ? email : '' }));
}

/* ------------------------------------------------------------------ */
/* CharmHealth                                                        */
/* ------------------------------------------------------------------ */
let charmCache = { token: null, exp: 0 };

async function charmToken(force = false) {
  if (!force && charmCache.token && Date.now() < charmCache.exp) return charmCache.token;
  const r = await fetch(env('CHARM_TOKEN_URL', 'https://accounts.charmtracker.com/oauth/v2/token'), {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: env('CHARM_REFRESH_TOKEN'),
      client_id: env('CHARM_CLIENT_ID'),
      client_secret: env('CHARM_CLIENT_SECRET'),
      grant_type: 'refresh_token',
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!body.access_token) throw new Error('CharmHealth login failed: ' + (body.error || `HTTP ${r.status}`));
  charmCache = { token: body.access_token, exp: Date.now() + Math.max(300, (body.expires_in || 3600) - 300) * 1000 };
  return charmCache.token;
}

export async function charmGet(path, query = {}, retry = true) {
  const url = new URL(env('CHARM_BASE').replace(/\/+$/, '') + '/' + path.replace(/^\/+/, ''));
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + (await charmToken()), api_key: env('CHARM_API_KEY'), Accept: 'application/json' },
  });
  if (r.status === 401 && retry) { charmCache.token = null; return charmGet(path, query, false); }
  const body = await r.json().catch(() => ({}));
  if (!r.ok || (body.code !== undefined && String(body.code) !== '0')) {
    throw new Error('CharmHealth: ' + (body.message || `HTTP ${r.status}`));
  }
  return body;
}

export function normPatient(p = {}) {
  const id = String(p.patient_id ?? p.id ?? '');
  const name = `${p.first_name || ''} ${p.last_name || ''}`.trim() || p.full_name || p.name || 'Unknown';
  const email = p.email || p.email_id || p.contact?.email || '';
  return { id, name, email, dob: p.dob || '' };
}

export const validEmail = (e) => /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(e || '');

// If search returns nothing on your account, the filter names differ — change them here.
export const SEARCH_FILTERS = ['first_name_startswith', 'last_name_startswith'];

export async function searchPatients(term) {
  const found = new Map();
  for (const f of SEARCH_FILTERS) {
    const body = await charmGet('patients', { [f]: term, facility_id: 'ALL', per_page: 25 });
    const list = body.patients ?? body.data?.patients ?? body.data ?? [];
    if (Array.isArray(list)) for (const p of list.map(normPatient)) if (p.id) found.set(p.id, p);
  }
  return [...found.values()];
}

export async function getPatient(id) {
  const body = await charmGet('patients/' + encodeURIComponent(id));
  return normPatient(body.patient ?? body.data?.patient ?? body.data ?? body);
}

/* ------------------------------------------------------------------ */
/* Gmail API (sends as the Google Workspace account)                  */
/* ------------------------------------------------------------------ */
let googleCache = { token: null, exp: 0 };

async function googleToken() {
  if (googleCache.token && Date.now() < googleCache.exp) return googleCache.token;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      refresh_token: env('GOOGLE_REFRESH_TOKEN'),
      grant_type: 'refresh_token',
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!body.access_token) throw new Error('Google login failed: ' + (body.error_description || body.error || `HTTP ${r.status}`));
  googleCache = { token: body.access_token, exp: Date.now() + Math.max(300, (body.expires_in || 3600) - 300) * 1000 };
  return googleCache.token;
}

export async function healthCheck() {
  const out = {};
  try { await charmToken(true); out.charm = 'ok'; } catch (e) { out.charm = e.message; }
  try { googleCache.token = null; await googleToken(); out.google = 'ok'; } catch (e) { out.google = e.message; }
  return out;
}

const clean = (s) => String(s ?? '').replace(/[\r\n]+/g, ' ').trim();
const encWord = (s) => (/^[\x20-\x7e]*$/.test(s) ? s : `=?UTF-8?B?${Buffer.from(s).toString('base64')}?=`);
const addr = (name, email) => `${encWord(clean(name).replace(/"/g, ''))} <${clean(email)}>`;
const wrap = (b64) => b64.replace(/.{1,76}/g, '$&\r\n');

export function buildMime({ fromName, fromEmail, to, replyTo, subject, html, attachments = [] }) {
  const boundary = 'pp_' + crypto.randomBytes(12).toString('hex');
  const lines = [
    `From: ${addr(fromName, fromEmail)}`,
    `To: ${clean(to)}`,
    ...(replyTo ? [`Reply-To: ${replyTo}`] : []),
    `Subject: ${encWord(clean(subject))}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrap(Buffer.from(html).toString('base64')),
  ];
  for (const a of attachments) {
    const fname = clean(a.name).replace(/["\\]/g, '');
    lines.push(
      `--${boundary}`,
      `Content-Type: ${clean(a.type) || 'application/octet-stream'}; name="${fname.replace(/[^\x20-\x7e]/g, '_')}"`,
      `Content-Disposition: attachment; filename="${fname.replace(/[^\x20-\x7e]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(fname)}`,
      'Content-Transfer-Encoding: base64',
      '',
      wrap(a.data),
    );
  }
  lines.push(`--${boundary}--`, '');
  return lines.join('\r\n');
}

export async function sendGmail(mime) {
  const r = await fetch('https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + (await googleToken()), 'content-type': 'message/rfc822' },
    body: mime,
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error('Gmail: ' + (body.error?.message || `HTTP ${r.status}`));
  return body.id;
}

export const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
