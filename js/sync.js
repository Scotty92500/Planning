// Synchronisation PC ↔ téléphone via un Gist GitHub privé (gratuit, sans serveur)
// Le jeton reste sur l'appareil (il n'est jamais mis dans les données synchronisées).
import { state, subscribe, mergeStates, applyRemote, mutate, COLLS } from './store.js';

const CFG_KEY = 'mon-planning-sync';
const FILE = 'mon-planning.json';
const API = 'https://api.github.com';
const listeners = new Set();
let cfg = null;
let status = { state: 'off', at: 0, msg: '' };
let running = false, again = false, timer = null;

try { cfg = JSON.parse(localStorage.getItem(CFG_KEY) || 'null'); } catch (e) { cfg = null; }
const saveCfg = () => { try { cfg ? localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) : localStorage.removeItem(CFG_KEY); } catch (e) { /* */ } };

export const syncConfigured = () => !!(cfg && cfg.token && cfg.gistId);
export const syncStatus = () => status;
export const onSyncStatus = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
function setStatus(st, msg = '') { status = { state: st, at: st === 'ok' ? Date.now() : status.at, msg }; listeners.forEach((f) => f(status)); }

async function gh(path, opts = {}, token = cfg && cfg.token) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  });
  if (res.status === 401) throw new Error('Jeton refusé par GitHub (expiré ou mal copié).');
  if (res.status === 403 || res.status === 404) throw new Error('Accès refusé : le jeton doit avoir la permission « gist ».');
  if (!res.ok) throw new Error(`GitHub a répondu ${res.status}.`);
  return res.status === 204 ? null : res.json();
}

async function readGist(id, token) {
  const g = await gh(`/gists/${id}`, {}, token);
  const f = g.files && g.files[FILE];
  if (!f) return null;
  let text = f.content;
  if (f.truncated && f.raw_url) text = await (await fetch(f.raw_url, { cache: 'no-store' })).text();
  const data = JSON.parse(text);
  return data && data.state ? data.state : null;
}

/** signature des données synchronisées : sert à savoir s'il faut renvoyer au cloud */
const sig = (st) => JSON.stringify([COLLS.map((k) => (st[k] || []).map((x) => `${x.id}:${x._u || 0}`).sort().join(',')), Object.keys(st.tombs || {}).sort().join(','), (st.meta || {}).settingsU || 0]);

const payload = (st) => JSON.stringify({ files: { [FILE]: { content: JSON.stringify({ format: 'mon-planning-sync', savedAt: new Date().toISOString(), state: st }) } } });

/**
 * Connecte l'appareil. Renvoie { found: bool } — si un planning existe déjà dans le cloud,
 * `mode` décide : 'remote' (prendre celui du cloud), 'merge' (fusionner) ou 'local' (écraser le cloud).
 */
export async function connect(token, mode = null) {
  token = token.trim();
  const list = await gh('/gists?per_page=100', {}, token);
  const existing = list.find((g) => g.files && g.files[FILE]);
  if (existing && !mode) return { found: true };
  if (existing) {
    const remote = await readGist(existing.id, token);
    cfg = { token, gistId: existing.id };
    saveCfg();
    if (remote && mode === 'remote') applyRemote(remote);
    else if (remote && mode === 'merge') applyRemote(mergeStates(state, remote));
    await gh(`/gists/${existing.id}`, { method: 'PATCH', body: payload(state) });
  } else {
    const g = await gh('/gists', { method: 'POST', body: JSON.stringify({ description: 'Mon Planning — données synchronisées (ne pas supprimer)', public: false, ...JSON.parse(payload(state)) }) }, token);
    cfg = { token, gistId: g.id };
    saveCfg();
  }
  setStatus('ok');
  return { found: !!existing, connected: true };
}

export function disconnect() { cfg = null; saveCfg(); setStatus('off'); }

/** Récupère le cloud, fusionne, renvoie si besoin */
export async function syncNow() {
  if (!syncConfigured()) return;
  if (!navigator.onLine) { setStatus('offline', 'Hors ligne — synchronisation dès le retour du réseau'); return; }
  if (running) { again = true; return; }
  running = true;
  setStatus('syncing');
  try {
    const remote = await readGist(cfg.gistId);
    const localStr = JSON.stringify(state);
    const merged = remote ? mergeStates(state, remote) : state;
    if (JSON.stringify(merged) !== localStr) applyRemote(merged);
    if (!remote || sig(remote) !== sig(state)) await gh(`/gists/${cfg.gistId}`, { method: 'PATCH', body: payload(state) });
    setStatus('ok');
  } catch (e) {
    console.warn(e);
    setStatus('error', e.message || 'Erreur de synchronisation');
  } finally {
    running = false;
    if (again) { again = false; setTimeout(syncNow, 300); }
  }
}

// après chaque modification locale : envoi (regroupé) 1,5 s plus tard
subscribe((info) => {
  if (!syncConfigured() || info.label === 'sync' || info.label === 'external') return;
  clearTimeout(timer);
  timer = setTimeout(syncNow, 1500);
});
// au retour sur l'app, au retour du réseau, et toutes les 60 s quand l'app est ouverte
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
window.addEventListener('online', syncNow);
setInterval(() => { if (document.visibilityState === 'visible') syncNow(); }, 60000);
if (syncConfigured()) setStatus('ok'), setTimeout(syncNow, 500);

export { mutate };
