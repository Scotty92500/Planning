// État de l'application + sauvegarde automatique (localStorage) + annulation
import { seedState, defaultSettings, defaultCategories } from './seed.js';

const KEY = 'mon-planning-v1';
export const COLLS = ['categories', 'subjects', 'habits', 'goals', 'tasks', 'events'];
const TOMB_DAYS = 90;
const UNDO_MAX = 40;
export let state = null;
const undoStack = [];
const listeners = new Set();
let saveError = null;

export const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const notify = (info) => listeners.forEach((fn) => fn(info));

function migrate(s) {
  const d = defaultSettings();
  s.settings = { ...d, ...(s.settings || {}) };
  s.settings.work = { ...d.work, ...(s.settings.work || {}) };
  s.settings.perso = { ...d.perso, ...(s.settings.perso || {}) };
  for (const k of ['categories', 'subjects', 'habits', 'goals', 'tasks', 'events']) if (!Array.isArray(s[k])) s[k] = [];
  for (const id of ['examen']) if (!s.categories.find((c) => c.id === id)) s.categories.push(defaultCategories().find((c) => c.id === id));
  s.meta = s.meta || { createdAt: Date.now() };
  s.tombs = s.tombs || {};
  s.version = 1;
  return s;
}

export function load() {
  let raw = null;
  try { raw = localStorage.getItem(KEY); } catch (e) { /* stockage indisponible */ }
  if (raw) {
    try { state = migrate(JSON.parse(raw)); return false; } catch (e) { console.error('Données illisibles', e); }
  }
  state = seedState();
  save();
  return true;
}

export function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    saveError = null;
    state.meta.lastSaved = Date.now();
  } catch (e) {
    saveError = e;
    console.error(e);
  }
}
export const getSaveError = () => saveError;

/** Horodate les éléments modifiés / supprimés (nécessaire pour fusionner PC et téléphone) */
function stamp(prev, next) {
  const now = Date.now();
  next.tombs = next.tombs || {};
  for (const k of COLLS) {
    const before = new Map((prev[k] || []).map((x) => [x.id, JSON.stringify({ ...x, _u: 0 })]));
    const ids = new Set();
    for (const x of next[k] || []) {
      ids.add(x.id);
      if (before.get(x.id) !== JSON.stringify({ ...x, _u: 0 })) x._u = now;
      delete next.tombs[x.id];
    }
    for (const id of before.keys()) if (!ids.has(id)) next.tombs[id] = now;
  }
  if (JSON.stringify(prev.settings) !== JSON.stringify(next.settings)) next.meta.settingsU = now;
  const limit = now - TOMB_DAYS * 864e5;
  for (const [id, t] of Object.entries(next.tombs)) if (t < limit) delete next.tombs[id];
}

/** Toute modification passe par ici : snapshot pour annuler, sauvegarde, rafraîchissement */
export function mutate(label, fn, { undoable = true } = {}) {
  const snap = JSON.stringify(state);
  if (undoable) {
    undoStack.push({ label, snap });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  const r = fn(state);
  stamp(JSON.parse(snap), state);
  state.meta.updatedAt = Date.now();
  save();
  notify({ label });
  return r;
}

/** Fusion de deux versions (appareil / cloud) : l'élément modifié le plus récemment gagne, les suppressions sont respectées */
export function mergeStates(a, b) {
  const out = JSON.parse(JSON.stringify(a));
  const tombs = { ...(b.tombs || {}) };
  for (const [id, t] of Object.entries(a.tombs || {})) tombs[id] = Math.max(t, tombs[id] || 0);
  for (const k of COLLS) {
    const m = new Map();
    for (const x of [...(a[k] || []), ...(b[k] || [])]) {
      const cur = m.get(x.id);
      if (!cur || (x._u || 0) > (cur._u || 0)) m.set(x.id, x);
    }
    out[k] = [...m.values()].filter((x) => !(tombs[x.id] && tombs[x.id] >= (x._u || 0)));
    // garde l'ordre d'origine (catégories, habitudes…)
    const order = new Map([...(a[k] || []), ...(b[k] || [])].map((x, i) => [x.id, i]));
    out[k].sort((x, y) => (order.get(x.id) ?? 0) - (order.get(y.id) ?? 0));
  }
  // doublons possibles si les deux appareils ont généré la même chose hors ligne
  const dedupe = (arr, keyFn) => {
    const best = new Map();
    for (const x of arr) { const k = keyFn(x); if (k == null) continue; const cur = best.get(k); if (!cur || (x._u || 0) > (cur._u || 0)) best.set(k, x); }
    return arr.filter((x) => { const k = keyFn(x); return k == null || best.get(k) === x; });
  };
  out.events = dedupe(out.events, (e) => (e.source === 'auto' && !e.pinned ? `${e.title}|${e.start}|${e.end}` : e.source === 'import' ? `i|${e.title}|${e.start}` : null));
  out.habits = dedupe(out.habits, (h) => `${h.title}|${h.type}|${(h.days || []).join('')}|${h.start || ''}`);
  out.tombs = tombs;
  if ((b.meta.settingsU || 0) > (a.meta.settingsU || 0)) { out.settings = b.settings; out.meta.settingsU = b.meta.settingsU; }
  out.meta.needsInitialPlan = !!(a.meta.needsInitialPlan && b.meta.needsInitialPlan);
  out.meta.v2 = !!(a.meta.v2 || b.meta.v2);
  out.meta.v3 = !!(a.meta.v3 || b.meta.v3);
  out.meta.v4 = !!(a.meta.v4 || b.meta.v4);
  out.meta.updatedAt = Math.max(a.meta.updatedAt || 0, b.meta.updatedAt || 0);
  return out;
}

/** Remplace l'état par une version venue du cloud (sans annulation ni horodatage) */
export function applyRemote(next) {
  state = migrate(next);
  save();
  notify({ label: 'sync' });
}

export const canUndo = () => undoStack.length > 0;
export function undo() {
  const last = undoStack.pop();
  if (!last) return null;
  const prev = state;
  state = JSON.parse(last.snap);
  stamp(prev, state);
  save();
  notify({ label: 'undo' });
  return last.label;
}

export function replaceState(next) {
  undoStack.push({ label: 'import', snap: JSON.stringify(state) });
  const prev = state;
  state = migrate(next);
  stamp(prev, state);
  save();
  notify({ label: 'replace' });
}

export function resetAll() {
  undoStack.push({ label: 'reset', snap: JSON.stringify(state) });
  const prev = state;
  state = seedState();
  stamp(prev, state);
  save();
  notify({ label: 'reset' });
}

// Demande au navigateur de ne pas effacer les données
export async function requestPersistence() {
  try { if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist(); } catch (e) { /* */ }
  return false;
}

// Synchronisation entre onglets ouverts sur le même appareil
window.addEventListener('storage', (e) => {
  if (e.key === KEY && e.newValue) {
    try { state = migrate(JSON.parse(e.newValue)); notify({ label: 'external' }); } catch (err) { /* */ }
  }
});
