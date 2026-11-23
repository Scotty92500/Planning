// Vues calendrier : jour / 3 jours / semaine (grille avec glisser-déposer), mois, liste
import { state, mutate } from './store.js';
import { esc, addDays, dayStart, startOfWeek, startOfMonth, fmtD, fmtDT, fmtTime, isoDow, isWeekend, DOW_SHORT, atMin, minOfDay, snap, clamp, diffMin, sameDay, fmtDayLong, parseD, fmtDur } from './util.js';
import { expand, catById, subjectById, layoutColumns, conflictKeys, isSoft, isDone, isMissed } from './model.js';
import { toast } from './ui.js';

const STEP = 15;

export function visibleDays(ui) {
  const c = dayStart(ui.cursor);
  if (ui.calView === 'day') return [c];
  if (ui.calView === '3day') return [c, addDays(c, 1), addDays(c, 2)];
  const ws = startOfWeek(c);
  return [...Array(7)].map((_, i) => addDays(ws, i));
}

export function calTitle(ui) {
  const c = ui.cursor;
  const M = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const ML = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  if (ui.calView === 'month') return `${ML[c.getMonth()]} ${c.getFullYear()}`;
  if (ui.calView === 'list') return `À venir · dès le ${c.getDate()} ${M[c.getMonth()]}`;
  if (ui.calView === 'day') return fmtDayLong(c).replace(/^./, (x) => x.toUpperCase());
  const d = visibleDays(ui), a = d[0], b = d[d.length - 1];
  return a.getMonth() === b.getMonth() ? `${a.getDate()} – ${b.getDate()} ${M[b.getMonth()]} ${b.getFullYear()}` : `${a.getDate()} ${M[a.getMonth()]} – ${b.getDate()} ${M[b.getMonth()]} ${b.getFullYear()}`;
}

export function shiftCursor(ui, dir) {
  const c = ui.cursor;
  if (ui.calView === 'month') return new Date(c.getFullYear(), c.getMonth() + dir, 1);
  const n = { day: 1, '3day': 3, week: 7, list: 14 }[ui.calView] || 7;
  return addDays(c, dir * n);
}

const visible = (o) => !state.settings.hiddenCats.includes(o.catId);

/* ===================== GRILLE ===================== */
export { isDone } from './model.js';
/** Coche / décoche. Décocher une case déjà commencée crée une tâche « Rattraper … » */
export function toggleDone(o) {
  const now = new Date();
  const wasDone = isDone(o, now);
  const started = o.start <= now;
  let createdTask = null;
  mutate('Coché', (s) => {
    const ev = s.events.find((x) => x.id === o.ev.id);
    if (!ev) return;
    const d = o.occDate;
    const setFlag = (list, single, on) => {
      if (d) { const set = new Set(ev[list] || []); on ? set.add(d) : set.delete(d); ev[list] = [...set]; if (!ev[list].length) delete ev[list]; }
      else if (on) ev[single] = true; else delete ev[single];
    };
    if (wasDone) {
      setFlag('doneDates', 'done', false);
      if (started) {
        setFlag('undoneDates', 'undone', true);
        if (!s.tasks.some((t) => t.fromEvent === o.key)) {
          const cat = ['cours', 'visio', 'examen'].includes(o.catId) ? 'revision' : o.catId;
          const title = o.title.replace(/\s*\[[^\]]+\]\s*$/, '');
          createdTask = { id: Math.random().toString(36).slice(2, 10), title: `Rattraper : ${title}`, due: fmtD(now), priority: 'moyenne', estimate: Math.max(15, diffMin(o.start, o.end)), catId: cat, subjectId: o.subjectId || '', status: 'à faire', notes: `Pas fait le ${fmtDayLong(o.start)} (${fmtTime(o.start)} – ${fmtTime(o.end)}).`, fromEvent: o.key };
          s.tasks.push(createdTask);
        }
      }
      delete ev.skipped;
    } else {
      setFlag('undoneDates', 'undone', false);
      delete ev.skipped;
      if (!started) setFlag('doneDates', 'done', true);
      s.tasks = s.tasks.filter((t) => !(t.fromEvent === o.key && t.status !== 'terminé'));
    }
  }, { undoable: false });
  if (createdTask) toast(`Ajouté aux tâches : ${createdTask.title}`);
}

