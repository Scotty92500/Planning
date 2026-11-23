// Organisation intelligente de la semaine
// Ordre : événements fixes conservés → habitudes (par priorité de catégorie) → siestes → objectifs perso → révisions
import { uid, addDays, atMin, hm2min, fmtDT, fmtD, isoDow, isWeekend, diffMin, parseD, dayStart } from './util.js';
import { expand, catById, groupRank, freeInWindow, workWindow, subjectById, isParallel } from './model.js';

const FERIES = ['01-01', '05-01', '05-08', '07-14', '08-15', '11-01', '11-11', '12-25'];
const isFerie = (d) => FERIES.includes(fmtD(d).slice(5));

/** dates d'examen par matière (événements « Examens & CC » importés + date saisie dans Réglages) */
export function examMap(s) {
  const m = new Map();
  const add = (id, d) => { if (!id || !d) return; if (!m.has(id)) m.set(id, []); m.get(id).push(d); };
  for (const e of s.events) if (e.catId === 'examen') add(e.subjectId, e.start.slice(0, 10));
  for (const x of s.subjects) add(x.id, x.examDate);
  for (const v of m.values()) v.sort();
  return m;
}
const daysTo = (dateStr, day) => (parseD(dateStr) - dayStart(day)) / 864e5;
/** une épreuve dans les `n` prochains jours (exclut le jour même) ? */
export function examWithin(s, day, n, exams = examMap(s)) {
  for (const list of exams.values()) if (list.some((d) => { const k = daysTo(d, day); return k > 0 && k <= n; })) return true;
  if (s.settings.toeflDate) { const k = daysTo(s.settings.toeflDate, day); if (k > 0 && k <= 3) return true; }
  return false;
}

const PRIO_W = { 'élevée': 3, 'moyenne': 2, 'faible': 1 };
const WHEN = { matin: [['08:00', '12:00']], aprem: [['13:30', '19:00']], soir: [['19:00', '22:15']] };

function ctx(s, weekStart, { keepAuto = false } = {}) {
  const ws = dayStart(weekStart), we = addDays(ws, 7);
  const occs = expand(s, addDays(ws, -1), addDays(we, 1));
  const isRemovable = (o) => !keepAuto && o.ev.source === 'auto' && !o.ev.pinned && !o.ev.recur && o.start >= ws && o.start < we;
  const kept = occs.filter((o) => !isRemovable(o));
  const removed = [...new Set(occs.filter(isRemovable).map((o) => o.ev.id))];
  const busy = kept.filter((o) => !isParallel(s, o)).map((o) => [o.start.getTime(), o.end.getTime()]);
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const created = [];
  const place = (ev, parallel = false) => {
    created.push(ev);
    if (!parallel) busy.push([ev._s.getTime(), ev._e.getTime()]);
  };
  const hasSimilar = (day, title, catId) => kept.some((o) => fmtD(o.start) === fmtD(day) && o.title === title && o.catId === catId);
  return { ws, we, kept, removed, busy, days, created, place, hasSimilar };
}

function mk(title, catId, start, end, extra = {}) {
  return { id: uid(), title, catId, subjectId: '', start: fmtDT(start), end: fmtDT(end), location: '', notes: '', source: 'auto', _s: start, _e: end, ...extra };
}

/** Choisit le meilleur morceau libre : durée max, puis le plus proche de l'heure préférée */
function bestPiece(pieces, durMin, minDur, prefMs) {
  let best = null;
  for (const [fs, fe] of pieces) {
    const len = (fe - fs) / 60000;
    if (len < minDur) continue;
    const L = Math.min(durMin, len);
    const st = Math.min(Math.max(prefMs, fs), fe - L * 60000);
    const score = (durMin - L) * 1e7 + Math.abs(st - prefMs);
    if (!best || score < best.score) best = { score, start: new Date(st), end: new Date(st + L * 60000) };
  }
  return best;
}

