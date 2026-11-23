// Point d'entrée : navigation, tableau de bord, tâches, objectifs, bilan, réglages
import { state, load, mutate, subscribe, undo, canUndo, getSaveError, requestPersistence, resetAll } from './store.js';
import { esc, uid, fmtD, fmtDT, fmtTime, fmtHM, parseD, parseDT, addDays, addMin, dayStart, startOfWeek, startOfMonth, isoDow, sameDay, fmtDayLong, fmtDur, fmtHours, diffMin, DOW_LETTER, MONTHS, MONTHS_SHORT, DOW_SHORT } from './util.js';
import { expand, catById, subjectById, isSoft, findFreeSlot } from './model.js';
import { planWeek, applyPlan } from './planner.js';
import { weekReport, GROUPS } from './analysis.js';
import { exportBackup, exportICS } from './io.js';
import { renderGrid, renderMonth, renderList, calTitle, shiftCursor } from './calendar.js';
import { openEventEditor, openTaskEditor, openGoalEditor, openGoalProposals, openHabitEditor, openPlanDialog, openImportDialog, planTaskAuto, setEditorHooks, catOptions, daysPicker } from './editors.js';
import { ICON, openModal, toast, confirmDialog, closeAllModals } from './ui.js';

/* ---------- état de l'interface ---------- */
const UI_KEY = 'mon-planning-ui';
const ui = { view: 'today', calView: 'week', cursor: new Date(), taskFilter: 'actives', reviewWeek: null };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* */ }
ui.cursor = new Date();
// le dimanche après-midi, la vue semaine s'ouvre sur la semaine qui vient
if (isoDow(ui.cursor) === 7 && ui.cursor.getHours() >= 12 && ui.calView === 'week') ui.cursor = addDays(dayStart(ui.cursor), 1);
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, calView: ui.calView, taskFilter: ui.taskFilter })); } catch (e) { /* */ } };

const firstRun = load();
if (window.innerWidth <= 820 && ui.calView === 'week' && firstRun) ui.calView = '3day';

const app = {
  rerender: () => render(),
  goto(date, calView) { ui.cursor = date; if (calView) ui.calView = calView; ui.keepScroll = null; ui.keepScrollX = null; setView('calendar'); },
  shift(dir) { ui.cursor = shiftCursor(ui, dir); ui.keepScrollX = null; render(); },
  newEvent(draft) { openEventEditor({ draft }); },
  editOcc(o) { if (o) openEventEditor({ occ: o }); },
  editTask(id) { openTaskEditor(id); },
  undo() { const l = undo(); toast(l ? 'Action annulée' : 'Rien à annuler'); },
};
setEditorHooks({ goto: app.goto, undo: app.undo });

/* ---------- planning initial (première ouverture) ---------- */
if (state.meta.needsInitialPlan) {
  const target = new Date() < parseD('2026-11-23') ? parseD('2026-11-23') : startOfWeek(new Date());
  const plan = planWeek(state, target);
  mutate('Planning initial', (s) => { applyPlan(s, plan); s.meta.needsInitialPlan = false; }, { undoable: false });
  ui.cursor = target;
  ui.view = 'today';
}

/* ---------- thème ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = state.settings.theme;
  const dark = t === 'dark' || (t === 'auto' && mq.matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.querySelectorAll('meta[name=theme-color]').forEach((m) => m.setAttribute('content', dark ? '#16171a' : '#ffffff'));
}
mq.addEventListener('change', applyTheme);

/* ---------- navigation ---------- */
const NAV = [
  ['today', 'Aujourd’hui', ICON.home], ['calendar', 'Calendrier', ICON.cal], ['tasks', 'Tâches', ICON.check],
  ['goals', 'Objectifs', ICON.target], ['review', 'Bilan', ICON.pulse], ['settings', 'Réglages', ICON.gear],
];
function setView(v) {
  ui.view = v; saveUi();
  if (location.hash !== '#' + v) history.pushState(null, '', '#' + v);
  closeSidebar();
  render();
}
window.addEventListener('popstate', () => { const v = location.hash.slice(1); if (NAV.some((n) => n[0] === v)) { ui.view = v; render(); } });
const hv = location.hash.slice(1); if (NAV.some((n) => n[0] === hv)) ui.view = hv;

const $ = (sel, root = document) => root.querySelector(sel);
const sidebar = $('#sidebar'), topbar = $('#topbar'), view = $('#view'), tabbar = $('#tabbar'), fab = $('#fab');

function closeSidebar() { sidebar.classList.remove('open'); document.querySelector('.scrim')?.remove(); }
function openSidebar() {
  sidebar.classList.add('open');
  const s = document.createElement('div'); s.className = 'scrim'; s.onclick = closeSidebar; document.body.appendChild(s);
}

/* ===================== RENDU GÉNÉRAL ===================== */
function render() {
  applyTheme();
  document.documentElement.style.setProperty('--hour-h', (state.settings.hourHeight || 52) + 'px');
  renderSidebar();
  renderTabbar();
  const v = ui.view;
  if (v === 'calendar') renderCalendarView();
  else if (v === 'tasks') renderTasks();
  else if (v === 'goals') renderGoals();
  else if (v === 'review') renderReview();
  else if (v === 'settings') renderSettings();
  else renderToday();
}
subscribe(() => render());

function renderSidebar() {
  const s = state;
  const c = ui.cursor;
  const ms = startOfMonth(c), gs = startOfWeek(ms);
  const ws = startOfWeek(c), today = new Date();
  let mini = '<div class="mini-grid">' + [1, 2, 3, 4, 5, 6, 7].map((d) => `<div class="h">${DOW_LETTER[d]}</div>`).join('');
  for (let i = 0; i < 42; i++) {
    const d = addDays(gs, i);
    const inW = ui.view === 'calendar' && d >= ws && d < addDays(ws, 7) && ['week', '3day', 'day'].includes(ui.calView);
    mini += `<button data-mini="${fmtD(d)}" class="${d.getMonth() !== ms.getMonth() ? 'out' : ''} ${inW ? 'inweek' : ''} ${sameDay(d, today) ? 'today' : ''}">${d.getDate()}</button>`;
  }
  mini += '</div>';
  const err = getSaveError();
  const last = s.meta.lastSaved ? new Date(s.meta.lastSaved) : null;
  sidebar.innerHTML = `
    <div class="brand"><img src="icons/icon-192.png" alt=""> Mon Planning</div>
    <nav class="nav">${NAV.map(([k, l, i]) => `<button data-nav="${k}" class="${ui.view === k ? 'active' : ''}">${i}<span>${l}</span></button>`).join('')}</nav>
    <div class="mini side-section"><div class="mini-head"><button class="btn icon ghost sm" data-mm="-1">${ICON.left}</button><span style="text-transform:capitalize">${MONTHS[ms.getMonth()]} ${ms.getFullYear()}</span><button class="btn icon ghost sm" data-mm="1">${ICON.right}</button></div>${mini}</div>
    <div class="side-section"><h4>Catégories</h4><div class="cat-filter">${s.categories.map((ct) => `<label style="--c:${ct.color}"><input type="checkbox" data-cat="${ct.id}" ${s.settings.hiddenCats.includes(ct.id) ? '' : 'checked'}><span class="sw"></span><span>${esc(ct.name)}</span></label>`).join('')}</div></div>
    <div class="save-status ${err ? 'err' : ''}"><span class="dot"></span>${err ? 'Erreur de sauvegarde !' : `Sauvegardé${last ? ' à ' + fmtHM(last) : ''} sur cet appareil`}
      ${canUndo() ? `<button class="btn ghost sm" data-undo style="margin-left:auto" title="Annuler (Ctrl+Z)">${ICON.undo}</button>` : ''}</div>`;
  sidebar.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => setView(b.dataset.nav)));
  sidebar.querySelectorAll('[data-mini]').forEach((b) => (b.onclick = () => app.goto(parseD(b.dataset.mini), ui.calView === 'month' || ui.calView === 'list' ? 'day' : ui.calView)));
  sidebar.querySelectorAll('[data-mm]').forEach((b) => (b.onclick = () => { ui.cursor = new Date(c.getFullYear(), c.getMonth() + +b.dataset.mm, 1); renderSidebar(); if (ui.view === 'calendar') render(); }));
  sidebar.querySelectorAll('[data-cat]').forEach((i) => (i.onchange = () => mutate('Filtre', (st) => {
    const h = new Set(st.settings.hiddenCats); i.checked ? h.delete(i.dataset.cat) : h.add(i.dataset.cat); st.settings.hiddenCats = [...h];
  }, { undoable: false })));
  const u = sidebar.querySelector('[data-undo]'); if (u) u.onclick = app.undo;
}