let headCache = 0;
export function renderGrid(root, ui, app, pass = 0) {
  const s = state, st = s.settings;
  const days = visibleDays(ui);
  const H = st.dayStart, E = st.dayEnd;
  // « tout dans l'écran » : la hauteur d'une heure s'adapte à la place disponible
  const fit = st.fitScreen !== false && root.clientHeight > 200;
  const headGuess = headCache || (window.innerWidth <= 820 ? 52 : 66);
  const hourH = fit ? Math.max(14, Math.floor(((root.clientHeight - headGuess - 2) / (E - H)) * 10) / 10) : st.hourHeight || 52;
  const narrow = window.innerWidth <= 820;
  const colmin = 0; // les 7 jours tiennent toujours dans l'écran
  const avail = window.innerWidth - (narrow ? 0 : 248) - (narrow ? 34 : 52);
  const compact = avail / days.length < 96;
  const from = days[0], to = addDays(days[days.length - 1], 1);
  const occs = expand(s, addDays(from, -1), addDays(to, 1));
  const conf = conflictKeys(s, occs);
  const today = new Date();
  const colH = (E - H) * hourH;

  const head = days.map((d, i) => {
    const dayOcc = occs.filter((o) => sameDay(o.start, d) && catById(s, o.catId).group !== 'sommeil' && !isSoft(s, o));
    const load = Math.min(1, dayOcc.reduce((t, o) => t + diffMin(o.start, o.end), 0) / ((E - H - 1) * 60));
    return `<div class="gh-cell ${sameDay(d, today) ? 'today' : ''} ${isWeekend(d) ? 'weekend' : ''}" data-goto="${fmtD(d)}">
      <div class="dow">${DOW_SHORT[isoDow(d)]}</div><div class="num">${d.getDate()}</div>
      <div class="load" title="Remplissage de la journée"><i style="width:${Math.round(load * 100)}%"></i></div></div>`;
  }).join('');
  const hours = [...Array(E - H)].map((_, i) => `<div>${i === 0 ? '' : `${String(H + i).padStart(2, '0')}:00`}</div>`).join('');
  const airy = st.weekRoutines === 'thin' && days.length > 1;
  const isRoutine = (o) => ['sommeil', 'repas', 'menage', 'libre'].includes(catById(s, o.catId).group) || o.title === 'Écriture de paroles';
  const cols = days.map((d, di) => {
    const a = atMin(d, H * 60), b = atMin(d, E * 60);
    const all = occs.filter((o) => visible(o) && o.end > a && o.start < b).map((o) => {
      const s0 = Math.max(0, diffMin(a, o.start)), e0 = Math.min((E - H) * 60, diffMin(a, o.end));
      return { o, s: s0, e: Math.max(e0, s0 + 10) };
    });
    const routines = airy ? all.filter((it) => isRoutine(it.o)) : [];
    const items = airy ? all.filter((it) => !isRoutine(it.o)) : all;
    const laid = layoutColumns(items);
    const bars = routines.map(({ o, s: s0, e: e0 }) => `<div class="ev rbar" data-key="${esc(o.key)}" style="--c:${catById(s, o.catId).color};top:${(s0 / 60) * hourH + 1}px;height:${Math.max(3, ((e0 - s0) / 60) * hourH - 2)}px" title="${esc(o.title)} · ${fmtTime(o.start)} – ${fmtTime(o.end)}"></div>`).join('');
    const evs = bars + laid.map(({ o, s: s0, e: e0, col, ncol }) => evHtml(o, s0, e0, col, ncol, hourH, conf.has(o.key), di, airy)).join('');
    let now = '';
    if (sameDay(d, today)) {
      const m = minOfDay(today) - H * 60;
      if (m >= 0 && m <= (E - H) * 60) now = `<div class="now-line" style="top:${(m / 60) * hourH}px"></div>`;
    }
    return `<div class="day-col ${isWeekend(d) ? 'weekend' : ''} ${sameDay(d, today) ? 'today' : ''}" data-day="${di}" style="height:${colH}px">${evs}${now}</div>`;
  }).join('');

  // repère de l'heure actuelle dans la colonne des heures
  let nowTag = '';
  if (days.some((d) => sameDay(d, today))) {
    const m = minOfDay(today) - H * 60;
    if (m >= 0 && m <= (E - H) * 60) nowTag = `<span class="now-tag" style="top:${(m / 60) * hourH}px">${fmtTime(today).padStart(5, '0')}</span>`;
  }
  root.innerHTML = `<div class="cal"><div class="grid-scroll ${fit ? 'fit' : ''}"><div class="grid ${compact ? 'compact' : ''} ${days.length === 1 ? 'single' : ''} ${fit && hourH < 40 ? 'dense' : ''}" style="--cols:${days.length};--colmin:${colmin}px;--hour-h:${hourH}px">
    <div class="gh-cell corner"></div>${head}<div class="time-col">${hours}${nowTag}</div>${cols}</div></div></div>`;
  if (fit && pass === 0) {
    const h = root.querySelector('.gh-cell').offsetHeight;
    if (Math.abs(h - headGuess) > 1) { headCache = h; return renderGrid(root, ui, app, 1); }
  }

  const scroller = root.querySelector('.grid-scroll');
  // position de défaut : l'heure actuelle ou 8h
  const targetMin = days.some((d) => sameDay(d, today)) ? Math.max(0, minOfDay(today) - H * 60 - 90) : Math.max(0, (8 - H) * 60);
  if (fit) scroller.scrollTop = 0;
  else if (ui.keepScroll != null) scroller.scrollTop = ui.keepScroll; else scroller.scrollTop = (targetMin / 60) * hourH;
  if (ui.keepScrollX != null) scroller.scrollLeft = ui.keepScrollX;
  else if (colmin) { const ti = days.findIndex((d) => sameDay(d, today)); if (ti > 1) scroller.scrollLeft = (ti - 1) * colmin; }
  scroller.addEventListener('scroll', () => { ui.keepScroll = scroller.scrollTop; ui.keepScrollX = scroller.scrollLeft; }, { passive: true });

  root.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => app.goto(parseD(el.dataset.goto), 'day')));
  attachInteractions(scroller, days, occs, hourH, app, ui);
}

