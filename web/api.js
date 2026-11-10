/**
 * Accès aux données de la PWA (Supabase).
 *
 * Ces fonctions ont les mêmes noms et renvoient les mêmes objets que celles de Code.gs dans l'app Google Script :
 * l'interface (index.html) est donc identique dans les deux apps. Les droits sont appliqués par Supabase (RLS).
 */
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';
export { lookupIsbn } from './isbn.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
});

const COMMENT_PREFIX = 'Commentaire ';
const STATUSES = ['lu', 'pas lu'];
// Colonne Supabase → nom du champ dans l'interface (= en-tête de la Google Sheet)
const FIELDS = {
  titre: 'Titre', auteurs: 'Auteur·ice(s)', type: 'Type', theme: 'Thème / genre', langue: 'Langue',
  editeur: 'Éditeur / collection', photo: 'Photo', remarque: 'Remarque', resume: 'Résumé',
  emplacement: 'Emplacement', isbn: 'ISBN', added_by: 'Ajouté par',
};
const EDITABLE = ['Titre', 'Auteur·ice(s)', 'Type', 'Thème / genre', 'Langue',
                  'Éditeur / collection', 'Remarque', 'Résumé', 'Emplacement', 'ISBN'];

const ctx = { me: null, readers: [] };

/* ---------- Connexion ---------- */

export async function getSession() {
  const { data } = await sb.auth.getSession();
  return data.session;
}

export async function sendCode(email) {
  if (!/^\S+@\S+\.\S+$/.test(email)) throw new Error('Adresse e-mail invalide.');
  const { error } = await sb.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
  if (error) throw new Error(/signups? not allowed|not found/i.test(error.message)
    ? 'Cette adresse n\'est pas inscrite. Demande à la propriétaire de l\'ajouter dans Supabase.'
    : frMessage(error));
}

export async function verifyCode(email, code) {
  const token = String(code || '').replace(/\D/g, '');
  if (token.length !== 6) throw new Error('Le code fait 6 chiffres.');
  const { error } = await sb.auth.verifyOtp({ email, token, type: 'email' });
  if (error) throw new Error(/expired|invalid/i.test(error.message) ? 'Code incorrect ou expiré.' : frMessage(error));
}

export async function signOut() { await sb.auth.signOut(); }

export function onSignedOut(fn) {
  sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT') fn(); });
}

/* ---------- Lecture ---------- */

function frMessage(e) {
  const m = String(e && e.message || e);
  if (e && e.code === '42501' || /row-level security|permission denied/i.test(m)) return 'Action refusée : ce n\'est pas ta colonne.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(m)) return 'Pas de connexion. Réessaie quand tu as du réseau.';
  return m;
}

function check({ data, error }) {
  if (error) throw new Error(frMessage(error));
  return data;
}

/** Lit toute une table, page par page (Supabase renvoie au plus 1000 lignes par requête). */
async function fetchAll(build) {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const page = check(await build().range(from, from + 999));
    out.push(...page);
    if (page.length < 1000) return out;
  }
}

/** Ligne Supabase + statuts/commentaires → livre au format de l'interface (comme une ligne de la Sheet). */
function toBook(row, readings = []) {
  const b = { id: row.id, ID: row.id, 'Retiré': row.removed ? 'oui' : '' };
  Object.entries(FIELDS).forEach(([k, h]) => { b[h] = row[k] ?? ''; });
  ctx.readers.forEach(n => { b[n] = ''; b[COMMENT_PREFIX + n] = ''; });
  readings.forEach(r => { b[r.reader] = r.status || ''; b[COMMENT_PREFIX + r.reader] = r.comment || ''; });
  return b;
}

/** Champs du formulaire → colonnes Supabase (seuls les champs communs modifiables). */
function toRow(data) {
  const row = {};
  Object.entries(FIELDS).forEach(([k, h]) => {
    if (!EDITABLE.includes(h) || !(h in data)) return;
    const v = String(data[h] ?? '').trim();
    row[k] = h === 'ISBN' ? v.replace(/[^0-9Xx]/g, '').toUpperCase() : v;
  });
  return row;
}

