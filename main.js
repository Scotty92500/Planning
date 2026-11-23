// Point d'entrée : navigation, tableau de bord, tâches, objectifs, bilan, réglages
import { state, load, mutate, subscribe, undo, canUndo, getSaveError, requestPersistence, resetAll } from './store.js';
import { esc, uid, fmtD, fmtDT, fmtTime, fmtHM, parseD, parseDT, addDays, addMin, dayStart, startOfWeek, startOfMonth, isoDow, sameDay, fmtDayLong, fmtDur, fmtHours, diffMin, DOW_LETTER, MONTHS, MONTHS_SHORT, DOW_SHORT } from './util.js';
import { expand, catById, subjectById, isSoft, findFreeSlot, isDone, isMissed } from './model.js';
import { planWeek, applyPlan } from './planner.js';
import { weekReport, GROUPS } from './analysis.js';
import { exportBackup, exportICS, applyCourses, isVisio } from './io.js';
import { connect, disconnect, syncNow, syncConfigured, syncStatus, onSyncStatus } from './sync.js';
import { defaultCategories, routineHabits } from './seed.js';
import { SEED_COURSES } from './seed-courses.js';
import { renderGrid, renderMonth, renderList, renderChecklist, calTitle, shiftCursor, toggleDone } from './calendar.js';
import { openEventEditor, openTaskEditor, openGoalEditor, openGoalProposals, openHabitEditor, openPlanDialog, openImportDialog, planTaskAuto, setEditorHooks, catOptions, daysPicker } from './editors.js';
import { ICON, openModal, toast, confirmDialog, closeAllModals } from './ui.js';

/* ---------- état de l'interface ---------- */
const UI_KEY = 'mon-planning-ui';
const ui = { view: 'today', calView: 'week', cursor: new Date(), taskFilter: 'actives', reviewWeek: null };
try { Object.assign(ui, JSON.parse(localStorage.getItem(UI_KEY) || '{}')); } catch (e) { /* */ }
ui.cursor = new Date();
// le dimanche après-midi, la vue semaine s'ouvre sur la semaine qui vient
if (isoDow(ui.cursor) === 7 && ui.cursor.getHours() >= 12 && ui.calView === 'week') ui.cursor = addDays(dayStart(ui.cursor), 1);
const saveUi = () => { try { localStorage.setItem(UI_KEY, JSON.stringify({ view: ui.view, calView: ui.calView, taskFilter: ui.taskFilter, v2: true })); } catch (e) { /* */ } };

const firstRun = load();
if (!ui.v2) { ui.calView = 'week'; ui.v2 = true; }

const app = {
  rerender: () => render(),
  goto(date, calView) { ui.cursor = date; if (calView) ui.calView = calView; if (calView === 'day') ui.dayMode = 'list'; ui.keepScroll = null; ui.keepScrollX = null; setView('calendar'); },
  shift(dir) { ui.cursor = shiftCursor(ui, dir); ui.keepScrollX = null; render(); },
  newEvent(draft) { openEventEditor({ draft }); },
  editOcc(o) { if (o) openEventEditor({ occ: o }); },
  editTask(id) { openTaskEditor(id); },
  undo() { const l = undo(); toast(l ? 'Action annulée' : 'Rien à annuler'); },
};
setEditorHooks({ goto: app.goto, undo: app.undo });

/* ---------- planning initial (première ouverture) ---------- */
if (state.meta.needsInitialPlan) {
  // cours issus de l'emploi du temps .ics, puis organisation des semaines jusqu'aux partiels
  mutate('Cours initiaux', (s) => { applyCourses(s, SEED_COURSES, true); }, { undoable: false });
  const target = new Date() < parseD('2026-11-23') ? parseD('2026-11-23') : startOfWeek(new Date());
  for (let w = target; w <= parseD('2027-01-04'); w = addDays(w, 7)) {
    const plan = planWeek(state, w);
    mutate('Planning initial', (s) => applyPlan(s, plan), { undoable: false });
  }
  mutate('init', (s) => { s.meta.needsInitialPlan = false; }, { undoable: false });
  ui.cursor = target;
  ui.view = 'today';
}

