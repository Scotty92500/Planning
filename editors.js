// Formulaires : événement, tâche, objectif, habitude, import, organisation de la semaine
import { state, mutate, replaceState } from './store.js';
import { esc, uid, fmtD, fmtHM, fmtDT, parseDT, parseD, addDays, addMin, diffMin, isoDow, DOW_LETTER, fmtDur, fmtDayLong, startOfWeek, dayStart, hm2min } from './util.js';
import { catById, findFreeSlot, expand } from './model.js';
import { planWeek, applyPlan, proposeGoalSlots } from './planner.js';
import { parseImport, applyCourses } from './io.js';
import { GROUPS } from './seed.js';
import { openModal, toast, confirmDialog, choiceDialog, ICON } from './ui.js';

let hooks = { goto: () => {}, undo: () => {} };
export const setEditorHooks = (h) => { hooks = { ...hooks, ...h }; };

/* ---------- champs réutilisables ---------- */
export function catOptions(sel, { includeLibre = true } = {}) {
  const groups = {};
  for (const c of state.categories) {
    if (!includeLibre && c.group === 'libre') continue;
    (groups[c.group] = groups[c.group] || []).push(c);
  }
  return Object.entries(groups).map(([g, cs]) => `<optgroup label="${esc(GROUPS[g] || g)}">${cs.map((c) => `<option value="${c.id}" ${c.id === sel ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</optgroup>`).join('');
}
export function subjectOptions(sel) {
  return `<option value="">— Aucune —</option>` + state.subjects.map((x) => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
}
export function daysPicker(name, days) {
  return `<div class="days-pick">${[1, 2, 3, 4, 5, 6, 7].map((d) => `<label><input type="checkbox" name="${name}" value="${d}" ${days.includes(d) ? 'checked' : ''}><span>${DOW_LETTER[d]}</span></label>`).join('')}</div>`;
}
const readDays = (m, name) => [...m.querySelectorAll(`input[name="${name}"]:checked`)].map((i) => +i.value);
const isStudyCat = (id) => catById(state, id).group === 'etudes';

/* ===================== ÉVÉNEMENT ===================== */
export function openEventEditor({ occ = null, draft = null }) {
  const s = state;
  const ev = occ ? occ.ev : null;
  const v = occ
    ? { title: ev.title, catId: ev.catId, subjectId: ev.subjectId || '', start: occ.start, end: occ.end, location: ev.location || '', notes: ev.notes || '', recur: ev.recur || null, skipped: !!ev.skipped, pinned: !!ev.pinned, source: ev.source }
    : { title: '', catId: 'revision', subjectId: '', location: '', notes: '', recur: null, ...draft };
  const r = v.recur || {};
  const freq = !v.recur ? 'none' : r.freq === 'weekly' && (r.interval || 1) === 2 ? 'biweekly' : r.freq;
  const recurDays = r.byDay && r.byDay.length ? r.byDay : [isoDow(v.start)];
  const isNew = !occ;
  const body = `
    <input class="title-input" name="title" placeholder="Titre de l’événement" value="${esc(v.title)}" autofocus>
    <div class="frow">
      <label class="field"><span>Catégorie</span><select name="catId">${catOptions(v.catId)}</select></label>
      <label class="field subj-f"><span>Matière</span><select name="subjectId">${subjectOptions(v.subjectId)}</select></label>
    </div>
    <div class="frow">
      <label class="field"><span>Date</span><input type="date" name="date" value="${fmtD(v.start)}"></label>
      <label class="field"><span>Début</span><input type="time" name="st" step="300" value="${fmtHM(v.start)}"></label>
      <label class="field"><span>Fin</span><input type="time" name="en" step="300" value="${fmtHM(v.end)}"></label>
    </div>
    <div class="muted small dur-info"></div>
    <div class="frow">
      <label class="field"><span>Répétition</span><select name="freq">
        <option value="none">Ne se répète pas</option><option value="daily">Chaque jour</option><option value="weekly">Chaque semaine</option>
        <option value="biweekly">Toutes les 2 semaines</option><option value="monthly">Chaque mois</option></select></label>
      <label class="field rec-f"><span>Jusqu’au (optionnel)</span><input type="date" name="until" value="${esc(r.until || '')}"></label>
    </div>
    <div class="rec-days rec-f">${daysPicker('rd', recurDays)}</div>
    <label class="field"><span>Lieu</span><input type="text" name="location" value="${esc(v.location)}" placeholder="Salle, adresse, lien…"></label>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(v.notes)}</textarea></label>
    ${!isNew && !v.recur ? `<label class="check-line"><input type="checkbox" name="skipped" ${v.skipped ? 'checked' : ''}> Pas fait / annulé (reste visible, barré)</label>` : ''}
    ${!isNew && v.source === 'auto' ? `<label class="check-line"><input type="checkbox" name="pinned" ${v.pinned ? 'checked' : ''}> Épingler (conservé lors des réorganisations automatiques)</label>` : ''}
    ${!isNew ? `<div class="faint small">${v.source === 'import' ? 'Cours importé' : v.source === 'auto' ? 'Placé automatiquement' : 'Ajouté manuellement'}${occ.occDate ? ' · occurrence d’une série' : ''}</div>` : ''}`;
  const foot = `${!isNew ? `<button class="btn danger" data-del>${ICON.trash} Supprimer</button><button class="btn" data-dup>${ICON.copy} Dupliquer</button>` : ''}<span class="sp"></span><button class="btn" data-close2>Annuler</button><button class="btn primary" data-save>Enregistrer</button>`;

  openModal({ title: isNew ? 'Nouvel événement' : 'Modifier l’événement', body, foot, onMount: (m, close) => {
    const f = (n) => m.querySelector(`[name="${n}"]`);
    f('freq').value = freq;
    const sync = () => {
      m.querySelector('.subj-f').style.display = isStudyCat(f('catId').value) ? '' : 'none';
      const fr = f('freq').value;
      m.querySelectorAll('.rec-f').forEach((x) => (x.style.display = fr === 'none' ? 'none' : ''));
      m.querySelector('.rec-days').style.display = fr === 'weekly' || fr === 'biweekly' ? '' : 'none';
      const a = hm2min(f('st').value), b = hm2min(f('en').value);
      const d = b > a ? b - a : b + 1440 - a;
      m.querySelector('.dur-info').textContent = `Durée : ${fmtDur(d)}${b <= a ? ' (se termine le lendemain)' : ''}`;
    };
    m.addEventListener('input', sync); sync();
    f('subjectId').addEventListener('change', () => {
      const sub = s.subjects.find((x) => x.id === f('subjectId').value);
      if (sub && !f('title').value.trim()) f('title').value = (f('catId').value === 'revision' ? 'Révisions · ' : '') + sub.name;
    });
    m.querySelector('[data-close2]').onclick = close;

    const read = () => {
      const date = parseD(f('date').value || fmtD(v.start));
      const start = addMin(date, hm2min(f('st').value));
      let end = addMin(date, hm2min(f('en').value));
      if (end <= start) end = addDays(end, 1);
      const fr = f('freq').value;
      const recur = fr === 'none' ? null : { freq: fr === 'biweekly' ? 'weekly' : fr, interval: fr === 'biweekly' ? 2 : 1, byDay: fr === 'weekly' || fr === 'biweekly' ? (readDays(m, 'rd').length ? readDays(m, 'rd') : [isoDow(start)]) : [], until: f('until').value || '' };
      return {
        title: f('title').value.trim() || catById(s, f('catId').value).name, catId: f('catId').value,
        subjectId: isStudyCat(f('catId').value) ? f('subjectId').value : '', start, end, recur,
        location: f('location').value.trim(), notes: f('notes').value.trim(),
        skipped: f('skipped') ? f('skipped').checked : false, pinned: f('pinned') ? f('pinned').checked : undefined,
      };
    };

    m.querySelector('[data-save]').onclick = async () => {
      const x = read();
      if (isNew) {
        mutate('Ajouter', (st) => st.events.push({ id: uid(), title: x.title, catId: x.catId, subjectId: x.subjectId, start: fmtDT(x.start), end: fmtDT(x.end), location: x.location, notes: x.notes, source: 'manual', recur: x.recur, exdates: [], goalId: v.goalId, taskId: v.taskId }));
        if (v.taskId) mutate('Tâche', (st) => { const t = st.tasks.find((t) => t.id === v.taskId); if (t && t.status === 'à faire') t.status = 'en cours'; }, { undoable: false });
        close(); toast('Événement ajouté', { action: 'Annuler', onAction: hooks.undo });
        return;
      }
      if (ev.recur) {
        const scope = await choiceDialog('Cet événement se répète.', [{ label: 'Seulement cette occurrence', value: 'one' }, { label: 'Toute la série', value: 'all' }]);
        if (!scope) return;
        mutate('Modifier', (st) => {
          const e = st.events.find((y) => y.id === ev.id);
          if (scope === 'one') {
            e.exdates = [...(e.exdates || []), occ.occDate];
            st.events.push({ id: uid(), title: x.title, catId: x.catId, subjectId: x.subjectId, start: fmtDT(x.start), end: fmtDT(x.end), location: x.location, notes: x.notes, source: 'manual', detachedFrom: e.id });
          } else {
            const ms = parseDT(e.start);
            const ns = new Date(ms.getFullYear(), ms.getMonth(), ms.getDate(), x.start.getHours(), x.start.getMinutes());
            Object.assign(e, { title: x.title, catId: x.catId, subjectId: x.subjectId, location: x.location, notes: x.notes, recur: x.recur, start: fmtDT(ns), end: fmtDT(addMin(ns, diffMin(x.start, x.end))) });
          }
        });
      } else {
        mutate('Modifier', (st) => {
          const e = st.events.find((y) => y.id === ev.id);
          Object.assign(e, { title: x.title, catId: x.catId, subjectId: x.subjectId, start: fmtDT(x.start), end: fmtDT(x.end), location: x.location, notes: x.notes, recur: x.recur, skipped: x.skipped || undefined });
          if (x.recur) e.exdates = [];
          if (e.source === 'auto') e.pinned = x.pinned === undefined ? true : x.pinned || (fmtDT(x.start) !== fmtDT(occ.start) || fmtDT(x.end) !== fmtDT(occ.end) || x.title !== ev.title);
        });
      }
      close(); toast('Modifications enregistrées', { action: 'Annuler', onAction: hooks.undo });
    };

    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (ev.recur) {
        const scope = await choiceDialog('Cet événement se répète.', [{ label: 'Seulement cette occurrence', value: 'one' }, { label: 'Cette occurrence et les suivantes', value: 'after' }, { label: 'Toute la série', value: 'all' }], 'Que veux-tu supprimer ?');
        if (!scope) return;
        mutate('Supprimer', (st) => {
          const e = st.events.find((y) => y.id === ev.id);
          if (scope === 'one') e.exdates = [...(e.exdates || []), occ.occDate];
          else if (scope === 'after') e.recur.until = fmtD(addDays(parseD(occ.occDate), -1));
          else st.events = st.events.filter((y) => y.id !== ev.id);
        });
      } else mutate('Supprimer', (st) => { st.events = st.events.filter((y) => y.id !== ev.id); });
      close(); toast('Événement supprimé', { action: 'Annuler', onAction: hooks.undo });
    };
    const dup = m.querySelector('[data-dup]');
    if (dup) dup.onclick = () => {
      const x = read(); close();
      openEventEditor({ draft: { ...x, recur: null } });
      toast('Copie : choisis la date puis enregistre');
    };
  } });
}

/* ===================== TÂCHE ===================== */
export function openTaskEditor(id = null, preset = {}) {
  const s = state;
  const t = id ? s.tasks.find((x) => x.id === id) : { title: '', due: '', priority: 'moyenne', estimate: 60, catId: 'revision', subjectId: '', status: 'à faire', notes: '', ...preset };
  const linked = id ? s.events.filter((e) => e.taskId === id) : [];
  const body = `
    <input class="title-input" name="title" placeholder="Nouvelle tâche" value="${esc(t.title)}" autofocus>
    <div class="frow">
      <label class="field"><span>Échéance</span><input type="date" name="due" value="${esc(t.due)}"></label>
      <label class="field"><span>Priorité</span><select name="priority">${['faible', 'moyenne', 'élevée'].map((p) => `<option ${p === t.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
      <label class="field"><span>Temps estimé (min)</span><input type="number" name="estimate" min="5" step="5" value="${t.estimate || ''}"></label>
    </div>
    <div class="frow">
      <label class="field"><span>Catégorie</span><select name="catId">${catOptions(t.catId, { includeLibre: false })}</select></label>
      <label class="field subj-f"><span>Matière</span><select name="subjectId">${subjectOptions(t.subjectId)}</select></label>
      <label class="field"><span>Statut</span><select name="status">${['à faire', 'en cours', 'terminé'].map((p) => `<option ${p === t.status ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <label class="field"><span>Notes</span><textarea name="notes" rows="2">${esc(t.notes || '')}</textarea></label>
    ${linked.length ? `<div class="small muted">Dans le calendrier : ${linked.map((e) => `${fmtDayLong(parseDT(e.start))} ${e.start.slice(11)}`).join(', ')}</div>` : ''}`;
  const foot = `${id ? `<button class="btn danger" data-del>${ICON.trash}</button>` : ''}
    <button class="btn" data-auto title="Trouver le prochain créneau libre">${ICON.sparkle} Planifier</button>
    <button class="btn" data-manual>${ICON.cal} Choisir le créneau</button>
    <span class="sp"></span><button class="btn primary" data-save>Enregistrer</button>`;
  openModal({ title: id ? 'Tâche' : 'Nouvelle tâche', body, foot, onMount: (m, close) => {
    const f = (n) => m.querySelector(`[name="${n}"]`);
    const sync = () => (m.querySelector('.subj-f').style.display = isStudyCat(f('catId').value) ? '' : 'none');
    f('catId').addEventListener('change', sync); sync();
    const read = () => ({ title: f('title').value.trim() || 'Tâche', due: f('due').value, priority: f('priority').value, estimate: +f('estimate').value || 0, catId: f('catId').value, subjectId: isStudyCat(f('catId').value) ? f('subjectId').value : '', status: f('status').value, notes: f('notes').value.trim() });
    const saveTask = () => {
      const x = read();
      let tid = id;
      mutate('Tâche', (st) => {
        if (id) Object.assign(st.tasks.find((y) => y.id === id), x);
        else { tid = uid(); st.tasks.push({ id: tid, ...x }); }
      });
      return { tid, x };
    };
    m.querySelector('[data-save]').onclick = () => { saveTask(); close(); toast('Tâche enregistrée'); };
    m.querySelector('[data-auto]').onclick = () => {
      const { tid, x } = saveTask();
      close();
      planTaskAuto(tid);
    };
    m.querySelector('[data-manual]').onclick = () => {
      const { tid, x } = saveTask();
      close();
      const dur = x.estimate || 60;
      const start = findFreeSlot(state, dur, roundUp(new Date())) || roundUp(new Date());
      openEventEditor({ draft: { title: x.title, catId: ['cours', 'visio'].includes(x.catId) ? 'revision' : x.catId, subjectId: x.subjectId, start, end: addMin(start, dur), taskId: tid } });
    };
    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog(`Supprimer la tâche « ${esc(t.title)} » ?`, { ok: 'Supprimer', danger: true }))) return;
      mutate('Supprimer tâche', (st) => { st.tasks = st.tasks.filter((y) => y.id !== id); });
      close(); toast('Tâche supprimée', { action: 'Annuler', onAction: hooks.undo });
    };
  } });
}
const roundUp = (d) => new Date(Math.ceil(d.getTime() / 900000) * 900000);

export function planTaskAuto(tid) {
  const t = state.tasks.find((x) => x.id === tid);
  if (!t) return;
  const dur = t.estimate || 60;
  const until = t.due ? addDays(parseD(t.due), 1) : null;
  const start = findFreeSlot(state, dur, roundUp(new Date()), until);
  if (!start) { toast(t.due ? 'Aucun créneau libre avant l’échéance — choisis-le à la main.' : 'Aucun créneau libre trouvé dans les 3 semaines.'); return; }
  mutate('Planifier tâche', (st) => {
    st.events.push({ id: uid(), title: t.title, catId: ['cours', 'visio'].includes(t.catId) ? 'revision' : t.catId, subjectId: t.subjectId || '', start: fmtDT(start), end: fmtDT(addMin(start, dur)), location: '', notes: t.notes || '', source: 'manual', taskId: t.id });
    const tt = st.tasks.find((x) => x.id === tid); if (tt.status === 'à faire') tt.status = 'en cours';
  });
  toast(`Planifié ${fmtDayLong(start)} à ${fmtHM(start)}`, { action: 'Voir', onAction: () => hooks.goto(start, 'day') });
}

/* ===================== OBJECTIF ===================== */
export function openGoalEditor(id = null) {
  const s = state;
  const g = id ? JSON.parse(JSON.stringify(s.goals.find((x) => x.id === id))) : { title: '', desc: '', catId: 'dessin', due: '', priority: 'moyenne', progress: 0, progressMode: 'auto', subtasks: [], weeklyMinutes: 120, sessionMin: 60, days: [1, 2, 3, 4, 5, 6, 7], when: 'auto', active: true };
  const subHtml = (st) => `<div class="li" data-sid="${st.id}"><input type="checkbox" ${st.done ? 'checked' : ''} style="width:16px;height:16px;accent-color:var(--accent)"><input type="text" value="${esc(st.title)}" placeholder="Sous-tâche"><button class="btn icon ghost sm" data-rm>${ICON.x}</button></div>`;
  const body = `
    <input class="title-input" name="title" placeholder="Nom de l’objectif" value="${esc(g.title)}" autofocus>
    <label class="field"><span>Description</span><textarea name="desc" rows="2">${esc(g.desc)}</textarea></label>
    <div class="frow">
      <label class="field"><span>Catégorie</span><select name="catId">${catOptions(g.catId, { includeLibre: false })}</select></label>
      <label class="field"><span>Date limite</span><input type="date" name="due" value="${esc(g.due)}"></label>
      <label class="field"><span>Priorité</span><select name="priority">${['faible', 'moyenne', 'élevée'].map((p) => `<option ${p === g.priority ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
    </div>
    <div class="field"><span>Avancement : <b class="pv">${g.progress}%</b></span>
      <input type="range" name="progress" min="0" max="100" step="5" value="${g.progress}">
      <label class="check-line"><input type="checkbox" name="pauto" ${g.progressMode !== 'manual' ? 'checked' : ''}> Calculer à partir des sous-tâches</label></div>
    <div class="field"><span>Sous-tâches</span><div class="list-edit subs">${g.subtasks.map(subHtml).join('')}</div><button class="btn sm" data-addsub style="align-self:flex-start">${ICON.plus} Ajouter</button></div>
    <div class="frow">
      <label class="field"><span>Temps par semaine (min)</span><input type="number" name="weekly" min="0" step="15" value="${g.weeklyMinutes}"></label>
      <label class="field"><span>Durée d’une séance (min)</span><input type="number" name="session" min="15" step="15" value="${g.sessionMin}"></label>
      <label class="field"><span>Moment préféré</span><select name="when">${[['auto', 'Automatique'], ['matin', 'Matin'], ['aprem', 'Après-midi'], ['soir', 'Soir']].map(([k, l]) => `<option value="${k}" ${g.when === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    <div class="field"><span>Jours possibles</span>${daysPicker('gd', g.days)}</div>
    <label class="check-line"><input type="checkbox" name="active" ${g.active !== false ? 'checked' : ''}> Objectif actif (pris en compte par l’organisation automatique)</label>
    <div class="faint small">Mettre 0 min/semaine pour un objectif suivi sans créneaux dédiés (ex. les révisions, déjà réparties par matière).</div>`;
  const foot = `${id ? `<button class="btn danger" data-del>${ICON.trash}</button><button class="btn" data-propose>${ICON.sparkle} Proposer des créneaux</button>` : ''}<span class="sp"></span><button class="btn primary" data-save>Enregistrer</button>`;
  openModal({ title: id ? 'Objectif' : 'Nouvel objectif', body, foot, wide: true, onMount: (m, close) => {
    const f = (n) => m.querySelector(`[name="${n}"]`);
    const subs = m.querySelector('.subs');
    const readSubs = () => [...subs.querySelectorAll('[data-sid]')].map((li) => ({ id: li.dataset.sid, title: li.querySelector('input[type=text]').value.trim(), done: li.querySelector('input[type=checkbox]').checked })).filter((x) => x.title);
    const syncProg = () => {
      const auto = f('pauto').checked;
      const ss = readSubs();
      if (auto && ss.length) f('progress').value = Math.round((ss.filter((x) => x.done).length / ss.length) * 100);
      f('progress').disabled = auto && ss.length > 0;
      m.querySelector('.pv').textContent = f('progress').value + '%';
    };
    m.addEventListener('input', syncProg); m.addEventListener('change', syncProg); syncProg();
    m.querySelector('[data-addsub]').onclick = () => { subs.insertAdjacentHTML('beforeend', subHtml({ id: uid(), title: '', done: false })); subs.lastElementChild.querySelector('input[type=text]').focus(); };
    subs.addEventListener('click', (e) => { if (e.target.closest('[data-rm]')) { e.target.closest('[data-sid]').remove(); syncProg(); } });
    const read = () => ({ title: f('title').value.trim() || 'Objectif', desc: f('desc').value.trim(), catId: f('catId').value, due: f('due').value, priority: f('priority').value, progress: +f('progress').value, progressMode: f('pauto').checked ? 'auto' : 'manual', subtasks: readSubs(), weeklyMinutes: +f('weekly').value || 0, sessionMin: +f('session').value || 60, when: f('when').value, days: readDays(m, 'gd'), active: f('active').checked });
    m.querySelector('[data-save]').onclick = () => {
      const x = read();
      mutate('Objectif', (st) => { if (id) Object.assign(st.goals.find((y) => y.id === id), x); else st.goals.push({ id: uid(), ...x }); });
      close(); toast('Objectif enregistré');
    };
    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('Supprimer cet objectif ? Les créneaux déjà placés restent dans le calendrier.', { ok: 'Supprimer', danger: true }))) return;
      mutate('Supprimer objectif', (st) => { st.goals = st.goals.filter((y) => y.id !== id); });
      close();
    };
    const pr = m.querySelector('[data-propose]');
    if (pr) pr.onclick = () => {
      const x = read();
      mutate('Objectif', (st) => Object.assign(st.goals.find((y) => y.id === id), x), { undoable: false });
      close();
      openGoalProposals(id);
    };
  } });
}

export function openGoalProposals(id, weekStart = startOfWeek(new Date())) {
  const g = state.goals.find((x) => x.id === id);
  let props = proposeGoalSlots(state, g, weekStart);
  if (!props.length) props = proposeGoalSlots(state, g, addDays(weekStart, 7));
  if (!props.length) { toast('Aucun créneau libre trouvé cette semaine ni la suivante.'); return; }
  const body = `<p style="margin:0;color:var(--muted)">Créneaux libres trouvés pour « ${esc(g.title)} » (${fmtDur(g.weeklyMinutes || 120)} visées). Décoche ceux que tu ne veux pas.</p>
    <div class="list-edit">${props.map((p, i) => `<label class="li check-line"><input type="checkbox" data-i="${i}" checked> <b style="text-transform:capitalize">${fmtDayLong(parseDT(p.start))}</b> <span class="muted">${p.start.slice(11)} – ${p.end.slice(11)}</span></label>`).join('')}</div>`;
  openModal({ title: 'Créneaux proposés', body, foot: '<span class="sp"></span><button class="btn primary" data-ok>Ajouter au calendrier</button>', onMount: (m, close) => {
    m.querySelector('[data-ok]').onclick = () => {
      const chosen = [...m.querySelectorAll('[data-i]:checked')].map((i) => props[+i.dataset.i]);
      mutate('Créneaux objectif', (st) => chosen.forEach((p) => st.events.push({ ...p, id: uid(), source: 'manual' })));
      close(); toast(`${chosen.length} créneau(x) ajouté(s)`, { action: 'Voir', onAction: () => hooks.goto(parseDT(chosen[0].start), 'week') });
    };
  } });
}

/* ===================== HABITUDE ===================== */
export function openHabitEditor(id = null) {
  const h = id ? state.habits.find((x) => x.id === id) : { title: '', catId: 'sport', type: 'flex', days: [1, 2, 3, 4, 5], start: '08:00', window: ['18:00', '21:00'], preferred: '18:30', duration: 60, minDuration: 60, times: 3, note: '', enabled: true };
  const body = `
    <input class="title-input" name="title" placeholder="Nom de l’habitude" value="${esc(h.title)}" autofocus>
    <div class="frow">
      <label class="field"><span>Catégorie</span><select name="catId">${catOptions(h.catId, { includeLibre: false })}</select></label>
      <label class="field"><span>Type</span><select name="type">
        <option value="fixed" ${h.type === 'fixed' ? 'selected' : ''}>Heure fixe</option>
        <option value="flex" ${h.type === 'flex' ? 'selected' : ''}>Flexible, chaque jour coché</option>
        <option value="weekly" ${h.type === 'weekly' ? 'selected' : ''}>X fois par semaine</option>
        <option value="with" ${h.type === 'with' ? 'selected' : ''}>En même temps qu’une autre habitude</option></select></label>
    </div>
    <label class="field t-with"><span>Pendant</span><select name="with">${[...new Set(state.habits.filter((x) => x.id !== id && x.type !== 'with').map((x) => x.title))].map((t) => `<option ${t === h.with ? 'selected' : ''}>${esc(t)}</option>`).join('')}</select></label>
    <div class="field"><span class="dlabel">Jours</span>${daysPicker('hd', h.days)}</div>
    <div class="frow">
      <label class="field t-fixed"><span>Heure de début</span><input type="time" name="start" value="${esc(h.start || '08:00')}"></label>
      <label class="field t-flex"><span>Fenêtre : de</span><input type="time" name="w0" value="${esc((h.window || ['08:00'])[0])}"></label>
      <label class="field t-flex"><span>à</span><input type="time" name="w1" value="${esc((h.window || ['', '20:00'])[1])}"></label>
      <label class="field t-flex"><span>Heure idéale</span><input type="time" name="pref" value="${esc(h.preferred || '')}"></label>
    </div>
    <div class="frow t-flex">
      <label class="field"><span>Fenêtre week-end : de (optionnel)</span><input type="time" name="ww0" value="${esc((h.weekendWindow || [''])[0])}"></label>
      <label class="field"><span>à</span><input type="time" name="ww1" value="${esc((h.weekendWindow || ['', ''])[1])}"></label>
    </div>
    <div class="frow">
      <label class="field"><span>Durée (min)</span><input type="number" name="duration" min="5" step="5" value="${h.duration}"></label>
      <label class="field"><span>Durée minimale acceptée</span><input type="number" name="minDuration" min="5" step="5" value="${h.minDuration || h.duration}"></label>
      <label class="field t-weekly"><span>Fois par semaine</span><input type="number" name="times" min="1" max="7" value="${h.times || 1}"></label>
    </div>
    <label class="field"><span>Note</span><input type="text" name="note" value="${esc(h.note || '')}"></label>
    <label class="check-line"><input type="checkbox" name="enabled" ${h.enabled ? 'checked' : ''}> Active</label>
    <div class="faint small">« Fenêtre » = plage dans laquelle l’organisation automatique cherche un créneau libre. Pour « X fois par semaine », les jours cochés sont essayés dans l’ordre en évitant deux jours d’affilée.</div>`;
  const foot = `${id ? `<button class="btn danger" data-del>${ICON.trash} Supprimer</button>` : ''}<span class="sp"></span><button class="btn primary" data-save>Enregistrer</button>`;
  openModal({ title: id ? 'Habitude' : 'Nouvelle habitude', body, foot, onMount: (m, close) => {
    const f = (n) => m.querySelector(`[name="${n}"]`);
    const sync = () => {
      const t = f('type').value;
      m.querySelectorAll('.t-fixed').forEach((x) => (x.style.display = t === 'fixed' ? '' : 'none'));
      m.querySelectorAll('.t-flex').forEach((x) => (x.style.display = t === 'flex' || t === 'weekly' ? '' : 'none'));
      m.querySelectorAll('.t-weekly').forEach((x) => (x.style.display = t === 'weekly' || t === 'with' ? '' : 'none'));
      m.querySelectorAll('.t-with').forEach((x) => (x.style.display = t === 'with' ? '' : 'none'));
      m.querySelector('.dlabel').textContent = t === 'weekly' ? 'Jours possibles' : t === 'fixed' ? 'Jours (jour où ça commence)' : 'Jours';
    };
    f('type').addEventListener('change', sync); sync();
    m.querySelector('[data-save]').onclick = () => {
      const t = f('type').value;
      const ordered = t === 'weekly' && id ? [...h.days.filter((d) => readDays(m, 'hd').includes(d)), ...readDays(m, 'hd').filter((d) => !h.days.includes(d))] : readDays(m, 'hd');
      const x = { title: f('title').value.trim() || 'Habitude', catId: f('catId').value, type: t, days: ordered, start: f('start').value, window: [f('w0').value || '08:00', f('w1').value || '20:00'], preferred: f('pref').value || f('w0').value, weekendWindow: f('ww0').value && f('ww1').value ? [f('ww0').value, f('ww1').value] : undefined, duration: +f('duration').value || 30, minDuration: Math.min(+f('minDuration').value || +f('duration').value, +f('duration').value), times: +f('times').value || 1, with: f('with').value || undefined, note: f('note').value.trim(), enabled: f('enabled').checked };
      mutate('Habitude', (st) => { if (id) Object.assign(st.habits.find((y) => y.id === id), x); else st.habits.push({ id: uid(), ...x }); });
      close(); toast('Habitude enregistrée — relance « Organiser la semaine » pour l’appliquer');
    };
    const del = m.querySelector('[data-del]');
    if (del) del.onclick = async () => {
      if (!(await confirmDialog('Supprimer cette habitude ?', { ok: 'Supprimer', danger: true }))) return;
      mutate('Supprimer habitude', (st) => { st.habits = st.habits.filter((y) => y.id !== id); });
      close();
    };
  } });
}

/* ===================== ORGANISER LA SEMAINE ===================== */
export function openPlanDialog(weekStart) {
  const ws = startOfWeek(weekStart);
  const plan = planWeek(state, ws);
  const kinds = {};
  for (const e of plan.add) { const g = catById(state, e.catId).name; kinds[g] = (kinds[g] || 0) + 1; }
  const body = `<p style="margin:0;line-height:1.5">Semaine du <b>${fmtDayLong(ws)}</b>.<br>
    <span class="muted">Tes cours, tes événements ajoutés à la main et les créneaux épinglés 📌 ne bougent pas. Les créneaux placés automatiquement auparavant sont recalculés.</span></p>
    <div class="card" style="padding:12px"><div><b>${plan.add.length}</b> créneaux proposés${plan.remove.length ? ` · <b>${plan.remove.length}</b> anciens créneaux automatiques remplacés` : ''}</div>
    <div class="small muted" style="margin-top:6px;line-height:1.6">${Object.entries(kinds).map(([k, n]) => `${esc(k)} : ${n}`).join(' · ')}</div></div>
    ${plan.warnings.length ? `<div class="checks">${plan.warnings.map((w) => `<div class="item"><span class="lvl warn">!</span><div class="d" style="margin:0">${esc(w)}</div></div>`).join('')}</div>` : ''}
    <div class="faint small">Ordre de priorité utilisé : ${state.settings.groupOrder.map((g) => GROUPS[g]).join(' › ')}. Modifiable dans Réglages.</div>`;
  openModal({ title: 'Organiser la semaine', body, foot: `<button class="btn" data-clear>Vider l’auto</button><span class="sp"></span><button class="btn" data-cancel>Annuler</button><button class="btn primary" data-ok>${ICON.sparkle} Appliquer</button>`, onMount: (m, close) => {
    m.querySelector('[data-cancel]').onclick = close;
    m.querySelector('[data-ok]').onclick = () => {
      mutate('Organiser la semaine', (st) => applyPlan(st, plan));
      close(); toast('Semaine organisée', { action: 'Annuler', onAction: hooks.undo });
      hooks.goto(ws, 'week');
    };
    m.querySelector('[data-clear]').onclick = () => {
      mutate('Vider auto', (st) => applyPlan(st, { add: [], remove: plan.remove }));
      close(); toast(`${plan.remove.length} créneaux automatiques retirés`, { action: 'Annuler', onAction: hooks.undo });
    };
  } });
}

/* ===================== IMPORT ===================== */
export function openImportDialog() {
  const example = `{"format":"edt-cours","events":[{"title":"Algèbre linéaire","kind":"TD","start":"2026-11-23T10:00","end":"2026-11-23T11:30","location":"NCHA-108"}]}`;
  const body = `<p style="margin:0;line-height:1.5">Charge le fichier <b>.ics</b> de ton emploi du temps, ou colle le bloc de texte que Claude t’a renvoyé à partir d’une capture. Une sauvegarde complète (<code>.json</code>) fonctionne aussi.</p>
    <textarea name="txt" rows="8" placeholder='${esc(example)}' style="font-family:ui-monospace,monospace;font-size:12px"></textarea>
    <div class="frow"><label class="btn" style="position:relative;overflow:hidden">${ICON.upload} Choisir un fichier<input type="file" accept=".ics,.json,text/calendar,application/json" style="position:absolute;inset:0;opacity:0;cursor:pointer"></label></div>
    <div class="frow"><label class="field"><span>Importer à partir du</span><input type="date" name="from" value="${fmtD(startOfWeek(new Date()))}"></label>
      <label class="field"><span>Jusqu’au (inclus, optionnel)</span><input type="date" name="to" value=""></label></div>
    <div class="faint small ics-info"></div>
    <label class="check-line"><input type="checkbox" name="replace" checked> Remplacer les cours déjà importés aux mêmes dates</label>
    <label class="check-line"><input type="checkbox" name="plan" checked> Réorganiser automatiquement la semaine après l’import</label>`;
  openModal({ title: 'Importer des cours', body, foot: '<span class="sp"></span><button class="btn primary" data-ok>Importer</button>', onMount: (m, close) => {
    const ta = m.querySelector('textarea');
    const info = m.querySelector('.ics-info');
    const preview = () => {
      try {
        const r = parseImport(ta.value);
        if (r.kind !== 'courses') { info.textContent = 'Sauvegarde complète détectée.'; return; }
        const ds = r.events.map((e) => e.start.slice(0, 10)).sort();
        info.textContent = `${r.events.length} cours trouvés, du ${ds[0].split('-').reverse().join('/')} au ${ds[ds.length - 1].split('-').reverse().join('/')}.`;
      } catch (err) { info.textContent = ta.value.trim() ? err.message : ''; }
    };
    ta.addEventListener('input', preview);
    m.querySelector('input[type=file]').addEventListener('change', async (e) => { const file = e.target.files[0]; if (file) { ta.value = await file.text(); preview(); } });
    m.querySelector('[data-ok]').onclick = async () => {
      let res;
      try { res = parseImport(ta.value); } catch (err) { toast(err.message, { duration: 6000 }); return; }
      if (res.kind === 'backup') {
        if (!(await confirmDialog('Ce fichier est une <b>sauvegarde complète</b>. Elle va remplacer toutes les données de cet appareil. Continuer ?', { ok: 'Remplacer', danger: true }))) return;
        replaceState(res.state); close(); toast('Sauvegarde restaurée', { action: 'Annuler', onAction: hooks.undo });
        return;
      }
      const replace = m.querySelector('[name=replace]').checked;
      const doPlan = m.querySelector('[name=plan]').checked;
      const from = m.querySelector('[name=from]').value, to = m.querySelector('[name=to]').value;
      const events = res.events.filter((e) => (!from || e.start.slice(0, 10) >= from) && (!to || e.start.slice(0, 10) <= to));
      if (!events.length) { toast('Aucun cours dans la période choisie.'); return; }
      let info;
      mutate('Import cours', (st) => { info = applyCourses(st, events, replace); });
      close();
      if (!info.added) { toast('Aucun cours valide trouvé dans le texte.'); return; }
      const weeks = [...new Set(info.dates.map((d) => fmtD(startOfWeek(parseD(d)))))];
      if (doPlan) {
        for (const w of weeks.slice(0, 10)) {
          const ws = parseD(w);
          if (addDays(ws, 7) < dayStart(new Date())) continue; // ne réorganise pas une semaine passée
          const plan = planWeek(state, ws);
          mutate('Organiser', (st) => applyPlan(st, plan), { undoable: false });
        }
      }
      toast(`${info.added} cours importés${info.removed ? ` (${info.removed} remplacés)` : ''}${doPlan ? ' · semaine réorganisée' : ''}`, { action: 'Annuler', onAction: hooks.undo, duration: 6000 });
      hooks.goto(parseD(info.dates[0]), 'week');
    };
  } });
}
