import { json, isAuthed, nurses, healthCheck } from '../lib/core.mjs';

export default async (req) => {
  if (!isAuthed(req)) return json({ authed: false });
  const url = new URL(req.url);
  const res = { authed: true, nurses: nurses().map(({ id, name }) => ({ id, name })) };
  if (url.searchParams.has('health')) res.health = await healthCheck();
  return json(res);
};

export const config = { path: '/api/me' };