/* ---------- mise à jour v2 d'une installation existante ---------- */
if (!state.meta.v2 && !state.meta.needsInitialPlan) {
  mutate('Mise à jour v2', (s) => {
    const defs = defaultCategories();
    const after = { visio: 'cours', petitdej: null, hygiene: null, lessive: null };
    for (const id of ['visio', 'petitdej', 'hygiene', 'lessive']) {
      if (s.categories.some((c) => c.id === id)) continue;
      const def = defs.find((c) => c.id === id);
      if (!def) continue; // catégorie fusionnée depuis (v3)
      const anchor = after[id] ? s.categories.findIndex((c) => c.id === after[id]) : s.categories.findIndex((c) => c.id === (id === 'petitdej' ? 'repas' : 'menage'));
      s.categories.splice(anchor >= 0 ? anchor + (after[id] ? 1 : 0) : s.categories.length, 0, def);
    }
    const cours = s.categories.find((c) => c.id === 'cours');
    if (cours) { if (cours.name === 'Cours') cours.name = 'Cours en présentiel'; if (cours.color === '#4f7cff') cours.color = '#7cb342'; }
    const rev = s.categories.find((c) => c.id === 'revision'); if (rev && rev.color === '#16a34a') rev.color = '#4f7cff';
    const vid = s.categories.find((c) => c.id === 'video'); if (vid && vid.color === '#f97316') vid.color = '#14b8a6';
    for (const e of s.events) {
      if (e.source !== 'import' || e.catId !== 'cours') continue;
      const kind = (e.title.match(/\[(\w+)\]\s*$/) || [])[1] || '';
      if (isVisio(e, kind)) e.catId = 'visio';
    }
    for (const h of routineHabits()) if (!s.habits.some((x) => x.title === h.title)) s.habits.unshift(h);
    const today = startOfWeek(new Date());
    const lastImport = s.events.filter((e) => e.source === 'import').map((e) => e.start).sort().pop();
    const end = lastImport ? startOfWeek(parseD(lastImport.slice(0, 10))) : today;
    for (let w = today, n = 0; w <= end && n < 8; w = addDays(w, 7), n++) applyPlan(s, planWeek(s, w));
    s.meta.v2 = true;
  }, { undoable: false });
  setTimeout(() => toast('Mise à jour : cours visio en orange, petit-déj, douche et lessive ajoutés à ton planning.', { duration: 7000 }), 500);
}

/* ---------- mise à jour v3 : palette, regroupements, 7h–23h, style verre clair ---------- */
if (!state.meta.v3 && !state.meta.needsInitialPlan) {
  mutate('Mise à jour v3', (s) => {
    const defs = defaultCategories();
    const remap = { volley: 'sport', petitdej: 'repas' };
    for (const k of ['events', 'tasks', 'goals', 'habits']) for (const x of s[k]) if (remap[x.catId]) x.catId = remap[x.catId];
    s.events = s.events.filter((e) => e.catId !== 'libre');
    const keep = s.categories.filter((c) => !['volley', 'petitdej', 'libre'].includes(c.id));
    for (const c of keep) {
      const d = defs.find((x) => x.id === c.id);
      if (d) { c.color = d.color; if (['sport', 'bde', 'cours', 'visio'].includes(c.id)) c.name = d.name; c.group = d.group; }
    }
    const order = defs.map((c) => c.id);
    keep.sort((a, b) => (order.indexOf(a.id) < 0 ? 99 : order.indexOf(a.id)) - (order.indexOf(b.id) < 0 ? 99 : order.indexOf(b.id)));
    for (const d of defs) if (!keep.some((c) => c.id === d.id)) keep.push(d);
    s.categories = keep;
    s.settings.hiddenCats = s.settings.hiddenCats.filter((id) => keep.some((c) => c.id === id));
    Object.assign(s.settings, { dayEnd: 23, bufferPerDay: 0, visualStyle: 'glass-light', weekRoutines: 'thin' });
    // redistribue le temps des anciennes marges (semaine en cours et suivantes)
    const today = startOfWeek(new Date());
    const lastImport = s.events.filter((e) => e.source === 'import').map((e) => e.start).sort().pop();
    const end = lastImport ? startOfWeek(parseD(lastImport.slice(0, 10))) : today;
    for (let w = today, n = 0; w <= end && n < 8; w = addDays(w, 7), n++) applyPlan(s, planWeek(s, w));
    s.meta.v3 = true;
  }, { undoable: false });
  setTimeout(() => toast('Nouveau style : verre clair, nouvelles couleurs, catégories regroupées, journée de 7h à 23h.', { duration: 7000 }), 900);
}

/* ---------- mise à jour v4 : temps visés par défaut ---------- */
if (!state.meta.v4 && !state.meta.needsInitialPlan) {
  mutate('Mise à jour v4', (s) => {
    for (const d of defaultCategories()) { const c = s.categories.find((x) => x.id === d.id); if (c && d.weeklyTarget && c.weeklyTarget == null) c.weeklyTarget = d.weeklyTarget; }
    s.meta.v4 = true;
  }, { undoable: false });
}