function habitWindow(h, day) {
  if (h.type === 'fixed') {
    const a = hm2min(h.start);
    return [a, a + h.duration];
  }
  const w = isWeekend(day) && h.weekendWindow ? h.weekendWindow : h.window;
  return [hm2min(w[0]), hm2min(w[1]) || 1440];
}

function placeHabit(c, h, day) {
  if (c.hasSimilar(day, h.title, h.catId)) return true;
  const [a, b] = habitWindow(h, day);
  const from = atMin(day, a).getTime(), to = atMin(day, b).getTime();
  const free = subtract([[from, to]], c.busy);
  const pref = h.type === 'fixed' ? from : atMin(day, hm2min(h.preferred || h.window[0])).getTime();
  const p = bestPiece(free, h.duration, Math.min(h.minDuration || h.duration, h.duration), pref);
  if (!p) return false;
  c.place(mk(h.title, h.catId, p.start, p.end, { habitId: h.id, notes: h.note || '' }));
  return true;
}

function subtract(free, busy) {
  let res = free;
  for (const [bs, be] of busy) {
    const next = [];
    for (const [fs, fe] of res) {
      if (be <= fs || bs >= fe) { next.push([fs, fe]); continue; }
      if (bs > fs) next.push([fs, bs]);
      if (be < fe) next.push([be, fe]);
    }
    res = next;
  }
  return res;
}

function planHabits(s, c, warnings) {
  const habits = s.habits.filter((h) => h.enabled && h.type !== 'with');
  const sorted = [...habits].sort((x, y) => groupRank(s, catById(s, x.catId).group) - groupRank(s, catById(s, y.catId).group) || (x.type === 'fixed' ? -1 : 1));
  for (const h of sorted) {
    if (h.type === 'weekly') {
      const already = c.kept.filter((o) => o.title === h.title && o.catId === h.catId && o.start >= c.ws && o.start < c.we).length;
      let need = (h.times || 1) - already;
      const used = new Set();
      // 1er passage : jours dans l'ordre de préférence, en évitant deux jours consécutifs
      for (const pass of [true, false]) {
        for (const dow of h.days) {
          if (need <= 0) break;
          if (used.has(dow)) continue;
          if (pass && [...used].some((u) => Math.abs(u - dow) === 1)) continue;
          const day = c.days[dow - 1];
          if (placeHabitWeekly(c, h, day)) { used.add(dow); need--; }
        }
      }
      if (need > 0) warnings.push(`« ${h.title} » : ${need} séance(s) n'ont pas trouvé de place cette semaine.`);
    } else {
      for (const day of c.days) {
        if (!h.days.includes(isoDow(day))) continue;
        if (!placeHabit(c, h, day)) warnings.push(`« ${h.title} » n'a pas trouvé de place le ${fmtD(day).slice(8)}/${fmtD(day).slice(5, 7)}.`);
      }
    }
  }
}
/** habitude faite en même temps qu'une autre (ex. lessive pendant la musculation) */
function planWithHabits(s, c, warnings) {
  for (const h of s.habits.filter((x) => x.enabled && x.type === 'with')) {
    const already = c.kept.filter((o) => o.title === h.title && o.catId === h.catId && o.start >= c.ws && o.start < c.we).length;
    let need = (h.times || 1) - already;
    if (need <= 0) continue;
    const hosts = [...c.kept.map((o) => ({ title: o.title, s: o.start })), ...c.created.map((e) => ({ title: e.title, s: e._s }))]
      .filter((o) => o.title === h.with && o.s >= c.ws && o.s < c.we && (h.days || [1, 2, 3, 4, 5, 6, 7]).includes(isoDow(o.s)))
      .sort((a, b) => a.s - b.s);
    for (const host of hosts) {
      if (need <= 0) break;
      c.place(mk(h.title, h.catId, host.s, new Date(host.s.getTime() + h.duration * 60000), { habitId: h.id, notes: h.note || '' }), !!catById(s, h.catId).parallel);
      need--;
    }
    if (need > 0) warnings.push(`« ${h.title} » : pas de séance « ${h.with} » cette semaine pour la caser.`);
  }
}

