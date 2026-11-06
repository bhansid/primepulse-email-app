import { json, passwordOk, makeToken, sessionCookie, clearCookie } from '../lib/core.mjs';

export default async (req) => {
  if (req.method === 'DELETE') return json({ ok: true }, 200, { 'set-cookie': clearCookie });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  if (!process.env.PANEL_PASSWORD || !process.env.SESSION_SECRET) {
    return json({ error: 'Server setup incomplete: PANEL_PASSWORD or SESSION_SECRET is not set in Netlify. Add it, then redeploy.' }, 500);
  }
  const { password } = await req.json().catch(() => ({}));
  if (!passwordOk(String(password ?? '').trim())) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return json({ error: 'Wrong password.' }, 401);
  }
  const token = makeToken();
  return json({ ok: true, token }, 200, { 'set-cookie': sessionCookie(token) });
};

export const config = { path: '/api/login' };