/* ---------- thème ---------- */
const mq = window.matchMedia('(prefers-color-scheme: dark)');
function applyTheme() {
  const t = state.settings.theme;
  const vs = state.settings.visualStyle || 'classic';
  document.documentElement.dataset.style = vs;
  const dark = vs === 'glass-dark' || (vs !== 'glass-light' && vs !== 'glass-soft' && (t === 'dark' || (t === 'auto' && mq.matches)));
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
    <div class="save-status ${err || syncStatus().state === 'error' ? 'err' : ''}" data-syncline style="cursor:pointer"><span class="dot"></span>${err ? 'Erreur de sauvegarde !' : syncLabel(last)}
      ${canUndo() ? `<button class="btn ghost sm" data-undo style="margin-left:auto" title="Annuler (Ctrl+Z)">${ICON.undo}</button>` : ''}</div>`;
  sidebar.querySelectorAll('[data-nav]').forEach((b) => (b.onclick = () => setView(b.dataset.nav)));
  sidebar.querySelectorAll('[data-mini]').forEach((b) => (b.onclick = () => app.goto(parseD(b.dataset.mini), ui.calView === 'month' || ui.calView === 'list' ? 'day' : ui.calView)));
  sidebar.querySelectorAll('[data-mm]').forEach((b) => (b.onclick = () => { ui.cursor = new Date(c.getFullYear(), c.getMonth() + +b.dataset.mm, 1); renderSidebar(); if (ui.view === 'calendar') render(); }));
  sidebar.querySelectorAll('[data-cat]').forEach((i) => (i.onchange = () => mutate('Filtre', (st) => {
    const h = new Set(st.settings.hiddenCats); i.checked ? h.delete(i.dataset.cat) : h.add(i.dataset.cat); st.settings.hiddenCats = [...h];
  }, { undoable: false })));
  const u = sidebar.querySelector('[data-undo]'); if (u) u.onclick = (e) => { e.stopPropagation(); app.undo(); };
  sidebar.querySelector('[data-syncline]').onclick = () => (syncConfigured() ? syncNow() : setView('settings'));
}

function syncLabel(last) {
  if (!syncConfigured()) return `Sauvegardé${last ? ' à ' + fmtHM(last) : ''} · non synchronisé`;
  const st = syncStatus();
  if (st.state === 'syncing') return 'Synchronisation…';
  if (st.state === 'error') return 'Synchro en erreur — toucher pour réessayer';
  if (st.state === 'offline') return 'Hors ligne — synchro en attente';
  return `Synchronisé${st.at ? ' à ' + fmtHM(new Date(st.at)) : ''} ☁️`;
}
onSyncStatus(() => { renderSidebar(); if (ui.view === 'settings' && !document.querySelector('.modal-bg')) { const el = document.querySelector('[data-syncstate]'); if (el) el.innerHTML = syncStateHtml(); } });
function syncStateHtml() {
  const st = syncStatus();
  if (!syncConfigured()) return '<span class="pill">Non connecté</span>';
  const map = { ok: ['low', 'Synchronisé'], syncing: ['mid', 'Synchronisation…'], error: ['high', 'Erreur'], offline: ['mid', 'Hors ligne'], off: ['', 'Non connecté'] };
  const [c, l] = map[st.state] || map.off;
  return `<span class="pill ${c}">${l}${st.at ? ' · ' + fmtHM(new Date(st.at)) : ''}</span>${st.msg ? ` <span class="small muted">${esc(st.msg)}</span>` : ''}`;
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
  const narrow = window.innerWidth <= 820;
  const views = narrow ? [['day', 'J'], ['week', 'S'], ['month', 'M'], ['list', 'L']] : [['day', 'Jour'], ['3day', '3 jours'], ['week', 'Semaine'], ['month', 'Mois'], ['list', 'Liste']];
  if (narrow && ui.calView === '3day') ui.calView = 'week';
  let title = calTitle(ui);
  if (narrow && ui.calView === 'week') { const ws = startOfWeek(ui.cursor), we = addDays(ws, 6); title = `${ws.getDate()}${ws.getMonth() !== we.getMonth() ? ' ' + MONTHS_SHORT[ws.getMonth()] : ''}–${we.getDate()} ${MONTHS_SHORT[we.getMonth()]}`; }
  if (narrow && ui.calView === 'day') { const d = ui.cursor; title = `${DOW_SHORT[isoDow(d)]} ${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`; }
  const dayToggle = ui.calView === 'day' && ui.dayMode === 'grid' ? `<button class="btn sm" data-daylist>Liste</button>` : '';
  setTopbar(`<span data-totoday style="cursor:pointer" title="Revenir à aujourd’hui">${esc(title)}</span>`, `
    <div class="cal-tools" style="display:flex;gap:6px;align-items:center">
      <button class="btn icon" data-prev aria-label="Précédent">${ICON.left}</button>
      ${narrow ? '' : '<button class="btn sm" data-today>Aujourd’hui</button>'}
      <button class="btn icon" data-next aria-label="Suivant">${ICON.right}</button>
      ${dayToggle}
      <div class="seg">${views.map(([k, l]) => `<button data-cv="${k}" class="${ui.calView === k ? 'active' : ''}">${l}</button>`).join('')}</div>
      <button class="btn primary ${narrow ? 'icon' : 'sm'}" data-plan title="Organiser automatiquement la semaine">${ICON.sparkle}<span class="hide-m">Organiser</span></button>
    </div>`);
  const goToday = () => { ui.cursor = new Date(); ui.keepScroll = null; ui.keepScrollX = null; render(); };
  topbar.querySelector('[data-prev]').onclick = () => app.shift(-1);
  topbar.querySelector('[data-next]').onclick = () => app.shift(1);
  topbar.querySelector('[data-totoday]').onclick = goToday;
  const tb = topbar.querySelector('[data-today]'); if (tb) tb.onclick = goToday;
  const dl = topbar.querySelector('[data-daylist]'); if (dl) dl.onclick = () => { ui.dayMode = 'list'; render(); };
  topbar.querySelectorAll('[data-cv]').forEach((b) => (b.onclick = () => { if (b.dataset.cv === 'day') ui.dayMode = 'list'; ui.calView = b.dataset.cv; ui.keepScrollX = null; saveUi(); render(); }));
  topbar.querySelector('[data-plan]').onclick = () => openPlanDialog(ui.cursor);
  if (ui.calView === 'month') renderMonth(view, ui, app);
  else if (ui.calView === 'list') renderList(view, ui, app);
  else if (ui.calView === 'day' && ui.dayMode !== 'grid') renderChecklist(view, ui, app);
  else renderGrid(view, ui, app);
}

/* ===================== AUJOURD'HUI ===================== */
/** Carte « progression de la semaine » (accueil et bilan) */
function progressCard(s, ws, we, rep, extraCls = 'span-4') {
  const now = new Date();
  const weekOcc = expand(s, ws, we).filter((o) => !o.ev.skipped);
  const sumDone = (list) => list.filter((o) => isDone(o, now)).reduce((t, o) => t + diffMin(o.start, o.end), 0);
  const sumAll = (list) => list.reduce((t, o) => t + diffMin(o.start, o.end), 0);
  const rows = [];
  const row = (label, color, done, plan, unit = 'h') => rows.push(`<div class="stat-row"><span class="lbl" style="--c:${color}"><i></i>${esc(label)}</span><div class="progress" style="--c:${color}"><i style="width:${plan ? Math.min(100, (done / plan) * 100) : 0}%"></i></div><span class="val">${unit === 'h' ? `${fmtHours(done)} / ${fmtHours(plan)}` : `${done} / ${plan} ${unit}`}</span></div>`);
  const courses = weekOcc.filter((o) => ['cours', 'visio'].includes(o.catId));
  row('Cours suivis', catById(s, 'cours').color, sumDone(courses), sumAll(courses));
  const rev = weekOcc.filter((o) => o.catId === 'revision');
  row('Révisions', catById(s, 'revision').color, sumDone(rev), sumAll(rev));
  const sp = weekOcc.filter((o) => o.catId === 'sport');
  row('Sport', catById(s, 'sport').color, sp.filter((o) => isDone(o, now)).length, sp.length, 'séances');
  for (const cid of ['dessin', 'musique', 'video']) { const l = weekOcc.filter((o) => o.catId === cid); if (l.length) row(catById(s, cid).name, catById(s, cid).color, sumDone(l), sumAll(l)); }
  const prod = weekOcc.filter((o) => ['etudes', 'sport', 'perso'].includes(catById(s, o.catId).group));
  const pct = sumAll(prod) ? Math.round((sumDone(prod) / sumAll(prod)) * 100) : 0;
  const missed = weekOcc.filter((o) => isMissed(o, now)).length;
  const tasksWeek = s.tasks.filter((t) => t.due && t.due >= fmtD(ws) && t.due < fmtD(we));
  return `<div class="card ${extraCls}"><h2>${ws > now ? 'Semaine qui vient' : 'Progression de la semaine'} <span class="pill">${pct}%</span></h2>
    <div class="progress" style="height:10px;margin-bottom:14px"><i style="width:${pct}%"></i></div>${rows.join('')}
    <div class="small muted" style="margin-top:6px">${missed ? `<span style="color:var(--danger)">${missed} case(s) décochée(s)</span> · ` : ''}Tâches de la semaine : ${tasksWeek.filter((t) => t.status === 'terminé').length} / ${tasksWeek.length} terminées</div></div>`;
}

function renderToday() {
  const s = state;
  const now = new Date(), today = dayStart(now);
  const ws = planningWeek(), we = addDays(ws, 7);
  ui.dashWeek = ws;
  const todayOcc = expand(s, today, addDays(today, 1)).filter((o) => !isSoft(s, o) && sameDay(o.start, today) && !/^sommeil$/i.test(o.title));
  const upcoming = expand(s, now, addDays(now, 7)).filter((o) => !isSoft(s, o) && catById(s, o.catId).group !== 'sommeil' && o.start > now);
  const current = todayOcc.filter((o) => o.start <= now && o.end > now);
  const next = upcoming[0];
  const rep = weekReport(s, ws);
  const h = now.getHours();
  const hello = h < 5 ? 'Bonne nuit' : h < 12 ? 'Bonjour' : h < 18 ? 'Bon après-midi' : 'Bonsoir';
  setTopbar(`${hello} 👋`, `<button class="btn sm hide-m" data-new>${ICON.plus} Événement</button><button class="btn primary sm" data-plan>${ICON.sparkle}<span class="hide-m">Organiser ma semaine</span></button>`);
  topbar.querySelector('[data-plan]').onclick = () => openPlanDialog(ws);
  const nb = topbar.querySelector('[data-new]'); if (nb) nb.onclick = () => fab.onclick();
  const rel = (d) => { const m = diffMin(now, d); if (m < 60) return `dans ${m} min`; if (sameDay(d, now)) return `dans ${fmtDur(m)}`; if (sameDay(d, addDays(now, 1))) return `demain à ${fmtTime(d)}`; return `${DOW_SHORT[isoDow(d)]} ${d.getDate()} à ${fmtTime(d)}`; };
  const backupOld = !syncConfigured() && Date.now() - (s.settings.lastBackup || 0) > 7 * 864e5;
  const P = { 'élevée': 0, 'moyenne': 1, 'faible': 2 };
  const prio = s.tasks.filter((t) => t.status !== 'terminé').sort((a, b) => P[a.priority] - P[b.priority] || (a.due || '9999').localeCompare(b.due || '9999')).slice(0, 5);
  const goals = s.goals.filter((g) => g.active !== false);
  const issues = rep.items.filter((i) => i.level !== 'ok').slice(0, 4);
  const doneN = todayOcc.filter((o) => isDone(o, now)).length;
  let nowPlaced = false;
  const dayRows = todayOcc.map((o) => {
    let pre = '';
    if (!nowPlaced && o.start > now) { pre = `<div class="cl-now" style="margin:4px 0"><span>${fmtTime(now).padStart(5, '0')}</span></div>`; nowPlaced = true; }
    const km = o.title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const loc = (o.ev.location || '').replace(/\s*\(\d+\)/g, '').replace(/--/g, '-');
    return pre + `<div class="tl-item ${isDone(o, now) ? 'done' : ''} ${isMissed(o, now) ? 'missed' : ''} ${o.start <= now && o.end > now ? 'now' : ''}" data-key="${esc(o.key)}" style="--c:${catById(s, o.catId).color}"><button class="cl-chk sm" data-done="${esc(o.key)}">${isDone(o, now) ? ICON.tick : ''}</button><span class="h">${fmtTime(o.start).padStart(5, '0')}</span><span class="b"></span><div><div class="t">${km ? `<span class="cl-k">(${esc(km[2])})</span> ${esc(km[1])}` : esc(o.title)}</div><div class="s">${fmtTime(o.start)} – ${fmtTime(o.end)}${loc ? ' · ' + esc(loc) : ''}</div></div></div>`;
  }).join('') + (!nowPlaced && todayOcc.length ? `<div class="cl-now" style="margin:4px 0"><span>${fmtTime(now).padStart(5, '0')}</span></div>` : '');

  view.innerHTML = `<div class="page">
    ${backupOld ? `<div class="banner" style="margin:0 0 14px">☁️ Active la synchronisation pour retrouver ton planning sur ton PC et ton téléphone.<button class="btn sm primary" data-gosync style="margin-left:auto">Activer</button></div>` : ''}
    <div class="cards">
      <div class="card span-7 day-card">
        <h2><span><span style="color:var(--text);font-size:16px;text-transform:capitalize">${fmtDayLong(now)}</span> · <span class="cl-clock">${fmtTime(now).padStart(5, '0')}</span></span><span class="pill">${doneN}/${todayOcc.length} faits</span></h2>
        <div class="progress" style="margin:-4px 0 10px"><i style="width:${todayOcc.length ? (doneN / todayOcc.length) * 100 : 0}%"></i></div>
        <div class="tl" style="max-height:none">${todayOcc.length ? dayRows : '<div class="empty">Journée libre.</div>'}</div>
        <div class="small faint" style="margin-top:8px">Ce qui a commencé est coché automatiquement. Décoche ce que tu n’as pas fait : une tâche « Rattraper » est créée.</div>
      </div>
      <div class="card span-5 next-card">
        <h2>${current.length ? 'En ce moment' : 'Prochain événement'}</h2>
        ${current.map((o) => `<div class="when">jusqu’à ${fmtTime(o.end)}</div><div class="big">${esc(o.title)}</div><div class="progress" style="--c:${catById(s, o.catId).color}"><i style="width:${Math.round((diffMin(o.start, now) / diffMin(o.start, o.end)) * 100)}%"></i></div>`).join('<div style="height:10px"></div>')}
        ${next ? `<div style="margin-top:${current.length ? 16 : 0}px">${current.length ? '<div class="small muted">Ensuite</div>' : ''}<div class="when">${rel(next.start)}</div><div class="big" style="${current.length ? 'font-size:16px' : ''}">${esc(next.title)}</div>
          <div class="muted small">${fmtTime(next.start)} – ${fmtTime(next.end)}${next.ev.location ? ' · ' + esc(next.ev.location) : ''}</div></div>` : '<div class="empty">Rien de prévu dans les 7 prochains jours.</div>'}
        <h2 style="margin-top:18px">Tâches prioritaires <button class="btn ghost sm" data-goto-tasks>Tout voir</button></h2>
        ${prio.length ? prio.map((t) => taskRow(t, true)).join('') : '<div class="empty">Aucune tâche en attente 🎉</div>'}
      </div>
      ${progressCard(s, ws, we, rep, 'span-6')}
      <div class="card span-6">
        <h2>Objectifs en cours <button class="btn ghost sm" data-goto-goals>Tout voir</button></h2>
        ${goals.map((g) => { const c = catById(s, g.catId); return `<div style="margin-bottom:12px;cursor:pointer" data-goal="${g.id}"><div style="display:flex;justify-content:space-between;gap:8px;font-size:13px;margin-bottom:5px"><b style="font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(g.title)}</b><span class="muted small">${g.progress}%</span></div><div class="progress" style="--c:${c.color}"><i style="width:${g.progress}%"></i></div></div>`; }).join('') || '<div class="empty">Aucun objectif.</div>'}
      </div>
      <div class="card span-12">
        <h2>À compléter dans mon planning <button class="btn ghost sm" data-goto-review>Bilan complet</button></h2>
        <div class="checks">${issues.length ? issues.map(issueRow).join('') : '<div class="empty">Ta semaine est complète ✅</div>'}</div>
      </div>
    </div></div>`;
  bindCommon(view);
  const occByKey = new Map(todayOcc.map((o) => [o.key, o]));
  view.querySelectorAll('.tl-item').forEach((el) => (el.onclick = () => app.editOcc(occByKey.get(el.dataset.key))));
  view.querySelectorAll('.tl [data-done]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleDone(occByKey.get(b.dataset.done)); }));
  view.querySelector('[data-goto-tasks]').onclick = () => setView('tasks');
  view.querySelector('[data-goto-goals]').onclick = () => setView('goals');
  view.querySelector('[data-goto-review]').onclick = () => setView('review');
  view.querySelectorAll('[data-goal]').forEach((el) => (el.onclick = () => openGoalEditor(el.dataset.goal)));
  const bk = view.querySelector('[data-gosync]'); if (bk) bk.onclick = () => { setView('settings'); setTimeout(() => document.getElementById('sync')?.scrollIntoView({ behavior: 'smooth' }), 50); };
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
  const rep = weekReport(s, planningWeek());
  const st = rep.stats;
  const targetRow = (kind, id, name, color, val, planned) => `<div class="tg-row" style="--c:${color}"><i></i><span class="tg-n">${esc(name)}</span><span class="tg-p muted small">${fmtHours(planned)} prévues</span>
    <input type="number" min="0" step="0.5" inputmode="decimal" value="${val ? Math.round((val / 60) * 10) / 10 : ''}" placeholder="—" data-target="${kind}|${id}"><span class="small muted">h/sem.</span></div>`;
  const targetsHtml = `<div class="card" style="margin-bottom:16px"><h2>Temps à consacrer par semaine <span class="small faint" style="font-weight:400">apparaît dans Bilan › Temps prévu par catégorie</span></h2>
    <div class="tg-grid">${s.categories.filter((c) => !c.parallel).map((c) => targetRow('cat', c.id, c.name, c.color, c.weeklyTarget, st.cats[c.id]?.planned || 0)).join('')}</div>
    <h3 style="margin:14px 0 6px;font-size:13px;color:var(--muted)">Révisions par matière</h3>
    <div class="tg-grid">${s.subjects.filter((x) => x.revise || x.weeklyTarget).map((x) => targetRow('sub', x.id, x.name, x.color, x.weeklyTarget, st.subs['rev:' + x.id]?.planned || 0)).join('')}</div>
    <div class="small faint" style="margin-top:8px">Pour les matières, l’organisation automatique répartit les révisions pour atteindre ces temps (et renforce les matières dont l’examen approche).</div></div>`;
  view.innerHTML = `<div class="page">${targetsHtml}<div class="goals">${s.goals.map((g) => {
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
  view.querySelectorAll('[data-target]').forEach((inp) => inp.addEventListener('change', () => {
    const [kind, id] = inp.dataset.target.split('|');
    const v = Math.max(0, Math.round((parseFloat(String(inp.value).replace(',', '.')) || 0) * 60));
    mutate('Temps visé', (s2) => { const x = (kind === 'cat' ? s2.categories : s2.subjects).find((y) => y.id === id); if (x) { if (v) x.weeklyTarget = v; else delete x.weeklyTarget; } });
  }));
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
/** Temps prévu par catégorie, avec le temps visé réglé dans Objectifs */
function timeByCategoryCard(s, rep, cls = 'span-12') {
  const st = rep.stats;
  const rows = s.categories.filter((c) => (st.cats[c.id]?.planned || 0) > 0 || c.weeklyTarget > 0).map((c) => {
    const pl = st.cats[c.id]?.planned || 0, t = c.weeklyTarget || 0;
    const subs = c.id === 'revision' ? s.subjects.filter((x) => (st.subs['rev:' + x.id]?.planned || 0) > 0 || x.weeklyTarget > 0).map((x) => {
      const p2 = st.subs['rev:' + x.id]?.planned || 0, t2 = x.weeklyTarget || 0;
      return `<div class="stat-row t2 sub" title="${esc(x.name)}"><span class="lbl" style="--c:${x.color}"><i></i>${esc(x.name)}</span><div class="progress" style="--c:${x.color}"><i style="width:${t2 ? Math.min(100, (p2 / t2) * 100) : 100}%"></i></div><span class="val ${t2 && p2 < t2 - 30 ? 'under' : ''}">${fmtHours(p2)}${t2 ? ' / ' + fmtHours(t2) : ''}</span></div>`;
    }).join('') : '';
    return `<div class="stat-row t2"><span class="lbl" style="--c:${c.color}"><i></i>${esc(c.name)}</span><div class="progress" style="--c:${c.color}"><i style="width:${t ? Math.min(100, (pl / t) * 100) : 100}%"></i></div><span class="val ${t && pl < t - 30 ? 'under' : ''}">${fmtHours(pl)}${t ? ' / ' + fmtHours(t) : ''}</span></div>${subs}`;
  }).join('');
  return `<div class="card ${cls}"><h2>Temps prévu par catégorie <button class="btn ghost sm" data-goto-targets>Régler les temps visés</button></h2>${rows || '<div class="empty">Rien de planifié.</div>'}
    <div class="small faint" style="margin-top:6px">Prévu / visé par semaine. Les temps visés se règlent dans Objectifs.</div></div>`;
}

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
  const conf = rep.conflicts;
  view.innerHTML = `<div class="page"><div class="cards">
    ${timeByCategoryCard(s, rep, 'span-7')}
    ${progressCard(s, ws, addDays(ws, 7), rep, 'span-5')}
    <div class="card span-12"><h2>Ce qui manque ou pose problème</h2><div class="checks">${rep.items.map(issueRow).join('')}</div></div>
    ${conf.length ? `<div class="card span-12"><h2>Conflits d’horaires</h2>${conf.map(([a, b]) => `<div class="row" style="cursor:default"><span class="lvl bad">!</span><div class="main"><div class="t">${esc(a.title)} ↔ ${esc(b.title)}</div><div class="s" style="text-transform:capitalize">${fmtDayLong(a.start)} · ${fmtTime(a.start)}–${fmtTime(a.end)} / ${fmtTime(b.start)}–${fmtTime(b.end)}</div></div><button class="btn sm" data-ok="${esc(a.key)}">${esc(a.title.slice(0, 18))}</button><button class="btn sm" data-ok="${esc(b.key)}">${esc(b.title.slice(0, 18))}</button></div>`).join('')}
      <p class="small muted">Ex. compétition de volley le jeudi après-midi : garde la compétition et marque le cours « Pas fait / annulé » ou supprime-le.</p></div>` : ''}
  </div></div>`;
  bindCommon(view);
  const occ = new Map(conf.flat().map((o) => [o.key, o]));
  view.querySelectorAll('[data-ok]').forEach((b) => (b.onclick = () => app.editOcc(occ.get(b.dataset.ok))));
  view.querySelector('[data-goto-targets]').onclick = () => { setView('goals'); };
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
        ${F('Style visuel', `<select data-set="settings.visualStyle" data-type="str">${[['classic', 'Classique'], ['glass-light', 'Verre clair (liquid glass)'], ['glass-dark', 'Verre sombre (liquid glass)'], ['glass-soft', 'Doux et aéré']].map(([k, l]) => `<option value="${k}" ${(st.visualStyle || 'classic') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${F('Routines dans la semaine', `<select data-set="settings.weekRoutines" data-type="str">${[['full', 'Affichées en entier'], ['thin', 'Fines barres (semaine aérée)']].map(([k, l]) => `<option value="${k}" ${(st.weekRoutines || 'full') === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
        ${F('Thème', `<select data-set="settings.theme" data-type="str">${[['auto', 'Automatique (système)'], ['light', 'Clair'], ['dark', 'Sombre']].map(([k, l]) => `<option value="${k}" ${st.theme === k ? 'selected' : ''}>${l}</option>`).join('')}</select>`)}
      </div>
      <label class="check-line" style="margin-top:12px">${inp('settings.fitScreen', 'checkbox')} Afficher toute la journée dans l’écran, sans défiler (la hauteur des heures s’adapte)</label>
      <label class="check-line" style="margin-top:8px">${inp('settings.monthHideRoutine', 'checkbox')} Masquer sommeil, repas et rangement dans la vue Mois</label>
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

    <section class="card set-sec" id="sync"><h2>Synchronisation PC ↔ téléphone</h2>
      <p>Tes données sont copiées dans un espace privé de ton compte GitHub (un « Gist » secret) : gratuit, sans serveur. Chaque modification est envoyée en quelques secondes et récupérée sur l’autre appareil dès que tu ouvres l’app.</p>
      <div data-syncstate style="margin-bottom:12px">${syncStateHtml()}</div>
      ${syncConfigured() ? `<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn primary" data-syncnow>↻ Synchroniser maintenant</button><button class="btn danger" data-syncoff>Déconnecter cet appareil</button></div>` : `
      <ol style="margin:0 0 12px;padding-left:20px;line-height:1.7;font-size:13.5px">
        <li>Ouvre <a href="https://github.com/settings/tokens/new?scopes=gist&description=Mon%20Planning" target="_blank" rel="noopener">ce lien de création de jeton GitHub</a> (connecté à ton compte).</li>
        <li>« Expiration » : choisis <b>No expiration</b>. La case <b>gist</b> est déjà cochée — ne coche rien d’autre.</li>
        <li>Clique <b>Generate token</b> en bas, puis copie le code qui commence par <code>ghp_</code>.</li>
        <li>Colle-le ci-dessous et clique <b>Connecter</b>. Fais la même chose sur ton autre appareil (avec le même code).</li>
      </ol>
      <div style="display:flex;gap:8px;flex-wrap:wrap"><input type="text" data-token placeholder="ghp_…" autocomplete="off" autocapitalize="off" spellcheck="false" style="flex:1;min-width:220px;font-family:ui-monospace,monospace"><button class="btn primary" data-connect>Connecter</button></div>
      <p class="small faint" style="margin-top:8px">Le code reste uniquement sur cet appareil. Il ne donne accès qu’à tes Gists, pas à tes dépôts. Tu peux le révoquer à tout moment sur GitHub.</p>`}
    </section>

    <section class="card set-sec"><h2>Données</h2><p>Tout est enregistré automatiquement sur cet appareil${'' }. Sauvegarde de secours : exporte un fichier de temps en temps.</p>
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
    const fallback = s.categories.find((x) => x.group === c.group && x.id !== id) || s.categories.find((x) => x.id === 'sorties') || s.categories[0];
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
  const sn = view.querySelector('[data-syncnow]'); if (sn) sn.onclick = () => syncNow();
  const so = view.querySelector('[data-syncoff]'); if (so) so.onclick = async () => { if (await confirmDialog('Déconnecter cet appareil ? Tes données restent ici et dans le cloud, mais ne seront plus synchronisées.', { ok: 'Déconnecter' })) { disconnect(); render(); } };
  const cb = view.querySelector('[data-connect]');
  if (cb) cb.onclick = async () => {
    const token = view.querySelector('[data-token]').value.trim();
    if (!/^(ghp_|github_pat_)/.test(token)) { toast('Colle le code GitHub qui commence par ghp_'); return; }
    cb.disabled = true; cb.textContent = 'Connexion…';
    try {
      const r = await connect(token);
      if (r.found) {
        const choice = await new Promise((resolve) => {
          let done = false;
          openModal({ title: 'Un planning existe déjà dans le cloud', body: `<p style="margin:0;line-height:1.5">C’est sûrement celui de ton autre appareil. Que veux-tu faire ?</p>
            <button class="btn primary" style="height:44px;justify-content:flex-start" data-m="remote">Utiliser le planning du cloud sur cet appareil <span class="small" style="opacity:.8">(recommandé pour le 2ᵉ appareil)</span></button>
            <button class="btn" style="height:44px;justify-content:flex-start" data-m="merge">Fusionner les deux</button>
            <button class="btn" style="height:44px;justify-content:flex-start" data-m="local">Remplacer le cloud par cet appareil</button>`,
            onMount: (m, cl) => m.querySelectorAll('[data-m]').forEach((b) => (b.onclick = () => { done = true; resolve(b.dataset.m); cl(); })), onClose: () => { if (!done) resolve(null); } });
        });
        if (!choice) { cb.disabled = false; cb.textContent = 'Connecter'; return; }
        await connect(token, choice);
      }
      toast('Appareil connecté : synchronisation activée ☁️');
      render();
    } catch (e) { toast(e.message || 'Connexion impossible', { duration: 6000 }); cb.disabled = false; cb.textContent = 'Connecter'; }
  };
  const ins = view.querySelector('[data-install]');
  if (ins) ins.onclick = async () => { deferredInstall.prompt(); await deferredInstall.userChoice; deferredInstall = null; render(); };
}

function habitSummary(h) {
  const days = h.days.length === 7 ? 'tous les jours' : h.days.slice().sort().map((d) => DOW_SHORT[d]).join(' ');
  if (h.type === 'fixed') return `${days} à ${h.start}`;
  if (h.type === 'with') return `${h.times || 1}×/semaine, en même temps que « ${h.with} »`;
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
let lastMinute = new Date().getMinutes();
setInterval(() => {
  const m = new Date().getMinutes();
  if (m === lastMinute) return;
  lastMinute = m;
  if (document.querySelector('.modal-bg') || document.querySelector('.ev.dragging')) return;
  if (ui.view === 'today' || ui.view === 'calendar') render();
}, 5000);
let rz = null;
window.addEventListener('resize', () => { clearTimeout(rz); rz = setTimeout(() => { if (!document.querySelector('.ev.dragging')) render(); }, 150); });

/* ---------- PWA ---------- */
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
requestPersistence();

render();
if (firstRun) setTimeout(() => toast('Bienvenue ! Ton planning de départ est prêt — regarde « À compléter ».', { duration: 6000 }), 400);