function evHtml(o, s0, e0, col, ncol, hourH, conflict, di, airy = false) {
  const s = state;
  const cat = catById(s, o.catId);
  const subj = subjectById(s, o.subjectId);
  const top = (s0 / 60) * hourH + (airy ? 1.5 : 0), h = Math.max(13, ((e0 - s0) / 60) * hourH - (airy ? 3 : 2));
  const short = h < 34;
  const left = airy ? `calc(6px + ${col / ncol} * (100% - 8px))` : `calc(${(col / ncol) * 100}% + 2px)`;
  const width = airy ? `calc((100% - 8px) / ${ncol} - ${ncol > 1 ? 2 : 0}px)` : `calc(${100 / ncol}% - 4px)`;
  const cls = ['ev', isDone(o) && o.end <= new Date() ? 'done' : '', isMissed(o) ? 'missed' : '', h < 13 ? 'tiny' : '', short ? 'short' : '', o.ev.source === 'auto' ? 'auto' : '', isSoft(s, o) ? 'soft' : '', o.ev.skipped ? 'skipped' : '', conflict ? 'conflict' : ''].join(' ');
  const time = `${fmtTime(o.start)} – ${fmtTime(o.end)}`;
  const pin = o.ev.pinned ? '<span class="pin" title="Épinglé">📌</span>' : '';
  const rec = o.ev.recur ? ' ↻' : '';
  // style « emploi du temps école » : (TD) / matière / salle
  let km = o.title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
  if (!km && o.catId === 'revision' && /^Révisions · /.test(o.title)) km = [o.title, o.title.replace(/^Révisions · /, ''), 'Rév.'];
  const isCourse = km && cat.group === 'etudes';
  const loc = (o.ev.location || '').replace(/\s*\(\d+\)/g, '').replace(/--/g, '-');
  const tip = `${esc(o.title)} · ${time}${o.ev.location ? ' · ' + esc(o.ev.location) : ''}`;
  const inner = isCourse
    ? `<div class="k">(${esc(km[2])})</div><div class="t">${esc(km[1])}${pin}</div>${loc && !short ? `<div class="l">${esc(loc)}</div>` : ''}<div class="h">${time}</div>`
    : `<div class="t">${esc(o.title)}${pin}${rec}</div><div class="h">${time}</div>${!short && loc && h > 50 ? `<div class="l">${esc(loc)}</div>` : ''}`;
  return `<div class="${cls} ${isCourse ? 'course' : ''}" data-key="${esc(o.key)}" data-di="${di}" style="--c:${cat.color};${subj ? `--s:${subj.color};` : ''}top:${top}px;height:${h}px;left:${left};width:${width}" title="${tip}">
    ${subj && !isCourse ? '<span class="subj"></span>' : ''}${inner}
    <div class="rs" data-resize></div></div>`;
}

