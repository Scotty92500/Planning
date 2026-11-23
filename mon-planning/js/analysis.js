// Bilan de la semaine : ce qui manque, surcharges, conflits, temps par catégorie
import { addDays, fmtD, diffMin, isoDow, isWeekend, DOW_LONG, fmtDur, parseD, dayStart } from './util.js';
import { expand, catById, conflicts, isSoft } from './model.js';
import { GROUPS } from './seed.js';

export function minutesByGroup(s, occs, ws, we) {
  const m = {};
  const now = new Date();
  for (const o of occs) {
    const a = Math.max(o.start, ws), b = Math.min(o.end, we);
    if (b <= a) continue;
    const g = catById(s, o.catId).group;
    const min = (b - a) / 60000;
    m[g] = m[g] || { planned: 0, done: 0 };
    m[g].planned += min;
    if (!o.ev.skipped) m[g].done += Math.max(0, (Math.min(b, now) - a) / 60000);
  }
  return m;
}

export function minutesByCat(s, occs, ws, we) {
  const m = {};
  for (const o of occs) {
    const a = Math.max(o.start, ws), b = Math.min(o.end, we);
    if (b <= a) continue;
    m[o.catId] = (m[o.catId] || 0) + (b - a) / 60000;
  }
  return m;
}

/**
 * Renvoie une liste d'items { level: 'bad'|'warn'|'info'|'ok', title, detail, action }
 * action: 'plan' | 'import' | 'settings' | 'goals' | 'tasks' | null
 */
