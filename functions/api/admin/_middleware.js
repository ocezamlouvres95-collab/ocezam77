import { json, isAdmin, ensureDb, rateHit, clientIp } from '../../lib/util.js';
export async function onRequest({ request, env, next }) {
  await ensureDb(env);
  if (!isAdmin(request, env)) {
    if (await rateHit(env, 'adm:' + clientIp(request), 600000, 15)) return json({ ok: false, error: 'Trop de tentatives, patientez quelques minutes.' }, 429);
    return json({ ok: false, error: 'Accès refusé' }, 401);
  }
  return next();
}