/* ---------- glisser-déposer, redimensionner, créer ---------- */
function attachInteractions(scroller, days, occs, hourH, app, ui) {
  const st = state.settings;
  const H = st.dayStart, E = st.dayEnd;
  const byKey = new Map(occs.map((o) => [o.key, o]));
  const colEls = [...scroller.querySelectorAll('.day-col')];
  let drag = null, tip = null, raf = null, lastPt = null;

  const colAt = (x) => {
    for (let i = 0; i < colEls.length; i++) { const r = colEls[i].getBoundingClientRect(); if (x >= r.left && x < r.right) return i; }
    const r0 = colEls[0].getBoundingClientRect();
    return x < r0.left ? 0 : colEls.length - 1;
  };
  const minAt = (y, ci) => { const r = colEls[ci].getBoundingClientRect(); return ((y - r.top) / hourH) * 60 + H * 60; };
  const fmtM = (m) => `${Math.floor(m / 60) % 24}:${String(Math.round(m % 60)).padStart(2, '0')}`;
  const showTip = (x, y, text) => {
    if (!tip) { tip = document.createElement('div'); tip.className = 'drag-tip'; document.body.appendChild(tip); }
    tip.textContent = text; tip.style.left = x + 'px'; tip.style.top = y + 'px';
  };
  const clearTip = () => { tip && tip.remove(); tip = null; };

  // empêche le défilement tactile pendant un glisser
  scroller.addEventListener('touchmove', (e) => { if (drag && drag.active) e.preventDefault(); }, { passive: false });
  scroller.addEventListener('contextmenu', (e) => { if (drag) e.preventDefault(); });

  scroller.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    const evEl = e.target.closest('.ev');
    const colEl = e.target.closest('.day-col');
    if (!colEl) return;
    const ci = +colEl.dataset.day;
    const touch = e.pointerType !== 'mouse';
    if (evEl) {
      const o = byKey.get(evEl.dataset.key);
      if (!o) return;
      const resize = !!e.target.closest('[data-resize]');
      const startMin = minAt(e.clientY, ci);
      const dispStart = Math.max(H * 60, diffMin(atMin(days[ci], 0), o.start));
      drag = { mode: resize ? 'resize' : 'move', o, el: evEl, ci, x0: e.clientX, y0: e.clientY, active: false, touch,
        grab: startMin - dispStart, dur: diffMin(o.start, o.end), dispStart, pointerId: e.pointerId };
      if (touch) drag.timer = setTimeout(() => activate(), resize ? 120 : 320);
    } else {
      drag = { mode: 'create', ci, x0: e.clientX, y0: e.clientY, active: false, touch, anchor: snapFloor(minAt(e.clientY, ci)), pointerId: e.pointerId };
    }
  });

  const snapFloor = (m) => Math.floor(m / STEP) * STEP;

  function activate() {
    if (!drag || drag.active) return;
    drag.active = true;
    if (navigator.vibrate && drag.touch) try { navigator.vibrate(12); } catch (e) { /* */ }
    if (drag.el) {
      drag.el.classList.add('dragging');
      drag.el.style.left = '2px'; drag.el.style.width = 'calc(100% - 4px)';
    }
    if (drag.mode === 'create') {
      drag.prev = document.createElement('div'); drag.prev.className = 'slot-preview'; colEls[drag.ci].appendChild(drag.prev);
    }
    startAutoScroll();
  }

  function startAutoScroll() {
    const tick = () => {
      if (!drag || !drag.active) return;
      if (lastPt) {
        const r = scroller.getBoundingClientRect();
        const edge = 44;
        let dy = 0;
        if (lastPt.y < r.top + edge + 60) dy = -Math.ceil((r.top + edge + 60 - lastPt.y) / 6);
        else if (lastPt.y > r.bottom - edge) dy = Math.ceil((lastPt.y - (r.bottom - edge)) / 6);
        if (dy) { scroller.scrollTop += dy; update(lastPt.x, lastPt.y); }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
  }

  function update(x, y) {
    const ci = colAt(x);
    const m = minAt(y, ci);
    if (drag.mode === 'move') {
      let ns = snap(m - drag.grab, STEP);
      ns = clamp(ns, H * 60, E * 60 - STEP);
      drag.ns = ns; drag.nci = ci;
      if (drag.el.parentElement !== colEls[ci]) colEls[ci].appendChild(drag.el);
      const top = ((ns - H * 60) / 60) * hourH;
      drag.el.style.top = top + 'px';
      drag.el.style.height = Math.max(15, (Math.min(drag.dur, E * 60 - ns) / 60) * hourH - 2) + 'px';
      showTip(x, y, `${DOW_SHORT[isoDow(days[ci])]} ${fmtM(ns)} – ${fmtM(ns + drag.dur)}`);
    } else if (drag.mode === 'resize') {
      const ne = Math.max(drag.dispStart + STEP, snap(minAt(y, drag.ci), STEP));
      drag.ne = Math.min(ne, E * 60);
      drag.el.style.height = Math.max(15, ((drag.ne - drag.dispStart) / 60) * hourH - 2) + 'px';
      showTip(x, y, `Fin ${fmtM(drag.ne)} · ${fmtDur(drag.ne - (diffMin(atMin(days[drag.ci], 0), drag.o.start)))}`);
    } else if (drag.mode === 'create') {
      const cur = snap(minAt(y, drag.ci), STEP);
      const a = clamp(Math.min(drag.anchor, cur), H * 60, E * 60), b = clamp(Math.max(drag.anchor + STEP, cur), H * 60, E * 60);
      drag.a = a; drag.b = b;
      drag.prev.style.top = ((a - H * 60) / 60) * hourH + 'px';
      drag.prev.style.height = ((b - a) / 60) * hourH + 'px';
      drag.prev.textContent = `${fmtM(a)} – ${fmtM(b)}`;
    }
  }

  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', onCancel);
  // nettoyage quand la vue est remplacée
  const obs = new MutationObserver(() => { if (!scroller.isConnected) { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); window.removeEventListener('pointercancel', onCancel); obs.disconnect(); clearTip(); } });
  obs.observe(document.getElementById('view'), { childList: true, subtree: false });

  function onMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dist = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
    if (!drag.active) {
      if (drag.touch) { if (dist > 8) { clearTimeout(drag.timer); drag = null; } return; } // le doigt fait défiler
      if (dist < 5) return;
      activate();
    }
    e.preventDefault();
    lastPt = { x: e.clientX, y: e.clientY };
    update(e.clientX, e.clientY);
  }
  function onCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    if (drag.active && drag.touch) return; // on garde le glisser tactile actif
    end(); app.rerender();
  }
  function end() {
    if (drag) clearTimeout(drag.timer);
    cancelAnimationFrame(raf); clearTip(); lastPt = null;
    const d = drag; drag = null; return d;
  }
  function onUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const d = end();
    if (!d.active) {
      // simple clic / tap
      if (d.mode === 'create') {
        const m = clamp(snapFloor(minAt(e.clientY, d.ci)), H * 60, E * 60 - 60);
        app.newEvent({ start: atMin(days[d.ci], m), end: atMin(days[d.ci], m + 60) });
      } else app.editOcc(d.o);
      return;
    }
    if (d.mode === 'create') {
      d.prev && d.prev.remove();
      app.newEvent({ start: atMin(days[d.ci], d.a), end: atMin(days[d.ci], d.b) });
      return;
    }
    if (d.mode === 'move' && d.ns != null) {
      const newStart = atMin(days[d.nci], d.ns);
      const delta = diffMin(d.o.start, newStart);
      if (delta === 0) { app.rerender(); return; }
      moveOccurrence(d.o, newStart, addMin2(newStart, d.dur));
      toast(`« ${d.o.title} » déplacé`, { action: 'Annuler', onAction: app.undo });
    } else if (d.mode === 'resize' && d.ne != null) {
      const newEnd = atMin(days[d.ci], d.ne);
      if (newEnd <= d.o.start) { app.rerender(); return; }
      moveOccurrence(d.o, d.o.start, newEnd);
      toast(`Durée : ${fmtDur(diffMin(d.o.start, newEnd))}`, { action: 'Annuler', onAction: app.undo });
    }
  }

  // balayage gauche/droite (jour et 3 jours) pour changer de période
  if (ui.calView !== 'week') {
    let sx = 0, sy = 0, st0 = 0;
    scroller.addEventListener('touchstart', (e) => { if (e.touches.length === 1) { sx = e.touches[0].clientX; sy = e.touches[0].clientY; st0 = Date.now(); } }, { passive: true });
    scroller.addEventListener('touchend', (e) => {
      if (drag && drag.active) return;
      const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dy) < 50 && Date.now() - st0 < 600) app.shift(dx < 0 ? 1 : -1);
    }, { passive: true });
  }
}
const addMin2 = (d, m) => new Date(d.getTime() + m * 60000);