function placeHabitWeekly(c, h, day) {
  const [a, b] = habitWindow(h, day);
  const free = subtract([[atMin(day, a).getTime(), atMin(day, b).getTime()]], c.busy);
  const pref = atMin(day, hm2min(h.preferred || h.window[0])).getTime();
  const p = bestPiece(free, h.duration, h.minDuration || h.duration, Math.max(pref, atMin(day, a).getTime()));
  if (!p) return false;
  c.place(mk(h.title, h.catId, p.start, p.end, { habitId: h.id, notes: h.note || '' }));
  return true;
}

function planNaps(s, c) {
  if (!s.settings.autoNaps) return;
  const all = [...c.kept.map((o) => ({ catId: o.catId, title: o.title, s: o.start, e: o.end })), ...c.created.map((e) => ({ catId: e.catId, title: e.title, s: e._s, e: e._e }))];
  for (const day of c.days) {
    const night = all.find((o) => o.catId === 'sommeil' && /sommeil/i.test(o.title) && fmtD(o.e) === fmtD(day) && o.e.getHours() < 13);
    if (!night || diffMin(night.s, night.e) >= 420) continue;
    const lunch = all.find((o) => o.catId === 'repas' && /déjeuner/i.test(o.title) && fmtD(o.s) === fmtD(day));
    if (!lunch) continue;
    const st = lunch.e.getTime();
    const free = subtract([[st, st + 20 * 60000]], c.busy);
    if (free.length === 1 && free[0][0] === st && free[0][1] === st + 20 * 60000) {
      c.place(mk('Sieste', 'sommeil', new Date(st), new Date(st + 20 * 60000), { notes: 'Nuit courte la veille' }));
    }
  }
}

function goalWindows(s, g, day) {
  if (examWithin(s, day, 7)) return (g.when && WHEN[g.when] ? WHEN[g.when] : isWeekend(day) ? s.settings.perso.weekend : s.settings.perso.weekday).filter((w) => hm2min(w[0]) < 1200);
  const base = g.when && WHEN[g.when] ? WHEN[g.when] : isWeekend(day) ? s.settings.perso.weekend : s.settings.perso.weekday;
  const free = s.settings.perso.freeEvenings || [];
  return free.includes(isoDow(day)) ? base.filter((w) => hm2min(w[0]) < 1200) : base;
}

/** Sessions d'objectifs perso, en alternant les objectifs */
export function planGoals(s, c, goals, { proposalsOnly = false } = {}) {
  const remaining = new Map();
  const persoMinutesDay = (day) => [...c.kept.map((o) => ({ s: o.start, e: o.end, g: o.ev.goalId })), ...c.created.map((e) => ({ s: e._s, e: e._e, g: e.goalId }))]
    .filter((o) => o.g && fmtD(o.s) === fmtD(day)).reduce((t, o) => t + diffMin(o.s, o.e), 0);
  for (const g of goals) {
    const done = c.kept.filter((o) => o.ev.goalId === g.id && o.start >= c.ws && o.start < c.we).reduce((t, o) => t + diffMin(o.start, o.end), 0);
    remaining.set(g.id, Math.max(0, (g.weeklyMinutes || 0) - done));
  }
  let last = null;
  const out = [];
  const today = dayStart(new Date());
  for (const day of c.days) {
    if (proposalsOnly && day < today) continue;
    let cap = (isWeekend(day) ? s.settings.perso.capWeekend : s.settings.perso.capWeekday) - (proposalsOnly ? 0 : persoMinutesDay(day));
    const usedToday = new Set();
    for (let guard = 0; guard < 6 && cap >= 45; guard++) {
      const cands = goals.filter((g) => (g.days || []).includes(isoDow(day)) && remaining.get(g.id) >= 45)
        .sort((a, b) => score(b) - score(a));
      function score(g) { return remaining.get(g.id) * (PRIO_W[g.priority] || 2) * (g.id === last ? 0.4 : 1) * (usedToday.has(g.id) ? 0.3 : 1) * (g.days.length <= 2 ? 1.6 : 1); }
      let placed = false;
      for (const g of cands) {
        const dur = Math.min(g.sessionMin || 60, remaining.get(g.id), cap);
        const minDur = Math.min(45, dur);
        let p = null;
        for (const w of goalWindows(s, g, day)) {
          const a = atMin(day, hm2min(w[0])).getTime(), b = atMin(day, hm2min(w[1]) || 1440).getTime();
          const free = subtract([[a, b]], c.busy);
          p = bestPiece(free, dur, minDur, a);
          if (p) break;
        }
        if (!p) continue;
        const L = diffMin(p.start, p.end);
        const ev = mk(g.title, g.catId, p.start, p.end, { goalId: g.id });
        c.place(ev); out.push(ev);
        remaining.set(g.id, remaining.get(g.id) - L);
        cap -= L; last = g.id; usedToday.add(g.id); placed = true;
        break;
      }
      if (!placed) break;
    }
  }
  return { events: out, remaining };
}

