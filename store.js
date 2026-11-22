// État de l'application + sauvegarde automatique (localStorage) + annulation
import { seedState, defaultSettings, defaultCategories } from './seed.js';

const KEY = 'mon-planning-v1';
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
  for (const id of ['libre', 'examen']) if (!s.categories.find((c) => c.id === id)) s.categories.push(defaultCategories().find((c) => c.id === id));
  s.meta = s.meta || { createdAt: Date.now() };
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

/** Toute modification passe par ici : snapshot pour annuler, sauvegarde, rafraîchissement */
export function mutate(label, fn, { undoable = true } = {}) {
  if (undoable) {
    undoStack.push({ label, snap: JSON.stringify(state) });
    if (undoStack.length > UNDO_MAX) undoStack.shift();
  }
  const r = fn(state);
  state.meta.updatedAt = Date.now();
  save();
  notify({ label });
  return r;
}

export const canUndo = () => undoStack.length > 0;
export function undo() {
  const last = undoStack.pop();
  if (!last) return null;
  state = JSON.parse(last.snap);
  save();
  notify({ label: 'undo' });
  return last.label;
}

export function replaceState(next) {
  undoStack.push({ label: 'import', snap: JSON.stringify(state) });
  state = migrate(next);
  save();
  notify({ label: 'replace' });
}

export function resetAll() {
  undoStack.push({ label: 'reset', snap: JSON.stringify(state) });
  state = seedState();
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
