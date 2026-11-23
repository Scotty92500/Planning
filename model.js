// Modèle : catégories, récurrences, conflits, créneaux libres
import { parseDT, parseD, fmtD, fmtDT, addDays, dayStart, diffDays, isoDow, diffMin, startOfWeek, subtractIntervals, atMin, hm2min, isWeekend } from './util.js';

const UNKNOWN = { id: '?', name: 'Sans catégorie', color: '#AEAEB2', group: 'autre' };
export const catById = (s, id) => s.categories.find((c) => c.id === id) || UNKNOWN;
export const subjectById = (s, id) => (id ? s.subjects.find((x) => x.id === id) : null);
export const groupRank = (s, group) => { const i = s.settings.groupOrder.indexOf(group); return i < 0 ? 99 : i; };
export const eventColor = (s, ev) => catById(s, ev.catId).color;

/** Développe les événements (récurrents ou non) dans [from, to[ */
export function expand(s, from, to) {
  const out = [];
  for (const ev of s.events) {
    const st = parseDT(ev.start), en = parseDT(ev.end);
    const dur = diffMin(st, en);
    if (!ev.recur) {
      if (en > from && st < to) out.push(occ(ev, st, en, null));
      continue;
    }
    const r = ev.recur;
    const interval = Math.max(1, r.interval || 1);
    const until = r.until ? addDays(parseD(r.until), 1) : null;
    const spanDays = Math.ceil(dur / 1440) + 1;
    let d = dayStart(addDays(from, -spanDays));
    if (d < dayStart(st)) d = dayStart(st);
    const startMin = st.getHours() * 60 + st.getMinutes();
    const ex = new Set(ev.exdates || []);
    for (; d < to; d = addDays(d, 1)) {
      if (until && d >= until) break;
      const dd = diffDays(st, d);
      let ok = false;
      if (r.freq === 'daily') ok = dd % interval === 0;
      else if (r.freq === 'weekly') {
        const days = r.byDay && r.byDay.length ? r.byDay : [isoDow(st)];
        const wk = Math.floor(diffDays(startOfWeek(st), d) / 7);
        ok = days.includes(isoDow(d)) && wk % interval === 0;
      } else if (r.freq === 'monthly') ok = d.getDate() === st.getDate();
      if (!ok || ex.has(fmtD(d))) continue;
      const os = atMin(d, startMin), oe = new Date(os.getTime() + dur * 60000);
      if (oe > from && os < to) out.push(occ(ev, os, oe, fmtD(d)));
    }
  }
  out.sort((a, b) => a.start - b.start || b.end - a.end);
  return out;
}
function occ(ev, start, end, occDate) {
  return { key: occDate ? `${ev.id}@${occDate}` : ev.id, ev, id: ev.id, occDate, start, end, title: ev.title, catId: ev.catId, subjectId: ev.subjectId };
}

export const weekRange = (d) => { const a = startOfWeek(d); return [a, addDays(a, 7)]; };
export const isSoft = (s, o) => catById(s, o.catId).group === 'libre';
/** catégorie « en parallèle » (ex. lessive pendant la muscu) : jamais en conflit, ne bloque pas un créneau */
export const isParallel = (s, o) => !!catById(s, o.catId).parallel;

/** Colonnes pour affichage côte à côte des chevauchements (pour un jour) */
export function layoutColumns(items) {
  const res = [];
  let cluster = [], clusterEnd = 0;
  const flush = () => {
    const cols = [];
    for (const it of cluster) {
      let c = cols.findIndex((end) => end <= it.s);
      if (c < 0) { c = cols.length; cols.push(0); }
      cols[c] = it.e; it.col = c;
    }
    for (const it of cluster) { it.ncol = cols.length; res.push(it); }
    cluster = [];
  };
  for (const it of [...items].sort((a, b) => a.s - b.s || b.e - a.e)) {
    if (cluster.length && it.s >= clusterEnd) flush();
    cluster.push(it); clusterEnd = Math.max(clusterEnd, it.e);
    if (cluster.length === 1) clusterEnd = it.e;
  }
  if (cluster.length) flush();
  return res;
}

/** Paires d'événements qui se chevauchent */
export function conflicts(s, occs) {
  const hard = occs.filter((o) => !isSoft(s, o) && !isParallel(s, o) && !o.ev.skipped);
  const pairs = [];
  for (let i = 0; i < hard.length; i++) {
    for (let j = i + 1; j < hard.length; j++) {
      if (hard[j].start >= hard[i].end) break;
      if (hard[j].start < hard[i].end && hard[i].start < hard[j].end) pairs.push([hard[i], hard[j]]);
    }
  }
  return pairs;
}
export function conflictKeys(s, occs) {
  const set = new Set();
  for (const [a, b] of conflicts(s, occs)) { set.add(a.key); set.add(b.key); }
  return set;
}

/** Intervalles libres (ms) d'une journée dans une fenêtre [hh:mm, hh:mm] */
export function freeInWindow(busy, day, win) {
  const a = atMin(day, hm2min(win[0])).getTime();
  const b = atMin(day, hm2min(win[1]) || 1440).getTime();
  if (b <= a) return [];
  return subtractIntervals([[a, b]], busy);
}

export function busyIntervals(occs) {
  return occs.map((o) => [o.start.getTime(), o.end.getTime()]);
}

/** Fenêtre de travail d'un jour donné */
export function workWindow(s, day) {
  const w = s.settings.work;
  const dow = isoDow(day);
  return dow === 6 ? w.sat : dow === 7 ? w.sun : w.weekday;
}

/** Trouve le prochain créneau libre de `dur` minutes à partir de `from` (dans les fenêtres de travail, puis 8h-22h) */
export function findFreeSlot(s, dur, from, until) {
  const limit = until || addDays(from, 21);
  for (let d = dayStart(from); d < limit; d = addDays(d, 1)) {
    const occs = expand(s, d, addDays(d, 1));
    const busy = busyIntervals(occs.filter((o) => !isSoft(s, o) && !isParallel(s, o)));
    for (const win of [workWindow(s, d), ['08:00', '22:00']]) {
      for (const [fs, fe] of freeInWindow(busy, d, win)) {
        const start = Math.max(fs, Math.ceil(from.getTime() / 900000) * 900000);
        if (fe - start >= dur * 60000) return new Date(start);
      }
    }
  }
  return null;
}

export const isWE = isWeekend;
export { fmtDT };