function renderTabbar() {
  const tabs = [['today', 'Accueil', ICON.home], ['calendar', 'Agenda', ICON.cal], ['tasks', 'Tâches', ICON.check], ['goals', 'Objectifs', ICON.target], ['review', 'Bilan', ICON.pulse]];
  tabbar.innerHTML = tabs.map(([k, l, i]) => `<button data-tab="${k}" class="${ui.view === k ? 'active' : ''}">${i}<span>${l}</span></button>`).join('');
  tabbar.querySelectorAll('[data-tab]').forEach((b) => (b.onclick = () => setView(b.dataset.tab)));
  fab.innerHTML = ICON.plus;
  fab.classList.toggle('hidden', ui.view === 'settings');
}

function setTopbar(title, actionsHtml = '') {
  topbar.innerHTML = `<button class="btn icon ghost menu-btn" data-menu aria-label="Menu">${ICON.menu}</button><div class="title">${title}</div>${actionsHtml}`;
  topbar.querySelector('[data-menu]').onclick = openSidebar;
}

fab.onclick = () => {
  if (ui.view === 'tasks') return openTaskEditor();
  if (ui.view === 'goals') return openGoalEditor();
  const base = ui.view === 'calendar' ? dayStart(ui.cursor) : dayStart(new Date());
  let start = sameDay(base, new Date()) ? new Date(Math.ceil(Date.now() / 1800000) * 1800000) : addMin(base, 9 * 60);
  openEventEditor({ draft: { start, end: addMin(start, 60) } });
};

/* ===================== CALENDRIER ===================== */
function renderCalendarView() {
  const views = [['day', 'Jour', 'J'], ['3day', '3 jours', '3J'], ['week', 'Semaine', 'S'], ['month', 'Mois', 'M'], ['list', 'Liste', 'L']];
  const narrow = window.innerWidth <= 820;
  setTopbar(esc(calTitle(ui)), `
    <div class="cal-tools" style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">
      <button class="btn icon" data-prev aria-label="Précédent">${ICON.left}</button>
      <button class="btn sm" data-today>Aujourd’hui</button>
      <button class="btn icon" data-next aria-label="Suivant">${ICON.right}</button>
      <div class="seg">${views.map(([k, l, sh]) => `<button data-cv="${k}" class="${ui.calView === k ? 'active' : ''}">${narrow ? sh : l}</button>`).join('')}</div>
      <button class="btn primary sm" data-plan title="Organiser automatiquement la semaine">${ICON.sparkle}<span class="hide-m">Organiser</span></button>
    </div>`);
  topbar.querySelector('[data-prev]').onclick = () => app.shift(-1);
  topbar.querySelector('[data-next]').onclick = () => app.shift(1);
  topbar.querySelector('[data-today]').onclick = () => { ui.cursor = new Date(); ui.keepScroll = null; ui.keepScrollX = null; render(); };
  topbar.querySelectorAll('[data-cv]').forEach((b) => (b.onclick = () => { ui.calView = b.dataset.cv; ui.keepScrollX = null; saveUi(); render(); }));
  topbar.querySelector('[data-plan]').onclick = () => openPlanDialog(ui.cursor);
  if (ui.calView === 'month') renderMonth(view, ui, app);
  else if (ui.calView === 'list') renderList(view, ui, app);
  else renderGrid(view, ui, app);
}

