import { json, ensureDb, parisNow } from '../lib/util.js';
export async function onRequestGet({ env }) {
  await ensureDb(env);
  const r = await env.DB.prepare("SELECT num,status FROM orders WHERE day=? AND num IS NOT NULL AND status IN ('NOUVELLE','EN_PREPARATION','PRETE') ORDER BY num").bind(parisNow().day).all();
  const g = s => r.results.filter(x => s.includes(x.status)).map(x => x.num);
  return json({ ok: true, prep: g(['NOUVELLE', 'EN_PREPARATION']), ready: g(['PRETE']).slice(-12) });
}