const uniq = arr => [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr'));

async function loadPal() {
  return check(await sb.from('pal').select('book_id').order('position')).map(r => r.book_id);
}

/** Données de départ : livres, lectrices, listes de choix, utilisatrice courante. */
export async function getInitialData() {
  const session = await getSession();
  const [readers, me, books, readings, pal] = await Promise.all([
    sb.from('readers').select('name').order('position').then(check),
    sb.rpc('my_reader').then(check),
    fetchAll(() => sb.from('books').select('*').eq('removed', false).order('sort_order').order('id')),
    fetchAll(() => sb.from('readings').select('book_id, reader, status, comment').order('book_id').order('reader')),
    loadPal(),
  ]);
  ctx.me = me || null;
  ctx.readers = readers.map(r => r.name);
  const byBook = {};
  readings.forEach(r => (byBook[r.book_id] ||= []).push(r));
  const list = books.map(row => toBook(row, byBook[row.id]));
  const existing = new Set(list.map(b => b.id));
  return {
    books: list,
    readers: ctx.readers,
    statuses: STATUSES,
    commentPrefix: COMMENT_PREFIX,
    me: ctx.me,
    myPal: ctx.me ? pal.filter(id => existing.has(id)) : [],
    email: session?.user?.email || '',
    sharedEdit: true,
    options: {
      types: uniq(list.map(b => b['Type'])),
      places: uniq(list.map(b => b['Emplacement'])),
      languages: uniq(list.map(b => b['Langue'])),
    },
  };
}

/* ---------- Écriture ---------- */

function requireReader() {
  if (!ctx.me) throw new Error('Ton adresse n\'est pas dans la liste des lectrices : lecture seule.');
  return ctx.me;
}

async function upsertReading(bookId, fields) {
  const reader = requireReader();
  check(await sb.from('readings').upsert({ book_id: bookId, reader, ...fields }, { onConflict: 'book_id,reader' }));
}

/** Change MON statut. La base retire d'elle-même un livre « lu » de la PAL : on regarde seulement s'il y était. */
export async function setStatus(id, status) {
  requireReader();
  if (status !== '' && !STATUSES.includes(status)) throw new Error('Statut invalide : ' + status);
  const leftPal = status === 'lu' && (await loadPal()).includes(id);
  await upsertReading(id, { status: status || null });
  return { id, status, leftPal };
}

export async function setComment(id, text) {
  const me = requireReader();
  const value = String(text ?? '').trim().slice(0, 5000);
  await upsertReading(id, { comment: value });
  return { id, header: COMMENT_PREFIX + me, value };
}

/* ---------- Pile à lire (privée) ---------- */

async function savePal(ids) {
  const reader = requireReader();
  ids = ids.map(String);
  if (ids.length) {
    check(await sb.from('pal').upsert(ids.map((book_id, position) => ({ reader, book_id, position })),
                                      { onConflict: 'reader,book_id' }));
  }
  let del = sb.from('pal').delete().eq('reader', reader);
  if (ids.length) del = del.not('book_id', 'in', `(${ids.map(i => `"${i}"`).join(',')})`);
  check(await del);
  return ids;
}

/** Ajoute un livre en bas de MA PAL (on = true) ou l'en retire. Renvoie ma PAL. */
export async function setPal(id, on) {
  requireReader();
  const pal = (await loadPal()).filter(x => x !== id);
  if (on) pal.push(id);
  return savePal(pal);
}

/** Réordonne MA PAL. On ne garde que des livres qui y étaient déjà. */
export async function reorderPal(orderedIds) {
  requireReader();
  const current = await loadPal();
  const next = orderedIds.map(String).filter(id => current.includes(id));
  current.forEach(id => { if (!next.includes(id)) next.push(id); });
  return savePal(next);
}

/* ---------- Livres ---------- */

export async function addBook(data) {
  const me = requireReader();
  if (!String(data['Titre'] || '').trim()) throw new Error('Le titre est obligatoire.');
  const row = check(await sb.from('books')
    .insert({ id: crypto.randomUUID(), photo: 'app', ...toRow(data) }).select().single());
  const status = STATUSES.includes(data[me]) ? data[me] : '';
  const comment = String(data[COMMENT_PREFIX + me] || '').trim().slice(0, 5000);
  const readings = [];
  if (status || comment) {
    await upsertReading(row.id, { status: status || null, comment });
    readings.push({ reader: me, status, comment });
  }
  return toBook(row, readings);
}

/** Modifie les infos communes d'un livre (jamais les statuts ni les commentaires). */
export async function updateBook(id, data) {
  requireReader();
  const row = check(await sb.from('books').update(toRow(data)).eq('id', id).select().single());
  const readings = check(await sb.from('readings').select('reader, status, comment').eq('book_id', id));
  return toBook(row, readings);
}

/** Retire un livre (rien n'est effacé : il est marqué « Retiré », ce qui permet d'annuler). */
export async function deleteBook(id) {
  requireReader();
  check(await sb.from('books').update({ removed: true }).eq('id', id));
  return { id };
}

export async function restoreBook(id) {
  requireReader();
  check(await sb.from('books').update({ removed: false }).eq('id', id));
  return { id };
}
