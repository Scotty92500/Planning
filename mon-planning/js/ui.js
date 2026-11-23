// Petits composants : icônes, modale, toasts, confirmations
import { esc } from './util.js';

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const ICON = {
  home: P('<path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/><path d="M10 21v-6h4v6"/>'),
  cal: P('<rect x="3" y="4.5" width="18" height="16.5" rx="2.5"/><path d="M3 9.5h18M8 3v3M16 3v3"/>'),
  check: P('<path d="M9 11.5 11.5 14 16 9"/><rect x="3" y="3" width="18" height="18" rx="4"/>'),
  target: P('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/>'),
  pulse: P('<path d="M3 12h4l3-8 4 16 3-8h4"/>'),
  gear: P('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  left: P('<path d="m15 18-6-6 6-6"/>'),
  right: P('<path d="m9 18 6-6-6-6"/>'),
  menu: P('<path d="M4 7h16M4 12h16M4 17h16"/>'),
  sparkle: P('<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>'),
  x: P('<path d="M18 6 6 18M6 6l12 12"/>'),
  tick: P('<path d="M5 12.5 10 17l9-10"/>'),
  copy: P('<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>'),
  trash: P('<path d="M3 6h18M8 6V4h8v2M6 6l1 15h10l1-15"/>'),
  download: P('<path d="M12 4v11M7 10l5 5 5-5M4 20h16"/>'),
  upload: P('<path d="M12 20V9M7 14l5-5 5 5M4 4h16"/>'),
  undo: P('<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>'),
  moon: P('<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>'),
  clock: P('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
};

let modalStack = [];
export function openModal({ title = '', body = '', foot = '', wide = false, onMount, onClose, titleHtml }) {
  const root = document.getElementById('modal-root');
  const bg = document.createElement('div');
  bg.className = 'modal-bg';
  bg.innerHTML = `<div class="modal ${wide ? 'wide' : ''}" role="dialog" aria-modal="true">
    <div class="modal-head"><span class="grab"></span>${titleHtml || `<h2 style="flex:1">${esc(title)}</h2>`}<button class="btn icon ghost" data-close aria-label="Fermer">${ICON.x}</button></div>
    <div class="modal-body">${body}</div>${foot ? `<div class="modal-foot">${foot}</div>` : ''}</div>`;
  root.appendChild(bg);
  const m = bg.querySelector('.modal');
  const close = () => {
    if (!bg.isConnected) return;
    bg.remove();
    modalStack = modalStack.filter((x) => x !== close);
    document.removeEventListener('keydown', onKey);
    onClose && onClose();
  };
  const onKey = (e) => { if (e.key === 'Escape' && modalStack[modalStack.length - 1] === close) close(); };
  document.addEventListener('keydown', onKey);
  let downOnBg = false;
  bg.addEventListener('pointerdown', (e) => { downOnBg = e.target === bg; });
  bg.addEventListener('click', (e) => { if (e.target === bg && downOnBg) close(); });
  m.querySelector('[data-close]').addEventListener('click', close);
  modalStack.push(close);
  onMount && onMount(m, close);
  const first = m.querySelector('[autofocus]');
  if (first && window.matchMedia('(hover: hover)').matches) setTimeout(() => first.focus(), 30);
  return { el: m, close };
}
export const closeAllModals = () => [...modalStack].forEach((c) => c());

export function toast(msg, { action, onAction, duration = 4200 } = {}) {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = 'toast';
  t.innerHTML = `<span>${esc(msg)}</span>${action ? `<button>${esc(action)}</button>` : ''}`;
  root.appendChild(t);
  while (root.children.length > 2) root.firstElementChild.remove();
  const kill = () => t.remove();
  if (action) t.querySelector('button').addEventListener('click', () => { kill(); onAction && onAction(); });
  setTimeout(kill, duration);
}

export function confirmDialog(message, { ok = 'Confirmer', cancel = 'Annuler', danger = false, title = 'Confirmation' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const { close } = openModal({
      title,
      body: `<p style="margin:0;line-height:1.5">${message}</p>`,
      foot: `<span class="sp"></span><button class="btn" data-c>${esc(cancel)}</button><button class="btn ${danger ? 'danger' : 'primary'}" data-ok>${esc(ok)}</button>`,
      onMount: (m, cl) => {
        m.querySelector('[data-c]').onclick = () => { done = true; resolve(false); cl(); };
        m.querySelector('[data-ok]').onclick = () => { done = true; resolve(true); cl(); };
      },
      onClose: () => { if (!done) resolve(false); },
    });
  });
}

/** Choix parmi plusieurs options → valeur ou null */
export function choiceDialog(message, options, title = 'Que veux-tu modifier ?') {
  return new Promise((resolve) => {
    let done = false;
    openModal({
      title,
      body: `<p style="margin:0 0 4px;color:var(--muted)">${message}</p>${options.map((o, i) => `<button class="btn" style="justify-content:flex-start;height:40px" data-i="${i}">${esc(o.label)}</button>`).join('')}`,
      onMount: (m, cl) => m.querySelectorAll('[data-i]').forEach((b) => (b.onclick = () => { done = true; resolve(options[+b.dataset.i].value); cl(); })),
      onClose: () => { if (!done) resolve(null); },
    });
  });
}
