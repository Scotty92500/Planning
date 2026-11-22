// Données de départ — construites à partir des réponses de l'utilisateur (22/11/2026)
// Tout ce qui est marqué "à confirmer" est une valeur provisoire, modifiable dans Réglages.
import { uid } from './util.js';

export const GROUPS = {
  sommeil: 'Sommeil & repos',
  etudes: 'Études',
  repas: 'Repas',
  sport: 'Sport',
  perso: 'Objectifs perso',
  asso: 'Volley & BDE',
  sorties: 'Sorties & loisirs',
  menage: 'Rangement',
  libre: 'Marge imprévus',
};

export function defaultSettings() {
  return {
    dayStart: 7, dayEnd: 24, hourHeight: 52, theme: 'auto', defaultView: 'week',
    hiddenCats: [], monthHideRoutine: true,
    groupOrder: ['sommeil', 'etudes', 'repas', 'sport', 'perso', 'asso', 'sorties', 'menage'],
    sleepTarget: 480,
    work: { weekday: ['08:15', '18:30'], sat: ['08:30', '15:00'], sun: ['10:30', '15:30'] },
    studyBlockMax: 90, studyBlockMin: 30, pauseMin: 15,
    bufferPerDay: 30, maxWorkPerDay: 600,
    studyOnlyIfCourses: true, autoNaps: true,
    perso: { weekday: [['20:30', '22:15']], weekend: [['15:00', '19:00'], ['20:30', '22:15']], capWeekday: 60, capWeekend: 180, freeEvenings: [6] },
    toeflDate: '',
    lastBackup: 0,
  };
}

const C = (id, name, color, group, system = false) => ({ id, name, color, group, system });
export function defaultCategories() {
  return [
    C('cours', 'Cours', '#4f7cff', 'etudes'),
    C('examen', 'Examens & CC', '#dc2626', 'etudes'),
    C('revision', 'Travail perso & révisions', '#16a34a', 'etudes'),
    C('dessin', 'Dessin / manga', '#d946ef', 'perso'),
    C('musique', 'Musique / prods', '#8b5cf6', 'perso'),
    C('video', 'Montage vidéo', '#f97316', 'perso'),
    C('sport', 'Sport & musculation', '#ef4444', 'sport'),
    C('volley', 'Volley & LeoVolley', '#eab308', 'asso'),
    C('bde', 'Asso & BDE', '#06b6d4', 'asso'),
    C('sorties', 'Loisirs & sorties', '#ec4899', 'sorties'),
    C('repas', 'Repas', '#65a30d', 'repas'),
    C('menage', "Rangement d'appart", '#a8a29e', 'menage'),
    C('sommeil', 'Sommeil & repos', '#64748b', 'sommeil'),
    C('libre', 'Marge imprévus', '#94a3b8', 'libre', true),
  ];
}

const S = (id, name, color, weight, aliases = [], revise = true) => ({ id, name, color, weight, revise, examDate: '', aliases });
export function defaultSubjects() {
  return [
    S('algebre', 'Algèbre linéaire', '#6366f1', 3),
    S('mecaflu', 'Mécanique des fluides', '#0ea5e9', 3, ['Méca. Fluides', 'Méca flu']),
    S('algo', 'Algorithmique & POO', '#10b981', 3),
    S('sdd', 'Structures de données', '#14b8a6', 3),
    S('stats', 'Introduction aux statistiques', '#f59e0b', 2),
    S('series', 'Séries', '#a855f7', 2),
    S('rdm', 'Résistance des matériaux', '#78716c', 2),
    S('syselec', 'Systèmes électroniques', '#f43f5e', 2),
    S('greenit', 'Green IT', '#22c55e', 2),
    S('toefl', 'TOEFL', '#3b82f6', 1, ['TOEFL Preparation']),
    S('bdd', 'Conception de bases de données', '#0891b2', 2),
  ];
}

