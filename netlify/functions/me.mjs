import { json, isAuthed, nurses, healthCheck } from '../lib/core.mjs';

export default async (req) => {
  if (!isAuthed(req)) {
    // Names only (never values) so setup problems are easy to spot.
    const required = ['PANEL_PASSWORD', 'SESSION_SECRET', 'NURSES', 'CHARM_BASE', 'CHARM_API_KEY', 'CHARM_CLIENT_ID',
      'CHARM_CLIENT_SECRET', 'CHARM_REFRESH_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN', 'SENDER_EMAIL'];
    return json({ authed: false, missingSettings: required.filter((k) => !process.env[k]) });
  }
  const url = new URL(req.url);
  const res = { authed: true, nurses: nurses().map(({ id, name }) => ({ id, name })) };
  if (url.searchParams.has('health')) res.health = await healthCheck();
  return json(res);
};

export const config = { path: '/api/me' };
