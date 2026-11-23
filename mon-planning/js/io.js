// Import / export : sauvegarde JSON complète, import de cours, export .ics
import { uid, norm, parseDT, fmtD, addDays, pad } from './util.js';
import { expand } from './model.js';

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

export function exportBackup(state) {
  const d = new Date();
  download(`mon-planning-sauvegarde-${fmtD(d)}.json`, JSON.stringify({ format: 'mon-planning-backup', exportedAt: d.toISOString(), state }, null, 1));
}

/** Analyse un texte collé : sauvegarde complète ou import de cours */
export function parseImport(text) {
  let data;
  const cleaned = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try { data = JSON.parse(cleaned); } catch (e) { throw new Error('Le texte n’est pas un JSON valide. Copie bien tout le bloc, accolades comprises.'); }
  if (data && data.format === 'mon-planning-backup' && data.state) return { kind: 'backup', state: data.state };
  if (data && Array.isArray(data.events) && (data.format === 'edt-cours' || data.events.every((e) => e.start && e.end))) return { kind: 'courses', events: data.events, replace: data.replace !== false };
  if (data && data.events && data.categories && data.settings) return { kind: 'backup', state: data };
  throw new Error('Format non reconnu.');
}

const SPORT_KINDS = ['SP'];

/** Trouve ou crée la matière d'un cours */
function matchSubject(state, title) {
  const t = norm(title);
  if (/^reservation/.test(t)) return '';
  let best = state.subjects.find((x) => norm(x.name) === t || (x.aliases || []).some((a) => norm(a) === t));
  if (!best) best = state.subjects.find((x) => t.includes(norm(x.name)) || norm(x.name).includes(t));
  if (!best && /toefl/.test(t)) best = state.subjects.find((x) => x.id === 'toefl');
  if (best) return best.id;
  const palette = ['#0891b2', '#7c3aed', '#db2777', '#ca8a04', '#059669', '#dc2626', '#2563eb', '#9333ea'];
  const sub = { id: uid(), name: title, color: palette[state.subjects.length % palette.length], weight: 2, revise: true, examDate: '', aliases: [] };
  state.subjects.push(sub);
  return sub.id;
}

/** Applique un import de cours à l'état (à appeler dans mutate) */
export function applyCourses(state, events, replace = true) {
  const valid = events.filter((e) => e.start && e.end && !isNaN(parseDT(e.start)) && !isNaN(parseDT(e.end)));
  if (!valid.length) return { added: 0, removed: 0, weeks: [] };
  let removed = 0;
  const dates = new Set(valid.map((e) => e.start.slice(0, 10)));
  if (replace) {
    const before = state.events.length;
    state.events = state.events.filter((e) => !(e.source === 'import' && dates.has(e.start.slice(0, 10))));
    removed = before - state.events.length;
  }
  let added = 0;
  for (const e of valid) {
    const kind = (e.kind || '').trim();
    const sport = SPORT_KINDS.includes(kind.toUpperCase());
    const title = kind ? `${e.title} [${kind}]` : e.title;
    if (!replace && state.events.some((x) => x.source === 'import' && x.title === title && x.start === e.start)) continue;
    state.events.push({
      id: uid(), title, catId: sport ? 'sport' : 'cours', subjectId: sport ? '' : matchSubject(state, e.title),
      start: e.start.slice(0, 16), end: e.end.slice(0, 16), location: e.location || '', notes: e.notes || '', source: 'import',
    });
    added++;
  }
  return { added, removed, dates: [...dates].sort() };
}

/** Export .ics (Google Agenda, Apple Calendrier, Outlook) */
export function exportICS(state, from, to) {
  const occs = expand(state, from, to).filter((o) => !o.ev.skipped);
  const f = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}00`;
  const escI = (s) => String(s || '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
  const stamp = f(new Date());
  const cat = (id) => (state.categories.find((c) => c.id === id) || {}).name || '';
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mon Planning//FR', 'CALSCALE:GREGORIAN', 'X-WR-CALNAME:Mon Planning', 'X-WR-TIMEZONE:Europe/Paris'];
  for (const o of occs) {
    lines.push('BEGIN:VEVENT', `UID:${o.key.replace(/[^a-z0-9@-]/gi, '')}@mon-planning`, `DTSTAMP:${stamp}`,
      `DTSTART;TZID=Europe/Paris:${f(o.start)}`, `DTEND;TZID=Europe/Paris:${f(o.end)}`, `SUMMARY:${escI(o.title)}`,
      `CATEGORIES:${escI(cat(o.catId))}`);
    if (o.ev.location) lines.push(`LOCATION:${escI(o.ev.location)}`);
    if (o.ev.notes) lines.push(`DESCRIPTION:${escI(o.ev.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  download(`mon-planning-${fmtD(from)}.ics`, lines.join('\r\n'), 'text/calendar');
}