/** Déplace / redimensionne une occurrence (détache l'occurrence si l'événement est récurrent) */
export function moveOccurrence(o, newStart, newEnd) {
  mutate('Déplacer', (s) => {
    const ev = s.events.find((x) => x.id === o.ev.id);
    if (!ev) return;
    if (ev.recur) {
      ev.exdates = [...(ev.exdates || []), o.occDate];
      const { recur, exdates, ...rest } = ev;
      s.events.push({ ...rest, id: Math.random().toString(36).slice(2, 10), start: fmtDT(newStart), end: fmtDT(newEnd), source: 'manual', detachedFrom: ev.id });
    } else {
      ev.start = fmtDT(newStart); ev.end = fmtDT(newEnd);
      if (ev.source === 'auto') ev.pinned = true;
    }
  });
}

/* ===================== MOIS ===================== */
export function renderMonth(root, ui, app) {
  const s = state;
  const first = startOfMonth(ui.cursor);
  const gs = startOfWeek(first);
  const occs = expand(s, gs, addDays(gs, 42)).filter((o) => visible(o) && !(s.settings.monthHideRoutine && ['sommeil', 'repas', 'menage', 'libre'].includes(catById(s, o.catId).group)));
  const today = new Date();
  let html = '<div class="month">' + [1, 2, 3, 4, 5, 6, 7].map((d) => `<div class="mh">${DOW_SHORT[d]}</div>`).join('');
  const narrow = window.innerWidth <= 820;
  const max = narrow ? 3 : 4;
  for (let i = 0; i < 42; i++) {
    const d = addDays(gs, i);
    const items = occs.filter((o) => sameDay(o.start, d));
    html += `<div class="mcell ${d.getMonth() !== first.getMonth() ? 'out' : ''} ${sameDay(d, today) ? 'today' : ''}" data-goto="${fmtD(d)}"><div class="n">${d.getDate()}</div>
      ${items.slice(0, max).map((o) => `<div class="mitem" style="--c:${catById(s, o.catId).color}"><i></i><b>${fmtTime(o.start)}</b> ${esc(o.title)}</div>`).join('')}
      ${items.length > max ? `<div class="mmore">+${items.length - max} autre${items.length - max > 1 ? 's' : ''}</div>` : ''}</div>`;
  }
  root.innerHTML = html + '</div>';
  root.querySelectorAll('[data-goto]').forEach((el) => el.addEventListener('click', () => app.goto(parseD(el.dataset.goto), 'day')));
}