// type: 'fixed' (heure fixe) | 'flex' (fenêtre, chaque jour coché) | 'weekly' (N fois / semaine)
const H = (o) => ({ id: uid(), enabled: true, minDuration: o.duration, note: '', ...o });
export function defaultHabits() {
  return [
    H({ title: 'Sommeil', catId: 'sommeil', type: 'fixed', days: [7, 1, 2, 3, 4], start: '23:00', duration: 480, minDuration: 300 }),
    H({ title: 'Sommeil', catId: 'sommeil', type: 'fixed', days: [5], start: '23:00', duration: 540, minDuration: 300, note: 'Réveil samedi 8h — à confirmer' }),
    H({ title: 'Sommeil', catId: 'sommeil', type: 'fixed', days: [6], start: '23:00', duration: 660, minDuration: 300, note: 'Grasse matinée dimanche (réveil 10h) — à confirmer' }),
    H({ title: 'Lecture', catId: 'sommeil', type: 'fixed', days: [1, 2, 3, 4, 5, 6, 7], start: '22:30', duration: 30 }),
    H({ title: 'Écriture de paroles', catId: 'musique', type: 'fixed', days: [1, 2, 3, 4, 5, 6, 7], start: '22:15', duration: 15 }),
    H({ title: 'Rangement du matin', catId: 'menage', type: 'flex', days: [1, 2, 3, 4, 5], window: ['07:00', '08:15'], preferred: '07:30', duration: 15 }),
    H({ title: 'Déjeuner', catId: 'repas', type: 'flex', days: [1, 2, 3, 4, 5], window: ['11:15', '14:00'], preferred: '12:00', duration: 90, minDuration: 45 }),
    H({ title: 'Déjeuner', catId: 'repas', type: 'flex', days: [6, 7], window: ['12:00', '14:30'], preferred: '12:30', duration: 90, minDuration: 45 }),
    H({ title: 'Dîner', catId: 'repas', type: 'flex', days: [1, 2, 3, 4, 5, 6, 7], window: ['18:30', '21:30'], preferred: '19:30', duration: 90, minDuration: 45 }),
    H({ title: 'Batch cooking de la semaine', catId: 'repas', type: 'weekly', days: [7, 6], times: 1, window: ['15:00', '19:30'], preferred: '17:00', duration: 120, minDuration: 120 }),
    H({ title: 'Musculation', catId: 'sport', type: 'weekly', days: [1, 3, 6, 2, 7], times: 3, window: ['18:30', '19:30'], weekendWindow: ['15:00', '19:00'], preferred: '18:30', duration: 60, minDuration: 60, note: 'En plus du sport du vendredi matin' }),
    H({ title: 'Grand rangement', catId: 'menage', type: 'weekly', days: [6, 7], times: 1, window: ['14:00', '19:00'], preferred: '16:00', duration: 60, minDuration: 30 }),
  ];
}

export function defaultGoals() {
  const st = (t) => ({ id: uid(), title: t, done: false });
  return [
    { id: uid(), title: 'Créer mon propre manga', desc: 'Sur tablette graphique — je débute.', catId: 'dessin', due: '2027-06-30', priority: 'moyenne', progress: 0, subtasks: [st('Prendre en main la tablette et le logiciel'), st('Bases : formes, perspective, anatomie'), st('Créer les personnages principaux')], weeklyMinutes: 210, sessionMin: 60, days: [1, 2, 3, 4, 5, 6, 7], when: 'auto', active: true },
    { id: uid(), title: 'Faire mes prods et un album', desc: 'Créer mes propres sons ; écrire des paroles 15 min chaque soir (déjà planifié).', catId: 'musique', due: '2027-06-30', priority: 'moyenne', progress: 0, subtasks: [st('Choisir et prendre en main un logiciel de MAO'), st('Finir une première prod'), st('Lister les titres de l’album')], weeklyMinutes: 210, sessionMin: 60, days: [1, 2, 3, 4, 5, 6, 7], when: 'auto', active: true },
    { id: uid(), title: 'Montage vidéo', desc: 'Tourner pendant la semaine, monter le week-end.', catId: 'video', due: '2027-06-30', priority: 'moyenne', progress: 0, subtasks: [st('Définir le format des vidéos'), st('Monter la première vidéo')], weeklyMinutes: 120, sessionMin: 60, days: [6, 7], when: 'auto', active: true },
    { id: uid(), title: 'Partiels de janvier : rattraper Algèbre, Méca flu, Programmation', desc: 'Du 4 au 7 janvier. Faire le meilleur possible ; renforcer les autres matières. Les révisions sont réparties automatiquement selon la priorité des matières et la date de chaque examen.', catId: 'revision', due: '2027-01-07', priority: 'élevée', progress: 0, subtasks: [st('Fiches Algèbre linéaire'), st('Fiches Mécanique des fluides'), st('Exercices Algorithmique & POO / Structures de données')], weeklyMinutes: 0, sessionMin: 60, days: [1, 2, 3, 4, 5, 6, 7], when: 'auto', active: true },
    { id: uid(), title: 'TOEFL niveau C1', desc: 'Certification le samedi 19/12 (9h–13h). Entraînement intensif à partir du 5/12 (placé automatiquement).', catId: 'revision', due: '2026-12-19', priority: 'élevée', progress: 0, subtasks: [{ ...st('Fixer la date de la certification'), done: true }, st('Faire un test blanc')], weeklyMinutes: 0, sessionMin: 60, days: [1, 2, 3, 4, 5, 6, 7], when: 'auto', active: true },
  ];
}