export function weekReport(s, ws) {
  const we = addDays(ws, 7);
  const occs = expand(s, addDays(ws, -1), we);
  const inWeek = occs.filter((o) => o.end > ws && o.start < we);
  const items = [];
  const days = [...Array(7)].map((_, i) => addDays(ws, i));
  const onDay = (d, pred) => inWeek.filter((o) => fmtD(o.start) === fmtD(d) && pred(o));
  const st = s.settings;

  // 1. Cours importés
  const imported = inWeek.filter((o) => o.ev.source === 'import');
  if (!imported.length) items.push({ level: 'bad', title: 'Cours de la semaine non importés', detail: "Envoie la capture de ton EDT à Claude puis colle le résultat dans « Importer des cours ». Sans ça, les révisions en semaine ne sont pas placées.", action: 'import' });
  else items.push({ level: 'ok', title: `${imported.length} cours importés`, detail: '' });

  // 2. Sommeil
  const shortNights = [];
  for (const d of days) {
    const sleep = occs.filter((o) => o.catId === 'sommeil' && /sommeil/i.test(o.title) && fmtD(o.start) === fmtD(d)).reduce((t, o) => t + diffMin(o.start, o.end), 0);
    if (sleep < st.sleepTarget - 30) shortNights.push(`${DOW_LONG[isoDow(d)]} (${sleep ? fmtDur(sleep) : 'rien'})`);
  }
  items.push(shortNights.length
    ? { level: 'bad', title: 'Nuits trop courtes ou non planifiées', detail: `Objectif ${fmtDur(st.sleepTarget)} : ${shortNights.join(', ')}.`, action: 'plan' }
    : { level: 'ok', title: 'Sommeil planifié chaque nuit', detail: '' });

  // 3. Repas
  const missingMeals = [];
  for (const d of days) {
    const meals = onDay(d, (o) => catById(s, o.catId).group === 'repas');
    const lunch = meals.some((o) => o.start.getHours() < 15), dinner = meals.some((o) => o.start.getHours() >= 17);
    if (!lunch) missingMeals.push(`déjeuner ${DOW_LONG[isoDow(d)]}`);
    if (!dinner) missingMeals.push(`dîner ${DOW_LONG[isoDow(d)]}`);
  }
  if (missingMeals.length) items.push({ level: 'warn', title: 'Repas sans créneau', detail: missingMeals.join(', ') + '. Ajoute-les ou vérifie que tu peux manger pendant tes cours.', action: 'plan' });
  else items.push({ level: 'ok', title: 'Tous les repas sont planifiés', detail: '' });

  // 4. Sport
  const sportHabit = s.habits.find((h) => h.enabled && h.catId === 'sport' && h.type === 'weekly');
  const muscu = inWeek.filter((o) => o.catId === 'sport' && o.ev.source !== 'import').length;
  const target = sportHabit ? sportHabit.times : 3;
  if (muscu < target) items.push({ level: 'warn', title: `Sport : ${muscu}/${target} séances de musculation`, detail: 'Il manque des séances (en plus du sport du vendredi).', action: 'plan' });
  else items.push({ level: 'ok', title: `Sport : ${muscu} séances de musculation`, detail: '' });

  // 5. Objectifs perso
  for (const g of s.goals.filter((g) => g.active !== false && g.weeklyMinutes > 0)) {
    const m = inWeek.filter((o) => o.ev.goalId === g.id).reduce((t, o) => t + diffMin(o.start, o.end), 0);
    if (m < g.weeklyMinutes - 30) items.push({ level: 'warn', title: `${g.title} : ${fmtDur(m)} / ${fmtDur(g.weeklyMinutes)}`, detail: 'Pas assez de temps prévu cette semaine pour cet objectif.', action: 'plan' });
  }
  const persoOk = s.goals.filter((g) => g.active !== false && g.weeklyMinutes > 0).every((g) => inWeek.filter((o) => o.ev.goalId === g.id).reduce((t, o) => t + diffMin(o.start, o.end), 0) >= g.weeklyMinutes - 30);
  if (persoOk) items.push({ level: 'ok', title: 'Objectifs perso : temps prévu atteint', detail: '' });

  // 6. Révisions par matière prioritaire
  const rev = {};
  for (const o of inWeek.filter((o) => o.catId === 'revision' && o.subjectId)) rev[o.subjectId] = (rev[o.subjectId] || 0) + diffMin(o.start, o.end);
  const weak = s.subjects.filter((x) => x.revise && x.weight >= 3 && (rev[x.id] || 0) < 90).map((x) => `${x.name} (${fmtDur(rev[x.id] || 0)})`);
  if (weak.length) items.push({ level: imported.length ? 'warn' : 'info', title: 'Matières à rattraper peu révisées', detail: weak.join(', ') + ' — objectif au moins 1h30 chacune.', action: 'plan' });

  // 7. Surcharge
  const heavy = [];
  for (const d of days) {
    const work = onDay(d, (o) => ['cours', 'revision'].includes(o.catId)).reduce((t, o) => t + diffMin(o.start, o.end), 0);
    if (work > st.maxWorkPerDay) heavy.push(`${DOW_LONG[isoDow(d)]} (${fmtDur(work)})`);
  }
  if (heavy.length) items.push({ level: 'warn', title: 'Journées surchargées', detail: `Plus de ${fmtDur(st.maxWorkPerDay)} de cours + travail : ${heavy.join(', ')}.`, action: 'settings' });

  // 8. Marges
  const margins = inWeek.filter((o) => isSoft(s, o)).length;
  if (!margins && st.bufferPerDay > 0) items.push({ level: 'info', title: 'Aucune marge pour les imprévus', detail: "Lance « Organiser la semaine » pour en réserver.", action: 'plan' });

  // 9. Conflits
  const cf = conflicts(s, inWeek);
  if (cf.length) items.push({ level: 'bad', title: `${cf.length} conflit(s) d'horaires`, detail: cf.slice(0, 4).map(([a, b]) => `« ${a.title} » / « ${b.title} »`).join(' · '), action: 'conflicts' });

  // 10. Rangement, batch cooking
  for (const h of s.habits.filter((h) => h.enabled && ['menage', 'repas'].includes(catById(s, h.catId).group) && h.type === 'weekly')) {
    if (!inWeek.some((o) => o.title === h.title)) items.push({ level: 'warn', title: `« ${h.title} » absent cette semaine`, detail: '', action: 'plan' });
  }

  // 11. Informations manquantes
  const info = [];
  if (!st.toeflDate) info.push('la date de ta certification TOEFL (pour lancer l’entraînement 2 semaines avant)');
  const exams = s.subjects.filter((x) => x.revise && x.weight > 0);
  if (!exams.some((x) => x.examDate)) info.push('les dates de tes CC et partiels par matière (Réglages › Matières)');
  for (const h of s.habits.filter((h) => h.enabled && /confirmer/i.test(h.note || ''))) info.push(`${h.title} : ${h.note}`);
  for (const e of s.events.filter((e) => /confirmer/i.test(e.notes || '') && e.source !== 'auto')) info.push(`${e.title} : ${e.notes}`);
  for (const g of s.goals.filter((g) => g.active !== false && !g.due)) info.push(`une date limite pour « ${g.title} »`);
  if (info.length) items.push({ level: 'info', title: 'Informations à compléter', detail: info.join(' ; '), list: info, action: 'settings' });

  // 12. Tâches en retard
  const today = fmtD(new Date());
  const late = s.tasks.filter((t) => t.status !== 'terminé' && t.due && t.due < today);
  if (late.length) items.push({ level: 'bad', title: `${late.length} tâche(s) en retard`, detail: late.map((t) => t.title).join(', '), action: 'tasks' });

  const order = { bad: 0, warn: 1, info: 2, ok: 3 };
  items.sort((a, b) => order[a.level] - order[b.level]);
  return { items, groups: minutesByGroup(s, inWeek.filter((o) => !o.ev.skipped), ws, we), byCat: minutesByCat(s, inWeek, ws, we), conflicts: cf };
}

export { GROUPS };
