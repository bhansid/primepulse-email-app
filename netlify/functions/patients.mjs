import { json, isAuthed, searchPatients, validEmail } from '../lib/core.mjs';

export default async (req) => {
  if (!isAuthed(req)) return json({ error: 'Please log in again.' }, 401);
  const q = (new URL(req.url).searchParams.get('q') || '').trim();
  if (q.length < 2) return json({ patients: [] });

  try {
    const list = await searchPatients(q);
    return json({
      patients: list.slice(0, 30).map((p) => ({
        id: p.id,
        name: p.name,
        dob: p.dob,
        hasEmail: validEmail(p.email),
        email: p.email ? p.email.replace(/^(.).*(@.*)$/, '$1***$2') : '', // masked
      })),
    });
  } catch (e) {
    return json({ error: e.message }, 502);
  }
};

export const config = { path: '/api/patients' };