export function defaultTasks() {
  return [
    { id: uid(), title: 'Réviser les CC du samedi 28/11 (Séries, Algèbre linéaire, Algo & POO)', due: '2026-11-27', priority: 'élevée', estimate: 180, catId: 'revision', subjectId: '', status: 'à faire', notes: 'Séries 8h30, Algèbre 9h45, Algo & POO 11h00.' },
  ];
}

const rec = (title, kind, subjectId, d, s, e, location, catId = 'cours') => ({
  id: uid(), title: kind ? `${title} [${kind}]` : title, catId, subjectId, start: `${d}T${s}`, end: `${d}T${e}`, location, notes: '', source: 'import',
});
/** Cours de la semaine du 16/11 (capture envoyée par l'utilisateur) */
export function seedCourses() {
  return [
    rec('Green IT', 'CAo', 'greenit', '2026-11-16', '08:15', '09:45', 'ZOOM'),
    rec('Green IT', 'CAo', 'greenit', '2026-11-16', '10:00', '11:30', 'ZOOM'),
    rec('Structures de données', 'CMo', 'sdd', '2026-11-16', '13:30', '15:00', 'ZOOM'),
    rec('Algèbre linéaire', 'CMo', 'algebre', '2026-11-16', '17:00', '18:30', 'NCHA-101, ZOOM'),
    rec('Introduction aux statistiques', 'TD', 'stats', '2026-11-17', '08:15', '09:45', 'NCHA-104'),
    rec('Algèbre linéaire', 'TD', 'algebre', '2026-11-17', '10:00', '11:30', 'NCHA-108'),
    rec('Algèbre linéaire', 'TD', 'algebre', '2026-11-17', '11:45', '13:15', 'NCHA-108'),
    rec('Green IT', 'CA', 'greenit', '2026-11-17', '15:15', '16:45', 'NCHA-108'),
    rec('Green IT', 'CA', 'greenit', '2026-11-17', '17:00', '18:30', 'NCHA-108'),
    rec('Réservation - International', 'NR', '', '2026-11-18', '08:15', '20:15', 'NCHA-101, NCHA-006 Coworking'),
    rec('Algorithmique & POO', 'TP', 'algo', '2026-11-19', '08:15', '09:45', 'NCHA-113'),
    rec('Algorithmique & POO', 'TP', 'algo', '2026-11-19', '10:00', '11:30', 'NCHA-113'),
    rec('TOEFL Preparation', 'LV', 'toefl', '2026-11-19', '13:30', '15:00', 'NCHA-008'),
    rec('Réservation - Réunion', 'NR', '', '2026-11-19', '15:15', '16:45', 'NCHA-006 Coworking'),
    rec('Résistance des matériaux', 'TD', 'rdm', '2026-11-19', '17:00', '18:30', 'NCHA-115'),
    rec('Sport Nantes', 'SP', '', '2026-11-20', '10:00', '11:30', 'Hors campus', 'sport'),
    rec('Séries', 'TD', 'series', '2026-11-20', '13:30', '15:00', 'NCHA-109'),
    rec('Systèmes électroniques', 'TP', 'syselec', '2026-11-20', '17:00', '18:30', 'NCHA-001'),
    rec('Systèmes électroniques', 'TP', 'syselec', '2026-11-20', '18:45', '20:15', 'NCHA-001'),
  ];
}

export function seedRecurring() {
  return [
    { id: uid(), title: 'Entraînement volley', catId: 'volley', subjectId: '', start: '2026-11-19T19:30', end: '2026-11-19T21:00', location: '', notes: 'Mercredi parfois : à ajouter toi-même.', source: 'manual', recur: { freq: 'weekly', interval: 1, byDay: [4], until: '' }, exdates: ['2026-12-24', '2026-12-31'] },
    { id: uid(), title: 'Réunion BDE (respo événementiel)', catId: 'bde', subjectId: '', start: '2026-11-19T12:30', end: '2026-11-19T13:30', location: '', notes: 'Créneau variable — fin à 13h30 à confirmer.', source: 'manual', recur: { freq: 'weekly', interval: 1, byDay: [4], until: '' }, exdates: ['2026-12-24', '2026-12-31'] },
  ];
}

export function seedState() {
  return {
    version: 1,
    meta: { createdAt: Date.now(), updatedAt: Date.now(), needsInitialPlan: true },
    settings: defaultSettings(),
    categories: defaultCategories(),
    subjects: defaultSubjects(),
    habits: defaultHabits(),
    goals: defaultGoals(),
    tasks: defaultTasks(),
    events: [...seedRecurring()],
  };
}
