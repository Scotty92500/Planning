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

const KINDS = ['CMo', 'CAo', 'TDo', 'TPo', 'CM', 'CA', 'TD', 'TP', 'LV', 'SP', 'NR', 'DS', 'CC', 'EX', 'PRJ'];

/** Lit un fichier iCalendar (.ics) → liste de cours { title, kind, start, end, location } */
export function parseICS(text) {
  const lines = String(text).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '').split('\n');
  const unesc = (v) => v.replace(/\\n/gi, ' ').replace(/\\([,;\\])/g, '$1').trim();
  const toLocal = (prop, val) => {
    const m = val.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
    if (!m) return null;
    if (!m[4]) return { allDay: true };
    let d;
    if (m[7]) d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]));
    else d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]); // heure locale (TZID Europe/Paris ou flottante)
    return { date: d };
  };
  const out = [];
  let cur = null;
  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
    if (line === 'END:VEVENT') { if (cur) out.push(cur); cur = null; continue; }
    if (!cur) continue;
    const i = line.indexOf(':');
    if (i < 0) continue;
    const head = line.slice(0, i), val = line.slice(i + 1);
    const name = head.split(';')[0].toUpperCase();
    if (name === 'DTSTART' || name === 'DTEND') cur[name] = toLocal(head, val);
    else if (name === 'SUMMARY') cur.summary = unesc(val);
    else if (name === 'LOCATION') cur.location = unesc(val);
    else if (name === 'DESCRIPTION') cur.description = unesc(val);
    else if (name === 'RRULE') cur.rrule = val;
    else if (name === 'STATUS') cur.status = val.toUpperCase();
    else if (name === 'TITLE') cur.title = unesc(val);
    else if (name === 'TYPECOURS') cur.type = unesc(val);
    else if (name === 'NOTES') cur.notes = unesc(val);
    else if (name === 'FLAGPRESENTIEL') cur.flag = val.toLowerCase();
    else if (name === 'SITE') cur.site = unesc(val);
  }
  const events = [];
  let skipped = 0;
  for (const e of out) {
    if (!e.DTSTART || !e.DTSTART.date || e.status === 'CANCELLED') { skipped++; continue; }
    const st = e.DTSTART.date;
    const en = e.DTEND && e.DTEND.date ? e.DTEND.date : new Date(st.getTime() + 3600000);
    let title = (e.summary || 'Cours').replace(/\s+/g, ' ').replace(/^\[[^\]]*\]\s*/, '');
    let kind = '';
    if (e.title) { // format De Vinci : champs TITLE et TYPECOURS
      const visio = e.flag === 'distanciel' || (e.site || '').trim() === 'Online';
      events.push({ title: e.title.trim(), kind: (e.type || '').trim(), start: fmtDTlocal(st), end: fmtDTlocal(en), location: e.location || '', notes: e.notes || '', recurring: !!e.rrule, ...(visio ? { visio: true } : {}) });
      continue;
    }
    title = title.replace(/\]\s*[A-ZÉÈ][^\[\]]*$/, ']'); // retire le nom du prof après [TD]
    const br = title.match(/^(.*?)\s*[\[(]\s*([A-Za-z]{2,4})\s*[\])]\s*$/);
    const dash = title.match(/^(.*?)\s*[-–:]\s*([A-Za-z]{2,4})$/);
    const mm = br || dash;
    if (mm && KINDS.some((k) => k.toLowerCase() === mm[2].toLowerCase())) { title = mm[1].trim(); kind = mm[2]; }
    events.push({ title, kind, start: fmtDTlocal(st), end: fmtDTlocal(en), location: e.location || '', recurring: !!e.rrule });
  }
  return { events, skipped, recurring: events.filter((e) => e.recurring).length };
}
const fmtDTlocal = (d) => `${fmtD(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

/** Analyse un texte collé : sauvegarde complète, import de cours JSON, ou fichier .ics */
export function parseImport(text) {
  if (/BEGIN:VCALENDAR/i.test(text)) {
    const r = parseICS(text);
    if (!r.events.length) throw new Error('Aucun cours trouvé dans le fichier .ics.');
    return { kind: 'courses', events: r.events, replace: true, ics: true, skipped: r.skipped, recurring: r.recurring };
  }
  let data;
  const cleaned = String(text).trim().replace(/^```(json)?/i, '').replace(/```$/, '').trim();
  try { data = JSON.parse(cleaned); } catch (e) { throw new Error('Le texte n’est pas un JSON valide. Copie bien tout le bloc, accolades comprises.'); }
  if (data && data.format === 'mon-planning-backup' && data.state) return { kind: 'backup', state: data.state };
  if (data && Array.isArray(data.events) && (data.format === 'edt-cours' || data.events.every((e) => e.start && e.end))) return { kind: 'courses', events: data.events, replace: data.replace !== false };
  if (data && data.events && data.categories && data.settings) return { kind: 'backup', state: data };
  throw new Error('Format non reconnu.');
}

const SPORT_KINDS = ['SP'];
/** cours à distance : flag du .ics, lieu ZOOM/Teams/en ligne, ou type « o » (CMo, CAo…) */
export const isVisio = (e, kind = '') => !!e.visio || /zoom|teams|online|en ligne|distanciel|visio/i.test(e.location || '') || /^[A-Z]{2}o$/.test(kind);

/** Trouve ou crée la matière d'un cours */
const tokPrefix = (a, b) => { const A = a.split(' ').filter((w) => w.length > 2), B = b.split(' '); return A.length > 0 && A.every((w) => B.some((x) => x.startsWith(w) || w.startsWith(x) && x.length > 3)); };
const NO_REVISE = /skills|ssk|design thinking|colles|projet|stage|hackathon|cooperation|reunion|international/;
function matchSubject(state, title) {
  const t = norm(title);
  if (/^reservation/.test(t)) return '';
  let best = state.subjects.find((x) => norm(x.name) === t || (x.aliases || []).some((a) => norm(a) === t));
  if (!best) best = state.subjects.find((x) => t.includes(norm(x.name)) || norm(x.name).includes(t));
  if (!best) best = state.subjects.find((x) => tokPrefix(t, norm(x.name)) || tokPrefix(norm(x.name), t));
  if (!best && /toefl/.test(t)) best = state.subjects.find((x) => x.id === 'toefl');
  if (best) return best.id;
  const palette = ['#0891b2', '#7c3aed', '#db2777', '#ca8a04', '#059669', '#dc2626', '#2563eb', '#9333ea'];
  const noRev = NO_REVISE.test(t);
  const sub = { id: uid(), name: title, color: palette[state.subjects.length % palette.length], weight: noRev ? 0 : 2, revise: !noRev, examDate: '', aliases: [] };
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
    const exam = /^(examen|rattrapage|ds|cc|ex)$/i.test(kind);
    if (exam && /toefl|toeic/i.test(e.title) && !state.settings.toeflDate) state.settings.toeflDate = e.start.slice(0, 10);
    const title = kind ? `${e.title} [${kind}]` : e.title;
    if (!replace && state.events.some((x) => x.source === 'import' && x.title === title && x.start === e.start)) continue;
    state.events.push({
      id: uid(), title, catId: sport ? 'sport' : exam ? 'examen' : isVisio(e, kind) ? 'visio' : 'cours', subjectId: sport ? '' : matchSubject(state, e.title),
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