/* ===================== LISTE ===================== */
export function renderList(root, ui, app) {
  const s = state;
  const from = dayStart(ui.cursor);
  const occs = expand(s, from, addDays(from, 14)).filter((o) => visible(o) && catById(s, o.catId).group !== 'sommeil' && !isSoft(s, o));
  const today = new Date();
  let html = '<div class="agenda">';
  for (let i = 0; i < 14; i++) {
    const d = addDays(from, i);
    const items = occs.filter((o) => sameDay(o.start, d));
    const tasks = s.tasks.filter((t) => t.due === fmtD(d) && t.status !== 'terminé');
    if (!items.length && !tasks.length) continue;
    html += `<div class="agenda-day ${sameDay(d, today) ? 'today' : ''}"><h3>${fmtDayLong(d)}${sameDay(d, today) ? ' · aujourd’hui' : ''}</h3>`;
    for (const t of tasks) html += `<div class="row" data-task="${t.id}" style="--c:${catById(s, t.catId).color}"><span class="bar"></span><span class="time">Échéance</span><div class="main"><div class="t">☐ ${esc(t.title)}</div><div class="s">Tâche · ${esc(t.priority)}${t.estimate ? ' · ' + fmtDur(t.estimate) : ''}</div></div></div>`;
    for (const o of items) {
      const sub = subjectById(s, o.subjectId);
      html += `<div class="row" data-key="${esc(o.key)}" style="--c:${catById(s, o.catId).color}"><span class="bar"></span><span class="time">${fmtTime(o.start)} – ${fmtTime(o.end)}</span><div class="main"><div class="t">${esc(o.title)}</div><div class="s">${esc(catById(s, o.catId).name)}${sub && !o.title.includes(sub.name) ? ' · ' + esc(sub.name) : ''}${o.ev.location ? ' · ' + esc(o.ev.location) : ''}</div></div></div>`;
    }
    html += '</div>';
  }
  if (html === '<div class="agenda">') html += '<div class="empty">Rien de prévu sur les 14 prochains jours.</div>';
  root.innerHTML = html + '</div>';
  const byKey = new Map(occs.map((o) => [o.key, o]));
  root.querySelectorAll('[data-key]').forEach((el) => el.addEventListener('click', () => app.editOcc(byKey.get(el.dataset.key))));
  root.querySelectorAll('[data-task]').forEach((el) => el.addEventListener('click', () => app.editTask(el.dataset.task)));
}