function planStudy(s, c, warnings) {
  const st = s.settings;
  const hasCourses = c.kept.some((o) => o.ev.source === 'import' && o.start >= c.ws && o.start < c.we);
  const alloc = new Map();
  let lastSubj = null;
  const tasks = s.tasks.filter((t) => t.status !== 'terminé' && !t.eventId && t.catId === 'revision' && (t.estimate || 0) >= 15)
    .map((t) => ({ t, left: t.estimate })).sort((a, b) => (a.t.due || '9999').localeCompare(b.t.due || '9999') || (PRIO_W[b.t.priority] - PRIO_W[a.t.priority]));
  const exams = examMap(s);
  const keptRev = new Map();
  for (const o of c.kept) if (o.catId === 'revision' && o.subjectId && o.start >= c.ws && o.start < c.we) keptRev.set(o.subjectId, (keptRev.get(o.subjectId) || 0) + diffMin(o.start, o.end));
  const subjects = s.subjects.filter((x) => (x.revise && x.weight > 0) || exams.has(x.id));
  const pickSubject = (day) => {
    let best = null, bs = -1;
    for (const sub of subjects) {
      let w = Math.max(sub.weight || 0, exams.has(sub.id) ? 1 : 0);
      if (sub.id === 'toefl') {
        const dd = st.toeflDate ? daysTo(st.toeflDate, day) : -1;
        if (dd > 0 && dd <= 14) w = 4; else if (st.toeflDate && dd <= 0) w = 0.5;
      }
      const next = (exams.get(sub.id) || []).find((d) => daysTo(d, day) > 0);
      if (next) { const dd = daysTo(next, day); if (dd <= 3) w *= 3; else if (dd <= 14) w *= 2; }
      const got = (alloc.get(sub.id) || 0) + (keptRev.get(sub.id) || 0);
      if (sub.weeklyTarget > 0) w *= got < sub.weeklyTarget ? 1 + (sub.weeklyTarget - got) / 60 : 0.25;
      const sc = w / (1 + (alloc.get(sub.id) || 0) / 60) * (sub.id === lastSubj ? 0.45 : 1);
      if (sc > bs) { bs = sc; best = sub; }
    }
    return best;
  };
  let skippedWeekdays = false;
  for (const day of c.days) {
    const we = isWeekend(day);
    if (isFerie(day)) continue;
    const rush = examWithin(s, day, 10, exams);
    if (!we && st.studyOnlyIfCourses && !hasCourses && !rush) { skippedWeekdays = true; continue; }
    const win = workWindow(s, day);
    const a = atMin(day, hm2min(win[0])).getTime(), b = atMin(day, hm2min(win[1])).getTime();
    // budget de travail du jour (cours + révisions)
    const courseMin = c.kept.filter((o) => fmtD(o.start) === fmtD(day) && ['cours', 'visio', 'revision', 'examen'].includes(o.catId)).reduce((t, o) => t + diffMin(o.start, o.end), 0);
    let budget = st.maxWorkPerDay - courseMin;
    let free = subtract([[a, b]], c.busy);
    // marge pour les imprévus (en semaine)
    if (!we && st.bufferPerDay > 0) {
      const piece = [...free].reverse().find(([fs, fe]) => fe - fs >= st.bufferPerDay * 60000);
      if (piece) {
        const e = new Date(piece[1]), sDate = new Date(piece[1] - st.bufferPerDay * 60000);
        c.place(mk('Marge imprévus', 'libre', sDate, e, { notes: 'Plage gardée libre pour les imprévus' }));
        free = subtract([[a, b]], c.busy);
      }
    }
    // semaine avant un examen : on travaille aussi après le dîner
    const busyEvening = c.kept.some((o) => fmtD(o.start) === fmtD(day) && ['asso', 'sorties'].includes(catById(s, o.catId).group) && o.end.getHours() >= 20);
    if (examWithin(s, day, 7, exams) && !busyEvening && !['12-24', '12-31'].includes(fmtD(day).slice(5))) {
      const ea = atMin(day, hm2min('20:45')).getTime(), eb = atMin(day, hm2min('22:10')).getTime();
      free = [...free, ...subtract([[ea, eb]], c.busy)];
      budget += 90;
    }
    for (const [fs, fe] of free) {
      let cur = fs;
      while (fe - cur >= st.studyBlockMin * 60000 && budget >= st.studyBlockMin) {
        const len = Math.min(st.studyBlockMax, (fe - cur) / 60000, budget);
        const start = new Date(cur), end = new Date(cur + len * 60000);
        const task = tasks.find((x) => x.left > 0 && (!x.t.due || parseD(x.t.due) >= dayStart(start)));
        let ev;
        if (task) {
          const tl = Math.max(st.studyBlockMin, Math.min(len, task.left));
          end.setTime(start.getTime() + tl * 60000);
          ev = mk(task.t.title, 'revision', start, end, { taskId: task.t.id, subjectId: task.t.subjectId || '' });
          task.left -= tl;
          budget -= tl; cur += (tl + st.pauseMin) * 60000; c.place(ev); continue;
        } else {
          const sub = pickSubject(day);
          ev = mk(sub ? `Révisions · ${sub.name}` : 'Travail perso', 'revision', start, end, { subjectId: sub ? sub.id : '' });
          if (sub) { alloc.set(sub.id, (alloc.get(sub.id) || 0) + len); lastSubj = sub.id; }
        }
        c.place(ev);
        budget -= len;
        cur += (len + st.pauseMin) * 60000;
      }
    }
  }
  if (skippedWeekdays) warnings.push("Aucun cours importé cette semaine (vacances ?) : les révisions en semaine n'ont pas été placées. Importe tes cours, ou ajoute des créneaux de révision à la main.");
}

/** Calcule la proposition de planning pour la semaine (sans rien modifier) */
export function planWeek(s, weekStart) {
  const c = ctx(s, weekStart);
  const warnings = [];
  planHabits(s, c, warnings);
  planWithHabits(s, c, warnings);
  planNaps(s, c);
  planGoals(s, c, s.goals.filter((g) => g.active !== false && g.weeklyMinutes > 0 && (!g.due || parseD(g.due) >= c.ws)));
  planStudy(s, c, warnings);
  const events = c.created.map(({ _s, _e, ...ev }) => ev);
  return { add: events, remove: c.removed, warnings, keptCount: c.kept.length };
}

export function applyPlan(state, plan) {
  const rm = new Set(plan.remove);
  state.events = state.events.filter((e) => !rm.has(e.id));
  state.events.push(...plan.add);
}

/** Propositions de créneaux pour un objectif (semaine affichée), sans supprimer l'existant */
export function proposeGoalSlots(s, goal, weekStart) {
  const c = ctx(s, weekStart, { keepAuto: true });
  const g = { ...goal, weeklyMinutes: goal.weeklyMinutes || 120 };
  const { events } = planGoals(s, c, [g], { proposalsOnly: true });
  return events.map(({ _s, _e, ...ev }) => ev);
}
