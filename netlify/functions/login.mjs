import { json, passwordOk, sessionCookie, clearCookie } from '../lib/core.mjs';

export default async (req) => {
  if (req.method === 'DELETE') return json({ ok: true }, 200, { 'set-cookie': clearCookie });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const { password } = await req.json().catch(() => ({}));
  if (!passwordOk(password)) {
    await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
    return json({ error: 'Wrong password.' }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': sessionCookie() });
};

export const config = { path: '/api/login' };