/* ===================== JOURNÉE EN CHECK-LISTE ===================== */
export function renderChecklist(root, ui, app) {
  const s = state;
  const day = dayStart(ui.cursor);
  const now = new Date();
  const isToday = sameDay(day, now);
  const occs = expand(s, day, addDays(day, 1)).filter((o) => visible(o) && sameDay(o.start, day) && !isSoft(s, o) && !/^sommeil$/i.test(o.title));
  const done = occs.filter(isDone).length;
  const pct = occs.length ? Math.round((done / occs.length) * 100) : 0;
  let nowPlaced = !isToday;
  const nowRow = () => `<div class="cl-now"><span>${fmtTime(now).padStart(5, '0')}</span></div>`;
  let rows = '';
  for (const o of occs) {
    if (!nowPlaced && o.start > now) { rows += nowRow(); nowPlaced = true; }
    const cat = catById(s, o.catId);
    const km = o.title.match(/^(.*?)\s*\[([^\]]+)\]\s*$/);
    const title = km ? km[1] : o.title;
    const loc = (o.ev.location || '').replace(/\s*\(\d+\)/g, '').replace(/--/g, '-');
    const cur = isToday && o.start <= now && o.end > now;
    const past = isToday && o.end <= now;
    rows += `<div class="cl-row ${isDone(o) ? 'done' : ''} ${cur ? 'cur' : ''} ${isMissed(o) ? 'missed' : ''}" data-key="${esc(o.key)}" style="--c:${cat.color}">
      <button class="cl-chk" data-done="${esc(o.key)}" aria-label="Fait">${isDone(o) ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5 10 17l9-10"/></svg>' : ''}</button>
      <span class="cl-time">${fmtTime(o.start).padStart(5, '0')}</span>
      <span class="cl-bar"></span>
      <div class="cl-main"><div class="cl-t">${km ? `<span class="cl-k">(${esc(km[2])})</span> ` : ''}${esc(title)}</div><div class="cl-s">${fmtTime(o.start)} – ${fmtTime(o.end)}${loc ? ' · ' + esc(loc) : ''}</div></div>
    </div>`;
  }
  if (!nowPlaced) rows += nowRow();
  root.innerHTML = `<div class="checklist">
    <div class="cl-head"><div><div class="cl-date">${fmtDayLong(day).replace(/^./, (x) => x.toUpperCase())}${isToday ? ' · <span class="cl-clock">' + fmtTime(now).padStart(5, '0') + '</span>' : ''}</div>
      <div class="cl-prog"><div class="progress"><i style="width:${pct}%"></i></div><span>${done}/${occs.length} faits</span></div></div>
      <button class="btn sm" data-gridday title="Voir en grille">Grille</button></div>
    <div class="cl-list">${occs.length ? rows : '<div class="empty">Rien de prévu ce jour-là.</div>'}</div></div>`;
  const byKey = new Map(occs.map((o) => [o.key, o]));
  root.querySelectorAll('[data-done]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); toggleDone(byKey.get(b.dataset.done)); }));
  root.querySelectorAll('.cl-row').forEach((r) => (r.onclick = () => app.editOcc(byKey.get(r.dataset.key))));
  root.querySelector('[data-gridday]').onclick = () => { ui.dayMode = 'grid'; app.rerender(); };
  // balayage gauche/droite = jour précédent / suivant
  let sx = 0, sy = 0;
  const list = root.querySelector('.checklist');
  list.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
  list.addEventListener('touchend', (e) => { const t = e.changedTouches[0]; const dx = t.clientX - sx, dy = t.clientY - sy; if (Math.abs(dx) > 70 && Math.abs(dy) < 50) app.shift(dx < 0 ? 1 : -1); }, { passive: true });
}