/* ===================== AUJOURD'HUI ===================== */
function renderToday() {
  const s = state;
  const now = new Date(), today = dayStart(now);
  // le dimanche après-midi, on regarde déjà la semaine qui vient
  const ws = planningWeek(), we = addDays(ws, 7);
  ui.dashWeek = ws;
  const todayOcc = expand(s, today, addDays(today, 1)).filter((o) => !isSoft(s, o));
  const upcoming = expand(s, now, addDays(now, 7)).filter((o) => !isSoft(s, o) && catById(s, o.catId).group !== 'sommeil' && o.start > now);
  const current = todayOcc.filter((o) => o.start <= now && o.end > now && catById(s, o.catId).group !== 'sommeil');
  const next = upcoming[0];
  const rep = weekReport(s, ws);
  const h = now.getHours();
  const hello = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';

  setTopbar(`${hello} 👋`, `<button class="btn sm hide-m" data-new>${ICON.plus} Événement</button><button class="btn primary sm" data-plan>${ICON.sparkle}<span class="hide-m">Organiser ma semaine</span></button>`);
  topbar.querySelector('[data-plan]').onclick = () => openPlanDialog(ws);
  const nb = topbar.querySelector('[data-new]'); if (nb) nb.onclick = () => fab.onclick();

  const rel = (d) => { const m = diffMin(now, d); if (m < 60) return `dans ${m} min`; if (sameDay(d, now)) return `dans ${fmtDur(m)}`; if (sameDay(d, addDays(now, 1))) return `demain à ${fmtTime(d)}`; return `${DOW_SHORT[isoDow(d)]} ${d.getDate()} à ${fmtTime(d)}`; };

  // progression hebdo
  const prodGroups = ['etudes', 'sport', 'perso'];
  let pPlan = 0, pDone = 0;
  for (const g of prodGroups) { pPlan += rep.groups[g]?.planned || 0; pDone += rep.groups[g]?.done || 0; }
  const pct = pPlan ? Math.round((pDone / pPlan) * 100) : 0;
  const weekOcc = expand(s, ws, we);
  const revPlan = weekOcc.filter((o) => o.catId === 'revision').reduce((t, o) => t + diffMin(o.start, o.end), 0);
  const revDone = weekOcc.filter((o) => o.catId === 'revision' && o.end <= now && !o.ev.skipped).reduce((t, o) => t + diffMin(o.start, o.end), 0);
  const sportAll = weekOcc.filter((o) => o.catId === 'sport');
  const tasksWeek = s.tasks.filter((t) => t.due && t.due >= fmtD(ws) && t.due < fmtD(we));
  const backupOld = Date.now() - (s.settings.lastBackup || 0) > 7 * 864e5;

  // tâches prioritaires
  const P = { 'élevée': 0, 'moyenne': 1, 'faible': 2 };
  const prio = s.tasks.filter((t) => t.status !== 'terminé').sort((a, b) => P[a.priority] - P[b.priority] || (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 5);

  // temps par catégorie
  const groups = [...s.settings.groupOrder, 'libre'].filter((g) => rep.groups[g]);
  const maxG = Math.max(1, ...groups.map((g) => rep.groups[g].planned));
  const gColor = (g) => (s.categories.find((c) => c.group === g) || {}).color || '#888';

  const goals = s.goals.filter((g) => g.active !== false);
  const issues = rep.items.filter((i) => i.level !== 'ok').slice(0, 5);

  view.innerHTML = `<div class="page">
    ${backupOld ? `<div class="banner" style="margin:0 0 14px">💾 Tes données sont stockées sur cet appareil. Pense à exporter une sauvegarde (et à l’importer sur ton autre appareil).<button class="btn sm primary" data-backup style="margin-left:auto">Exporter</button></div>` : ''}
    <div class="page-head"><div><h1 style="text-transform:capitalize">${fmtDayLong(now)}</h1><p>${todayOcc.filter((o) => catById(s, o.catId).group === 'etudes').length} créneaux d’études aujourd’hui · ${rep.conflicts.length ? `<span style="color:var(--danger)">${rep.conflicts.length} conflit(s) cette semaine</span>` : 'aucun conflit cette semaine'}</p></div></div>
    <div class="cards">
      <div class="card span-4 next-card">
        <h2>${current.length ? 'En ce moment' : 'Prochain événement'}</h2>
        ${current.length ? current.map((o) => `<div class="when">jusqu’à ${fmtTime(o.end)}</div><div class="big">${esc(o.title)}</div><div class="progress" style="--c:${catById(s, o.catId).color}"><i style="width:${Math.round((diffMin(o.start, now) / diffMin(o.start, o.end)) * 100)}%"></i></div>`).join('<div style="height:10px"></div>') : ''}
        ${next ? `<div style="margin-top:${current.length ? 16 : 0}px">${current.length ? '<div class="small muted">Ensuite</div>' : ''}<div class="when">${rel(next.start)}</div><div class="big" style="${current.length ? 'font-size:16px' : ''}">${esc(next.title)}</div>
          <div class="muted small">${fmtTime(next.start)} – ${fmtTime(next.end)}${next.ev.location ? ' · ' + esc(next.ev.location) : ''}</div>
          <div style="margin-top:8px"><span class="pill" style="--c:${catById(s, next.catId).color}"><i></i>${esc(catById(s, next.catId).name)}</span></div></div>` : '<div class="empty">Rien de prévu dans les 7 prochains jours.</div>'}
      </div>
      <div class="card span-4">
        <h2>${ws > now ? 'Semaine qui vient' : 'Progression de la semaine'} <span class="pill">${pct}%</span></h2>
        <div class="progress" style="height:10px;margin-bottom:14px"><i style="width:${pct}%"></i></div>
        <div class="stat-row"><span class="lbl" style="--c:${catById(s, 'revision').color}"><i></i>Révisions</span><div class="progress" style="--c:${catById(s, 'revision').color}"><i style="width:${revPlan ? (revDone / revPlan) * 100 : 0}%"></i></div><span class="val">${fmtHours(revDone)} / ${fmtHours(revPlan)}</span></div>
        <div class="stat-row"><span class="lbl" style="--c:${catById(s, 'sport').color}"><i></i>Sport</span><div class="progress" style="--c:${catById(s, 'sport').color}"><i style="width:${sportAll.length ? (sportAll.filter((o) => o.end <= now && !o.ev.skipped).length / sportAll.length) * 100 : 0}%"></i></div><span class="val">${sportAll.filter((o) => o.end <= now && !o.ev.skipped).length} / ${sportAll.length} séances</span></div>
        ${['dessin', 'musique', 'video'].map((cid) => { const o = weekOcc.filter((x) => x.catId === cid && x.ev.goalId); const pl = o.reduce((t, x) => t + diffMin(x.start, x.end), 0); const dn = o.filter((x) => x.end <= now && !x.ev.skipped).reduce((t, x) => t + diffMin(x.start, x.end), 0); const c = catById(s, cid); return `<div class="stat-row"><span class="lbl" style="--c:${c.color}"><i></i>${esc(c.name)}</span><div class="progress" style="--c:${c.color}"><i style="width:${pl ? (dn / pl) * 100 : 0}%"></i></div><span class="val">${fmtHours(dn)} / ${fmtHours(pl)}</span></div>`; }).join('')}
        <div class="small muted" style="margin-top:6px">Tâches de la semaine : ${tasksWeek.filter((t) => t.status === 'terminé').length} / ${tasksWeek.length} terminées</div>
      </div>
      <div class="card span-4">
        <h2>Tâches prioritaires <button class="btn ghost sm" data-goto-tasks>Tout voir</button></h2>
        ${prio.length ? prio.map((t) => taskRow(t, true)).join('') : '<div class="empty">Aucune tâche en attente 🎉</div>'}
      </div>
      <div class="card span-5">
        <h2>Ma journée <button class="btn ghost sm" data-goto-day>Calendrier</button></h2>
        <div class="tl">${todayOcc.length ? todayOcc.map((o) => `<div class="tl-item ${o.end <= now ? 'past' : ''} ${o.start <= now && o.end > now ? 'now' : ''}" data-key="${esc(o.key)}" style="--c:${catById(s, o.catId).color}"><span class="h">${sameDay(o.start, today) ? fmtTime(o.start) : '…'}</span><span class="b"></span><div><div class="t">${esc(o.title)}</div><div class="s">${fmtTime(o.start)} – ${fmtTime(o.end)}${o.ev.location ? ' · ' + esc(o.ev.location) : ''}</div></div></div>`).join('') : '<div class="empty">Journée libre.</div>'}</div>
      </div>
      <div class="card span-7">
        <h2>Temps prévu par catégorie (semaine)</h2>
        <div class="stack" style="margin-bottom:14px">${groups.filter((g) => g !== 'sommeil').map((g) => `<i style="--c:${gColor(g)};width:${(rep.groups[g].planned / groups.filter((x) => x !== 'sommeil').reduce((t, x) => t + rep.groups[x].planned, 0)) * 100}%" title="${esc(GROUPS[g])}"></i>`).join('')}</div>
        ${groups.map((g) => `<div class="stat-row"><span class="lbl" style="--c:${gColor(g)}"><i></i>${esc(GROUPS[g] || g)}</span><div class="progress" style="--c:${gColor(g)};background:transparent"><i style="width:${(rep.groups[g].planned / maxG) * 100}%;opacity:.85"></i></div><span class="val">${fmtHours(rep.groups[g].planned)}</span></div>`).join('') || '<div class="empty">Rien de planifié.</div>'}
      </div>
      <div class="card span-6">
        <h2>Objectifs en cours <button class="btn ghost sm" data-goto-goals>Tout voir</button></h2>
        ${goals.map((g) => { const pl = weekOcc.filter((o) => o.ev.goalId === g.id).reduce((t, o) => t + diffMin(o.start, o.end), 0); const c = catById(s, g.catId); return `<div style="margin-bottom:12px;cursor:pointer" data-goal="${g.id}"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:5px"><b style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.title)}</b><span class="muted small" style="white-space:nowrap">${g.weeklyMinutes ? `${fmtHours(pl)} / ${fmtHours(g.weeklyMinutes)} cette sem.` : ''} · ${g.progress}%</span></div><div class="progress" style="--c:${c.color}"><i style="width:${g.progress}%"></i></div></div>`; }).join('') || '<div class="empty">Aucun objectif.</div>'}
      </div>
      <div class="card span-6">
        <h2>À compléter dans mon planning <button class="btn ghost sm" data-goto-review>Bilan complet</button></h2>
        <div class="checks">${issues.length ? issues.map(issueRow).join('') : '<div class="empty">Ta semaine est complète ✅</div>'}</div>
      </div>
    </div></div>`;
  bindCommon(view);
  const occByKey = new Map(todayOcc.map((o) => [o.key, o]));
  view.querySelectorAll('.tl-item').forEach((el) => (el.onclick = () => app.editOcc(occByKey.get(el.dataset.key))));
  view.querySelector('[data-goto-day]').onclick = () => app.goto(new Date(), 'day');
  view.querySelector('[data-goto-tasks]').onclick = () => setView('tasks');
  view.querySelector('[data-goto-goals]').onclick = () => setView('goals');
  view.querySelector('[data-goto-review]').onclick = () => setView('review');
  view.querySelectorAll('[data-goal]').forEach((el) => (el.onclick = () => openGoalEditor(el.dataset.goal)));
  const bk = view.querySelector('[data-backup]'); if (bk) bk.onclick = doBackup;
}

/** semaine « de travail » : le dimanche après-midi, on regarde déjà la semaine qui vient */
function planningWeek() { const now = new Date(); return isoDow(now) === 7 && now.getHours() >= 12 ? addDays(startOfWeek(now), 7) : startOfWeek(now); }

function doBackup() { exportBackup(state); mutate('backup', (s) => { s.settings.lastBackup = Date.now(); }, { undoable: false }); toast('Sauvegarde téléchargée'); }

function issueRow(i) {
  const sym = { bad: '!', warn: '!', info: 'i', ok: '✓' }[i.level];
  const act = { plan: 'Organiser', import: 'Importer', settings: 'Réglages', tasks: 'Tâches', conflicts: 'Voir', goals: 'Objectifs' }[i.action];
  const detail = i.list ? `<ul style="margin:4px 0 0;padding-left:18px">${i.list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : esc(i.detail);
  return `<div class="item"><span class="lvl ${i.level}">${sym}</span><div style="min-width:0"><div class="t">${esc(i.title)}</div>${i.detail || i.list ? `<div class="d">${detail}</div>` : ''}</div>${act && i.level !== 'ok' ? `<button class="btn sm a" data-act="${i.action}">${act}</button>` : ''}</div>`;
}

function bindCommon(root) {
  root.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => {
    const a = b.dataset.act;
    const wk = ui.view === 'review' && ui.reviewWeek ? ui.reviewWeek : ui.view === 'today' && ui.dashWeek ? ui.dashWeek : new Date();
    if (a === 'plan') openPlanDialog(wk);
    else if (a === 'import') openImportDialog();
    else if (a === 'settings') setView('settings');
    else if (a === 'tasks') setView('tasks');
    else if (a === 'goals') setView('goals');
    else if (a === 'conflicts') app.goto(wk, 'week');
  }));
  root.querySelectorAll('[data-tchk]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleTask(b.dataset.tchk); }));
  root.querySelectorAll('[data-topen]').forEach((b) => (b.onclick = () => openTaskEditor(b.dataset.topen)));
  root.querySelectorAll('[data-tplan]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); planTaskAuto(b.dataset.tplan); }));
}

function toggleTask(id) {
  mutate('Statut tâche', (s) => { const t = s.tasks.find((x) => x.id === id); t.status = t.status === 'terminé' ? 'à faire' : 'terminé'; });
}

function taskRow(t, compact = false) {
  const s = state;
  const late = t.due && t.due < fmtD(new Date()) && t.status !== 'terminé';
  const pcls = { 'élevée': 'high', 'moyenne': 'mid', 'faible': 'low' }[t.priority];
  const c = catById(s, t.catId);
  const sub = subjectById(s, t.subjectId);
  const planned = s.events.some((e) => e.taskId === t.id);
  return `<div class="task ${t.status === 'terminé' ? 'done' : ''}" ${compact ? 'style="border:0;padding:7px 0;margin:0;background:none"' : ''}>
    <button class="chk ${t.status === 'terminé' ? 'on' : t.status === 'en cours' ? 'mid' : ''}" data-tchk="${t.id}" aria-label="Terminer">${t.status === 'terminé' ? ICON.tick : ''}</button>
    <div class="grow" data-topen="${t.id}"><div class="tt">${esc(t.title)}</div>
      <div class="meta"><span class="pill ${pcls}">${esc(t.priority)}</span>${t.due ? `<span class="pill" style="${late ? 'color:var(--danger)' : ''}">📅 ${parseD(t.due).getDate()} ${MONTHS_SHORT[parseD(t.due).getMonth()]}${late ? ' · en retard' : ''}</span>` : ''}${t.estimate ? `<span class="pill">⏱ ${fmtDur(t.estimate)}</span>` : ''}${compact ? '' : `<span class="pill" style="--c:${c.color}"><i></i>${esc(sub ? sub.name : c.name)}</span>`}${planned ? '<span class="pill">🗓 planifiée</span>' : ''}</div></div>
    ${t.status !== 'terminé' && !compact ? `<button class="btn sm" data-tplan="${t.id}" title="Placer dans le prochain créneau libre">${ICON.sparkle}<span class="hide-m">Planifier</span></button>` : ''}</div>`;
}

/* ===================== TÂCHES ===================== */
function renderTasks() {
  const s = state;
  setTopbar('Tâches', `<button class="btn primary sm" data-new>${ICON.plus}<span class="hide-m">Nouvelle tâche</span></button>`);
  topbar.querySelector('[data-new]').onclick = () => openTaskEditor();
  const P = { 'élevée': 0, 'moyenne': 1, 'faible': 2 };
  const f = ui.taskFilter;
  let list = s.tasks.filter((t) => f === 'toutes' || (f === 'actives' ? t.status !== 'terminé' : t.status === f));
  if (ui.taskCat) list = list.filter((t) => t.catId === ui.taskCat);
  const sortBy = ui.taskSort || 'due';
  list.sort((a, b) => sortBy === 'prio' ? P[a.priority] - P[b.priority] || (a.due || '9999').localeCompare(b.due || '9999') : (a.due || '9999').localeCompare(b.due || '9999') || P[a.priority] - P[b.priority]);
  const groups = ['en cours', 'à faire', 'terminé'].map((st) => [st, list.filter((t) => t.status === st)]).filter(([, l]) => l.length);
  const quick = `<form class="task" data-quick style="padding:6px 8px"><span style="color:var(--faint);padding:0 4px">${ICON.plus}</span><input type="text" name="q" placeholder="Ajouter une tâche rapidement… (Entrée)" style="border:0;box-shadow:none;background:none;padding:0"></form>`;
  view.innerHTML = `<div class="page" style="max-width:860px">
    <div class="toolbar">
      <div class="seg">${[['actives', 'Actives'], ['à faire', 'À faire'], ['en cours', 'En cours'], ['terminé', 'Terminées'], ['toutes', 'Toutes']].map(([k, l]) => `<button data-tf="${k}" class="${f === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <select data-tcat style="width:auto;height:30px"><option value="">Toutes catégories</option>${catOptions(ui.taskCat || '', { includeLibre: false })}</select>
      <select data-tsort style="width:auto;height:30px"><option value="due" ${sortBy === 'due' ? 'selected' : ''}>Trier par échéance</option><option value="prio" ${sortBy === 'prio' ? 'selected' : ''}>Trier par priorité</option></select>
    </div>
    ${quick}
    ${groups.length ? groups.map(([st, l]) => `<div class="status-group"><h3>${st} · ${l.length}</h3>${l.map((t) => taskRow(t)).join('')}</div>`).join('') : '<div class="empty">Aucune tâche ici.</div>'}
    <p class="small faint" style="margin-top:18px">Astuce : « Planifier » place la tâche dans ton prochain créneau libre avant l’échéance. Les tâches de révision non planifiées sont aussi casées automatiquement dans tes blocs de travail lors de « Organiser la semaine ».</p>
  </div>`;
  if (!ui.taskCat) view.querySelector('[data-tcat]').value = '';
  view.querySelectorAll('[data-tf]').forEach((b) => (b.onclick = () => { ui.taskFilter = b.dataset.tf; saveUi(); render(); }));
  view.querySelector('[data-tcat]').onchange = (e) => { ui.taskCat = e.target.value; render(); };
  view.querySelector('[data-tsort]').onchange = (e) => { ui.taskSort = e.target.value; render(); };
  view.querySelector('[data-quick]').onsubmit = (e) => {
    e.preventDefault();
    const v = e.target.q.value.trim(); if (!v) return;
    mutate('Tâche', (st) => st.tasks.push({ id: uid(), title: v, due: '', priority: 'moyenne', estimate: 30, catId: ui.taskCat || 'revision', subjectId: '', status: 'à faire', notes: '' }));
    setTimeout(() => view.querySelector('[data-quick] input')?.focus(), 0);
  };
  bindCommon(view);
}

/* ===================== OBJECTIFS ===================== */
function renderGoals() {
  const s = state;
  setTopbar('Objectifs', `<button class="btn primary sm" data-new>${ICON.plus}<span class="hide-m">Nouvel objectif</span></button>`);
  topbar.querySelector('[data-new]').onclick = () => openGoalEditor();
  const ws = startOfWeek(new Date());
  const weekOcc = expand(s, ws, addDays(ws, 7));
  const pcls = { 'élevée': 'high', 'moyenne': 'mid', 'faible': 'low' };
  view.innerHTML = `<div class="page"><div class="goals">${s.goals.map((g) => {
    const c = catById(s, g.catId);
    const pl = weekOcc.filter((o) => o.ev.goalId === g.id).reduce((t, o) => t + diffMin(o.start, o.end), 0);
    const daysLeft = g.due ? Math.ceil((parseD(g.due) - dayStart(new Date())) / 864e5) : null;
    return `<div class="card goal" data-goal="${g.id}" style="--c:${c.color};${g.active === false ? 'opacity:.55' : ''}">
      <div style="display:flex;justify-content:space-between;gap:8px;align-items:flex-start"><div class="gt">${esc(g.title)}</div><span class="pill" style="--c:${c.color}"><i></i>${esc(c.name)}</span></div>
      ${g.desc ? `<div class="gd">${esc(g.desc)}</div>` : ''}
      <div class="gm"><span class="pill ${pcls[g.priority]}">${esc(g.priority)}</span>${g.due ? `<span class="pill">📅 ${parseD(g.due).getDate()} ${MONTHS_SHORT[parseD(g.due).getMonth()]} ${parseD(g.due).getFullYear()}${daysLeft != null ? ` · J-${daysLeft}` : ''}</span>` : '<span class="pill">sans date limite</span>'}${g.weeklyMinutes ? `<span class="pill">⏱ ${fmtDur(g.weeklyMinutes)}/sem.</span>` : ''}</div>
      <div><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px" class="muted"><span>Avancement</span><b style="color:var(--text)">${g.progress}%</b></div><div class="progress"><i style="width:${g.progress}%"></i></div></div>
      ${g.weeklyMinutes ? `<div class="small muted">Cette semaine : ${fmtHours(pl)} planifiées sur ${fmtHours(g.weeklyMinutes)}</div>` : ''}
      ${g.subtasks.length ? `<div class="sub">${g.subtasks.map((st) => `<label class="${st.done ? 'done' : ''}" data-stop><input type="checkbox" data-sub="${g.id}|${st.id}" ${st.done ? 'checked' : ''} style="accent-color:var(--accent)"><span>${esc(st.title)}</span></label>`).join('')}</div>` : ''}
      <div style="display:flex;gap:6px;margin-top:auto">${g.weeklyMinutes ? `<button class="btn sm" data-prop="${g.id}">${ICON.sparkle} Proposer des créneaux</button>` : ''}<button class="btn sm ghost" data-edit="${g.id}">Modifier</button></div>
    </div>`;
  }).join('') || '<div class="empty">Aucun objectif pour l’instant.</div>'}</div></div>`;
  view.querySelectorAll('[data-goal]').forEach((el) => (el.onclick = (e) => { if (e.target.closest('[data-stop],button')) return; openGoalEditor(el.dataset.goal); }));
  view.querySelectorAll('[data-edit]').forEach((b) => (b.onclick = () => openGoalEditor(b.dataset.edit)));
  view.querySelectorAll('[data-prop]').forEach((b) => (b.onclick = () => openGoalProposals(b.dataset.prop)));
  view.querySelectorAll('[data-sub]').forEach((i) => (i.onchange = () => {
    const [gid, sid] = i.dataset.sub.split('|');
    mutate('Sous-tâche', (s2) => {
      const g = s2.goals.find((x) => x.id === gid); const st = g.subtasks.find((x) => x.id === sid); st.done = i.checked;
      if (g.progressMode !== 'manual') g.progress = Math.round((g.subtasks.filter((x) => x.done).length / g.subtasks.length) * 100);
    });
  }));
}

/* ===================== BILAN ===================== */
function renderReview() {
  const s = state;
  const ws = startOfWeek(ui.reviewWeek || planningWeek());
  ui.reviewWeek = ws;
  const rep = weekReport(s, ws);
  const we = addDays(ws, 6);
  setTopbar(`Bilan · ${ws.getDate()}${ws.getMonth() !== we.getMonth() ? ' ' + MONTHS_SHORT[ws.getMonth()] : ''} – ${we.getDate()} ${MONTHS_SHORT[we.getMonth()]}`, `
    <button class="btn icon" data-prev>${ICON.left}</button><button class="btn sm hide-m" data-cur>Cette semaine</button><button class="btn icon" data-next>${ICON.right}</button>
    <button class="btn primary sm" data-plan>${ICON.sparkle}<span class="hide-m">Organiser</span></button>`);
  topbar.querySelector('[data-prev]').onclick = () => { ui.reviewWeek = addDays(ws, -7); render(); };
  topbar.querySelector('[data-next]').onclick = () => { ui.reviewWeek = addDays(ws, 7); render(); };
  topbar.querySelector('[data-cur]').onclick = () => { ui.reviewWeek = planningWeek(); render(); };
  topbar.querySelector('[data-plan]').onclick = () => openPlanDialog(ws);

  const gColor = (g) => (s.categories.find((c) => c.group === g) || {}).color || '#888';
  const targets = {
    sommeil: s.settings.sleepTarget * 7,
    sport: (s.habits.find((h) => h.catId === 'sport' && h.type === 'weekly' && h.enabled)?.times || 3) * 60 + 90,
    perso: s.goals.filter((g) => g.active !== false && catById(s, g.catId).group === 'perso').reduce((t, g) => t + g.weeklyMinutes, 0) + 7 * 15,
  };
  const order = [...s.settings.groupOrder, 'libre'];
  const cats = s.categories.filter((c) => rep.byCat[c.id]).sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
  const conf = rep.conflicts;
  view.innerHTML = `<div class="page"><div class="cards">
    <div class="card span-7"><h2>Ce qui manque ou pose problème</h2><div class="checks">${rep.items.map(issueRow).join('')}</div></div>
    <div class="card span-5"><h2>Temps prévu par catégorie</h2>
      ${order.filter((g) => rep.groups[g]).map((g) => { const pl = rep.groups[g].planned; const t = targets[g]; return `<div class="stat-row"><span class="lbl" style="--c:${gColor(g)}"><i></i>${esc(GROUPS[g])}</span><div class="progress" style="--c:${gColor(g)}"><i style="width:${t ? Math.min(100, (pl / t) * 100) : 100}%"></i></div><span class="val">${fmtHours(pl)}${t ? ` / ${fmtHours(t)}` : ''}</span></div>`; }).join('')}
      <h2 style="margin-top:18px">Détail</h2>
      ${cats.map((c) => `<div class="stat-row"><span class="lbl" style="--c:${c.color}"><i></i>${esc(c.name)}</span><span></span><span class="val">${fmtHours(rep.byCat[c.id])}</span></div>`).join('')}
    </div>
    ${conf.length ? `<div class="card span-12"><h2>Conflits d’horaires</h2>${conf.map(([a, b]) => `<div class="row" style="cursor:default"><span class="lvl bad">!</span><div class="main"><div class="t">${esc(a.title)} ↔ ${esc(b.title)}</div><div class="s" style="text-transform:capitalize">${fmtDayLong(a.start)} · ${fmtTime(a.start)}–${fmtTime(a.end)} / ${fmtTime(b.start)}–${fmtTime(b.end)}</div></div><button class="btn sm" data-ok="${esc(a.key)}">${esc(a.title.slice(0, 18))}</button><button class="btn sm" data-ok="${esc(b.key)}">${esc(b.title.slice(0, 18))}</button></div>`).join('')}
      <p class="small muted">Ex. compétition de volley le jeudi après-midi : garde la compétition et marque le cours « Pas fait / annulé » (il reste visible, barré) ou supprime-le.</p></div>` : ''}
  </div></div>`;
  bindCommon(view);
  const occ = new Map(conf.flat().map((o) => [o.key, o]));
  view.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => app.editOcc(occ.get(b.dataset.ok))));
}

/* ===================== RÉGLAGES ===================== */
let deferredInstall = null;
window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferredInstall = e; });

function getPath(obj, path) { return path.split('.').reduce((o, k) => (o == null ? o : o[k]), obj); }
function setPath(obj, path, val) { const ks = path.split('.'); const last = ks.pop(); const o = ks.reduce((a, k) => a[k], obj); o[last] = val; }

function renderSettings() {
  const s = state, st = s.settings;
  setTopbar('Réglages');
  const inp = (path, type = 'text', attrs = '') => {
    const v = getPath(s, path);
    if (type === 'checkbox') return `<input type="checkbox" data-set="${path}" data-type="bool" ${v ? 'checked' : ''} ${attrs}>`;
    return `<input type="${type}" data-set="${path}" data-type="${type === 'number' ? 'num' : 'str'}" value="${esc(v ?? '')}" ${attrs}>`;
  };
  const F = (label, html) => `<label class="field"><span>${label}</span>${html}</label>`;
  const win = (path) => `<div style="display:flex;gap:6px;align-items:center">${inp(path + '.0', 'time')}<span class="muted">→</span>${inp(path + '.1', 'time')}</div>`;
  const persoW = (key) => st.perso[key].map((w, i) => win(`settings.perso.${key}.${i}`)).join('');
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  view.innerHTML = `<div class="page settings">
    <section class="card set-sec"><h2>Affichage</h2><p>Plage horaire du calendrier, thème et vue par défaut.</p>
      <div class="set-grid">
        ${F('Début de journée (h)', inp('settings.dayStart', 'number', 'min="0" max="12"'))}
        ${F('Fin de journée (h)', inp('settings.dayEnd', 'number', 'min="13" max="24"'))}
        ${F('Hauteur d’une heure (px)', inp('settings.hourHeight', 'number', 'min="30" max="120" step="2"'))}
        ${F('Thème', `<select data-set="settings.theme" data-type="str">${[['auto', 'Automatique (système)'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<option value="${k}" ${st.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      </div>
      <label class="check-line" style="margin-top:12px">${inp('settings.monthHideRoutine', 'checkbox')} Masquer sommeil, repas et rangement dans la vue Mois</label>
    </section>

    <section class="card set-sec"><h2>Catégories</h2><p>Couleur, nom et famille (la famille sert aux priorités et aux statistiques).</p>
      <div class="list-edit">${s.categories.map((c) => `<div class="li"><input type="color" value="${c.color}" data-catset="${c.id}|color"><input type="text" value="${esc(c.name)}" data-catset="${c.id}|name">
        <select data-catset="${c.id}|group" style="width:auto">${Object.entries(GROUPS).map(([k, l]) => `<option value="${k}" ${c.group === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        ${c.system ? '<span class="btn icon ghost sm" style="visibility:hidden"></span>' : `<button class="btn icon ghost sm" data-catdel="${c.id}" title="Supprimer">${ICON.trash}</button>`}</div>`).join('')}</div>
      <button class="btn sm" data-catadd style="margin-top:10px">${ICON.plus} Nouvelle catégorie</button>
    </section>

    <section class="card set-sec"><h2>Matières</h2><p>Priorité de révision (3 = à rattraper) et date du prochain examen : plus l’examen approche, plus la matière reçoit de temps.</p>
      <div class="list-edit">${s.subjects.map((x) => `<div class="li"><input type="color" value="${x.color}" data-subset="${x.id}|color"><input type="text" value="${esc(x.name)}" data-subset="${x.id}|name">
        <select data-subset="${x.id}|weight" style="width:auto" title="Priorité">${[[0, 'Pas de révision'], [1, 'Priorité 1'], [2, 'Priorité 2'], [3, 'Priorité 3 (rattraper)']].map(([k, l]) => `<option value="${k}" ${+x.weight === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <input type="date" value="${esc(x.examDate || '')}" data-subset="${x.id}|examDate" style="width:auto" title="Prochain examen">
        <button class="btn icon ghost sm" data-subdel="${x.id}">${ICON.trash}</button></div>`).join('')}</div>
      <button class="btn sm" data-subadd style="margin-top:10px">${ICON.plus} Nouvelle matière</button>
    </section>

    <section class="card set-sec"><h2>Ordre de priorité</h2><p>Utilisé par l’organisation automatique quand tout ne rentre pas.</p>
      <div class="list-edit">${st.groupOrder.map((g, i) => `<div class="li"><b style="width:22px;color:var(--faint)">${i + 1}</b><span style="flex:1">${GROUPS[g]}</span><button class="btn icon ghost sm" data-gup="${i}" ${i === 0 ? 'disabled' : ''}>↑</button><button class="btn icon ghost sm" data-gdown="${i}" ${i === st.groupOrder.length - 1 ? 'disabled' : ''}>↓</button></div>`).join('')}</div>
    </section>

    <section class="card set-sec"><h2>Habitudes</h2><p>Routines placées automatiquement chaque semaine (sommeil, repas, sport, rangement…). Touche une ligne pour la modifier.</p>
      ${s.habits.map((h) => `<div class="habit-row ${h.enabled ? '' : 'off'}" data-habit="${h.id}" style="--c:${catById(s, h.catId).color}"><span class="dot"></span><div><div style="font-weight:500">${esc(h.title)}</div><div class="small muted">${habitSummary(h)}${h.note ? ' · ' + esc(h.note) : ''}</div></div><span class="small muted">${fmtDur(h.duration)}</span><span class="muted">›</span></div>`).join('')}
      <button class="btn sm" data-habadd style="margin-top:10px">${ICON.plus} Nouvelle habitude</button>
    </section>

    <section class="card set-sec"><h2>Organisation automatique</h2><p>Comment « Organiser la semaine » remplit tes journées.</p>
      <div class="set-grid">
        ${F('Travail en semaine', win('settings.work.weekday'))}
        ${F('Travail le samedi', win('settings.work.sat'))}
        ${F('Travail le dimanche', win('settings.work.sun'))}
        ${F('Bloc de révision max (min)', inp('settings.studyBlockMax', 'number', 'min="30" step="15"'))}
        ${F('Bloc de révision min (min)', inp('settings.studyBlockMin', 'number', 'min="15" step="15"'))}
        ${F('Pause entre deux blocs (min)', inp('settings.pauseMin', 'number', 'min="0" step="5"'))}
        ${F('Marge imprévus / jour (min)', inp('settings.bufferPerDay', 'number', 'min="0" step="15"'))}
        ${F('Max cours + travail / jour (min)', inp('settings.maxWorkPerDay', 'number', 'min="60" step="30"'))}
        ${F('Objectif sommeil (min)', inp('settings.sleepTarget', 'number', 'min="300" step="15"'))}
        ${F('Objectifs perso en semaine', persoW('weekday'))}
        ${F('Objectifs perso le week-end', persoW('weekend'))}
        ${F('Max objectifs perso / jour semaine (min)', inp('settings.perso.capWeekday', 'number', 'min="0" step="15"'))}
        ${F('Max objectifs perso / jour week-end (min)', inp('settings.perso.capWeekend', 'number', 'min="0" step="15"'))}
        ${F('Date de la certification TOEFL', inp('settings.toeflDate', 'date'))}
      </div>
      <div class="field" style="margin-top:12px"><span>Soirées gardées libres pour sortir (pas d’objectif perso le soir)</span>${daysPicker('freeEve', st.perso.freeEvenings || [])}</div>
      <label class="check-line" style="margin-top:12px">${inp('settings.studyOnlyIfCourses', 'checkbox')} Ne placer les révisions en semaine qu’une fois les cours importés</label>
      <label class="check-line" style="margin-top:8px">${inp('settings.autoNaps', 'checkbox')} Proposer une sieste de 20 min après le déjeuner si la nuit précédente fait moins de 7 h</label>
    </section>

    <section class="card set-sec"><h2>Données</h2><p>Tout est enregistré automatiquement sur cet appareil. Pour passer du PC au téléphone : exporte une sauvegarde ici, puis importe-la sur l’autre appareil.</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn primary" data-import>${ICON.upload} Importer des cours / une sauvegarde</button>
        <button class="btn" data-backup>${ICON.download} Exporter une sauvegarde (.json)</button>
        <button class="btn" data-ics>${ICON.cal} Exporter vers Google Agenda (.ics)</button>
      </div>
      <p class="small muted" style="margin-top:10px">Dernière sauvegarde exportée : ${st.lastBackup ? new Date(st.lastBackup).toLocaleString('fr-FR') : 'jamais'} · ${s.events.length} événements, ${s.tasks.length} tâches, ${s.goals.length} objectifs.</p>
      <div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--border)"><button class="btn danger sm" data-reset>Réinitialiser toutes les données</button></div>
    </section>

    <section class="card set-sec"><h2>Installer sur mon téléphone</h2>
      ${isStandalone ? '<p>✅ L’application est installée.</p>' : `<p><b>iPhone (Safari)</b> : bouton Partager › « Sur l’écran d’accueil ».<br><b>Android (Chrome)</b> : menu ⋮ › « Installer l’application ».<br><b>PC (Chrome / Edge)</b> : icône d’installation à droite de la barre d’adresse.</p>
      ${deferredInstall ? `<button class="btn primary" data-install>Installer maintenant</button>` : ''}`}
      <p class="small muted">Une fois installée, l’app s’ouvre en plein écran et fonctionne même sans connexion.</p>
    </section>
  </div>`;

  // champs génériques
  view.querySelectorAll('[data-set]').forEach((el) => el.addEventListener('change', () => {
    let v = el.dataset.type === 'bool' ? el.checked : el.dataset.type === 'num' ? +el.value : el.value;
    const path = el.dataset.set;
    if (path === 'settings.dayStart') v = Math.max(0, Math.min(v, st.dayEnd - 4));
    if (path === 'settings.dayEnd') v = Math.min(24, Math.max(v, st.dayStart + 4));
    mutate('Réglage', (s2) => setPath(s2, path, v));
  }));
  view.querySelectorAll('input[name=freeEve]').forEach((el) => el.addEventListener('change', () => mutate('Réglage', (s2) => { s2.settings.perso.freeEvenings = [...view.querySelectorAll('input[name=freeEve]:checked')].map((i) => +i.value); })));
  view.querySelectorAll('[data-catset]').forEach((el) => el.addEventListener('change', () => { const [id, k] = el.dataset.catset.split('|'); mutate('Catégorie', (s2) => { s2.categories.find((c) => c.id === id)[k] = el.value; }); }));
  view.querySelector('[data-catadd]').onclick = () => mutate('Catégorie', (s2) => s2.categories.push({ id: uid(), name: 'Nouvelle catégorie', color: '#0ea5e9', group: 'sorties' }));
  view.querySelectorAll('[data-catdel]').forEach((b) => (b.onclick = async () => {
    const id = b.dataset.catdel; const c = catById(s, id);
    const used = s.events.filter((e) => e.catId === id).length + s.tasks.filter((t) => t.catId === id).length;
    const fallback = s.categories.find((x) => x.group === c.group && x.id !== id) || s.categories.find((x) => x.id === 'libre');
    if (!(await confirmDialog(`Supprimer « ${esc(c.name)} » ?${used ? ` ${used} élément(s) passeront dans « ${esc(fallback.name)} ».` : ''}`, { ok: 'Supprimer', danger: true }))) return;
    mutate('Supprimer catégorie', (s2) => {
      s2.categories = s2.categories.filter((x) => x.id !== id);
      s2.events.forEach((e) => { if (e.catId === id) e.catId = fallback.id; });
      s2.tasks.forEach((t) => { if (t.catId === id) t.catId = fallback.id; });
      s2.goals.forEach((g) => { if (g.catId === id) g.catId = fallback.id; });
      s2.habits.forEach((h) => { if (h.catId === id) h.catId = fallback.id; });
    });
  }));
  view.querySelectorAll('[data-subset]').forEach((el) => el.addEventListener('change', () => {
    const [id, k] = el.dataset.subset.split('|');
    mutate('Matière', (s2) => { const x = s2.subjects.find((y) => y.id === id); x[k] = k === 'weight' ? +el.value : el.value; if (k === 'weight') x.revise = +el.value > 0; });
  }));
  view.querySelector('[data-subadd]').onclick = () => mutate('Matière', (s2) => s2.subjects.push({ id: uid(), name: 'Nouvelle matière', color: '#7c3aed', weight: 2, revise: true, examDate: '', aliases: [] }));
  view.querySelectorAll('[data-subdel]').forEach((b) => (b.onclick = async () => {
    if (!(await confirmDialog('Supprimer cette matière ? Les événements gardent leur titre.', { ok: 'Supprimer', danger: true }))) return;
    mutate('Supprimer matière', (s2) => { s2.subjects = s2.subjects.filter((x) => x.id !== b.dataset.subdel); s2.events.forEach((e) => { if (e.subjectId === b.dataset.subdel) e.subjectId = ''; }); });
  }));
  const swap = (i, j) => mutate('Priorités', (s2) => { const o = s2.settings.groupOrder; [o[i], o[j]] = [o[j], o[i]]; });
  view.querySelectorAll('[data-gup]').forEach((b) => (b.onclick = () => swap(+b.dataset.gup, +b.dataset.gup - 1)));
  view.querySelectorAll('[data-gdown]').forEach((b) => (b.onclick = () => swap(+b.dataset.gdown, +b.dataset.gdown + 1)));
  view.querySelectorAll('[data-habit]').forEach((el) => (el.onclick = () => openHabitEditor(el.dataset.habit)));
  view.querySelector('[data-habadd]').onclick = () => openHabitEditor();
  view.querySelector('[data-import]').onclick = openImportDialog;
  view.querySelector('[data-backup]').onclick = doBackup;
  view.querySelector('[data-ics]').onclick = () => { const a = startOfWeek(new Date()); exportICS(state, addDays(a, -7), addDays(a, 8 * 7)); toast('Fichier .ics téléchargé (semaine passée + 8 semaines)'); };
  view.querySelector('[data-reset]').onclick = async () => {
    if (!(await confirmDialog('Effacer toutes tes données et revenir à la configuration de départ ? Exporte une sauvegarde avant si besoin.', { ok: 'Tout réinitialiser', danger: true }))) return;
    resetAll(); toast('Données réinitialisées', { action: 'Annuler', onAction: app.undo });
  };
  const ins = view.querySelector('[data-install]');
  if (ins) ins.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); };
}

function habitSummary(h) {
  const days = h.days.length === 7 ? 'tous les jours' : h.days.slice().sort().map((d) => DOW_SHORT[d]).join(' ');
  if (h.type === 'fixed') return `${days} à ${h.start}`;
  if (h.type === 'weekly') return `${h.times}×/semaine (${days}) entre ${h.window[0]} et ${h.window[1]}${h.weekendWindow ? `, week-end ${h.weekendWindow[0]}–${h.weekendWindow[1]}` : ''}`;
  return `${days}, entre ${h.window[0]} et ${h.window[1]}`;
}

/* ---------- raccourcis clavier ---------- */
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select') || document.querySelector('.modal-bg')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); app.undo(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'n') { e.preventDefault(); fab.onclick(); }
  else if (ui.view === 'calendar') {
    if (k === 'arrowleft' || k === 'j') app.shift(-1);
    else if (k === 'arrowright' || k === 'k') app.shift(1);
    else if (k === 't') { ui.cursor = new Date(); render(); }
    else if ({ d: 'day', w: 'week', s: 'week', m: 'month', l: 'list', '3': '3day' }[k]) { ui.calView = { d: 'day', w: 'week', s: 'week', m: 'month', l: 'list', '3': '3day' }[k]; saveUi(); render(); }
  }
});

/* ---------- ligne « maintenant » + rafraîchissement ---------- */
setInterval(() => {
  if (document.querySelector('.modal-bg') || document.querySelector('.ev.dragging')) return;
  if (ui.view === 'today') render();
  else if (ui.view === 'calendar') { const line = document.querySelector('.now-line'); if (line) { const m = new Date().getHours() * 60 + new Date().getMinutes() - state.settings.dayStart * 60; line.style.top = (m / 60) * (state.settings.hourHeight || 52) + 'px'; } }
}, 60000);
let lastW = window.innerWidth;
window.addEventListener('resize', () => { if ((lastW <= 820) !== (window.innerWidth <= 820)) { lastW = window.innerWidth; render(); } });

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
requestPersistence();

render();
if (firstRun) setTimeout(() => toast('Bienvenue ! Ton planning de départ est prêt — regarde « À compléter ».', { duration: 6000 }), 400);
