// Données de départ — construites à partir des réponses de l'utilisateur (22/11/2026)
// Tout ce qui est marqué "à confirmer" est une valeur provisoire, modifiable dans Réglages.
import { uid } from './util.js';

export const GROUPS = {
  sommeil: 'Sommeil & repos',
  etudes: 'Études',
  repas: 'Repas',
  sport: 'Sport',
  perso: 'Objectifs perso',
  asso: 'LeoVolley, BDE & asso',
  sorties: 'Sorties & loisirs',
  menage: 'Maison & hygiène',
  libre: 'Marge imprévus',
};

export function defaultSettings() {
  return {
    dayStart: 7, dayEnd: 23, hourHeight: 52, fitScreen: true, visualStyle: 'glass-light', weekRoutines: 'thin', theme: 'auto', defaultView: 'week',
    hiddenCats: [], monthHideRoutine: true,
    groupOrder: ['sommeil', 'etudes', 'repas', 'sport', 'perso', 'asso', 'sorties', 'menage'],
    sleepTarget: 480,
    work: { weekday: ['08:15', '18:30'], sat: ['08:30', '15:00'], sun: ['10:30', '15:30'] },
    studyBlockMax: 90, studyBlockMin: 30, pauseMin: 15,
    bufferPerDay: 0, maxWorkPerDay: 600,
    studyOnlyIfCourses: true, autoNaps: true,
    perso: { weekday: [['20:30', '22:15']], weekend: [['15:00', '19:00'], ['20:30', '22:15']], capWeekday: 60, capWeekend: 180, freeEvenings: [6] },
    toeflDate: '',
    lastBackup: 0,
  };
}

const C = (id, name, color, group, system = false, parallel = false) => ({ id, name, color, group, system, ...(parallel ? { parallel: true } : {}) });
export function defaultCategories() {
  return [
    C('cours', 'Cours en présentiel', '#34C759', 'etudes'),
    C('visio', 'Cours en visio', '#FF9500', 'etudes'),
    C('examen', 'Examens & CC', '#FF3B30', 'etudes'),
    C('revision', 'Travail perso & révisions', '#FF1493', 'etudes'),
    C('dessin', 'Dessin / manga', '#AF52DE', 'perso'),
    C('musique', 'Musique / prods', '#5856D6', 'perso'),
    C('video', 'Montage vidéo', '#32ADE6', 'perso'),
    C('sport', 'Sport, muscu & volley', '#00C7BE', 'sport'),
    C('bde', 'LeoVolley, BDE & asso', '#FFCC00', 'asso'),
    C('sorties', 'Loisirs & sorties', '#A2845E', 'sorties'),
    C('repas', 'Repas', '#C9A86A', 'repas'),
    C('hygiene', 'Hygiène / douche', '#64D2FF', 'menage'),
    C('lessive', 'Lessive', '#BF9FE6', 'menage', false, true),
    C('menage', "Rangement d'appart", '#AEAEB2', 'menage'),
    C('sommeil', 'Sommeil & repos', '#8E8E93', 'sommeil'),
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
export function routineHabits() {
  return [
    H({ title: 'Petit-déjeuner', catId: 'repas', type: 'flex', days: [1, 2, 3, 4, 5, 6, 7], window: ['07:00', '08:00'], weekendWindow: ['08:00', '11:00'], preferred: '07:00', duration: 20, minDuration: 15 }),
    H({ title: 'Douche', catId: 'hygiene', type: 'flex', days: [1, 2, 3, 4, 5, 6, 7], window: ['07:00', '08:15'], weekendWindow: ['08:00', '11:30'], preferred: '07:20', duration: 15, note: 'Moment à confirmer (matin ou après le sport ?)' }),
    H({ title: 'Lessive', catId: 'lessive', type: 'with', with: 'Musculation', times: 1, days: [1, 2, 3, 4, 5, 6, 7], duration: 60, note: 'Pendant une séance de muscu — 1 fois/semaine à confirmer' }),
  ];
}
export function defaultHabits() {
  return [
    ...routineHabits(),
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

export function seedRecurring() {
  return [
    { id: uid(), title: 'Entraînement volley', catId: 'sport', subjectId: '', start: '2026-11-19T19:30', end: '2026-11-19T21:00', location: '', notes: 'Mercredi parfois : à ajouter toi-même.', source: 'manual', recur: { freq: 'weekly', interval: 1, byDay: [4], until: '' }, exdates: ['2026-12-24', '2026-12-31'] },
    { id: uid(), title: 'Réunion BDE (respo événementiel)', catId: 'bde', subjectId: '', start: '2026-11-19T12:30', end: '2026-11-19T13:30', location: '', notes: 'Créneau variable — fin à 13h30 à confirmer.', source: 'manual', recur: { freq: 'weekly', interval: 1, byDay: [4], until: '' }, exdates: ['2026-12-24', '2026-12-31'] },
  ];
}

export function seedState() {
  return {
    version: 1,
    meta: { createdAt: Date.now(), updatedAt: Date.now(), needsInitialPlan: true, v2: true, v3: true },
    tombs: {},
    settings: defaultSettings(),
    categories: defaultCategories(),
    subjects: defaultSubjects(),
    habits: defaultHabits(),
    goals: defaultGoals(),
    tasks: defaultTasks(),
    events: [...seedRecurring()],
  };
}
