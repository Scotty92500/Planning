// Utilitaires dates & divers — toutes les dates sont en heure locale, stockées "YYYY-MM-DDTHH:MM"
export const pad = (n) => String(n).padStart(2, '0');
export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-5);

export function parseDT(s) {
  const [d, t = '00:00'] = s.split('T');
  const [y, m, dd] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return new Date(y, m - 1, dd, h || 0, mi || 0);
}
export const parseD = (s) => parseDT(s + 'T00:00');
export const fmtD = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDT = (d) => `${fmtD(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtHM = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
export const fmtTime = (d) => `${d.getHours()}:${pad(d.getMinutes())}`;

export function dayStart(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
export function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
export const addMin = (d, n) => new Date(d.getTime() + n * 60000);
export const diffMin = (a, b) => Math.round((b - a) / 60000);
export const diffDays = (a, b) => Math.round((dayStart(b) - dayStart(a)) / 86400000);
export function startOfWeek(d) { const x = dayStart(d); return addDays(x, -((x.getDay() + 6) % 7)); }
export function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
export const isoDow = (d) => ((d.getDay() + 6) % 7) + 1; // 1 = lundi … 7 = dimanche
export const isWeekend = (d) => isoDow(d) >= 6;
export const sameDay = (a, b) => fmtD(a) === fmtD(b);

export const hm2min = (s) => { const [h, m] = String(s).split(':').map(Number); return (h || 0) * 60 + (m || 0); };
export const min2hm = (m) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
/** date du jour `day` + m minutes (m peut dépasser 1440) */
export function atMin(day, m) { const x = dayStart(day); x.setMinutes(m); return x; }
export const minOfDay = (d) => d.getHours() * 60 + d.getMinutes();

export const DOW_SHORT = ['', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const DOW_LETTER = ['', 'L', 'M', 'M', 'J', 'V', 'S', 'D'];
export const DOW_LONG = ['', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
export const MONTHS_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];

export function fmtDayLong(d) { return `${DOW_LONG[isoDow(d)]} ${d.getDate()} ${MONTHS[d.getMonth()]}`; }
export function fmtDur(min) {
  min = Math.round(min);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h${pad(m)}` : `${h}h`;
}
export function fmtHours(min) { const h = min / 60; return (Math.round(h * 10) / 10).toString().replace('.', ',') + ' h'; }

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const snap = (m, step) => Math.round(m / step) * step;

/** intervalles [s,e] en ms : soustraction */
export function subtractIntervals(free, busy) {
  let res = free.map((f) => [...f]);
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

/** Couleur de texte lisible + fond teinté pour une couleur hex */
export function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(v, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
