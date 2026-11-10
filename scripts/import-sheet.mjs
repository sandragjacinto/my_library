#!/usr/bin/env node
/**
 * Import unique de la Google Sheet vers Supabase.
 *
 * 1. Dans la Sheet : onglet « Bibliothèque » → Fichier → Télécharger → CSV.
 * 2. Dans Supabase : Project Settings → API → copie l'URL et la clé « service_role » (secrète !).
 * 3. SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_KEY=eyJ… node scripts/import-sheet.mjs Bibliotheque.csv
 *
 * Peut être relancé sans danger : les livres sont mis à jour par ID, rien n'est dupliqué.
 * Ne commite jamais la clé service_role.
 */
import { readFileSync } from 'node:fs';

const FIELDS = {
  'Titre': 'titre', 'Auteur·ice(s)': 'auteurs', 'Type': 'type', 'Thème / genre': 'theme',
  'Langue': 'langue', 'Éditeur / collection': 'editeur', 'Photo': 'photo', 'Remarque': 'remarque',
  'Résumé': 'resume', 'Emplacement': 'emplacement', 'ISBN': 'isbn', 'Ajouté par': 'added_by',
};
const COMMENT_PREFIX = 'Commentaire ';
const STATUSES = ['lu', 'pas lu'];

const [file] = process.argv.slice(2);
const URL_ = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!file || !URL_ || !KEY) {
  console.error('Usage : SUPABASE_URL=… SUPABASE_SERVICE_KEY=… node scripts/import-sheet.mjs Bibliotheque.csv');
  process.exit(1);
}

/** Lecteur CSV (guillemets, retours à la ligne dans les cellules). */
function parseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

async function api(method, path, body, prefer = 'return=minimal') {
  const res = await fetch(`${URL_}/rest/v1/${path}`, {
    method,
    headers: { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', Prefer: prefer },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const [headers, ...data] = parseCsv(readFileSync(file, 'utf8'));
const col = h => headers.indexOf(h);
if (col('ID') === -1) throw new Error('Colonne « ID » absente : lance setup() dans Apps Script avant d\'exporter le CSV.');

const readers = (await api('GET', 'readers?select=name', undefined, '')).map(r => r.name);
if (!readers.length) throw new Error('Table readers vide : lance d\'abord supabase/schema.sql avec vos adresses.');
readers.filter(r => col(r) === -1).forEach(r => console.warn(`⚠️  Pas de colonne « ${r} » dans le CSV.`));

const books = [], readings = [], problems = [];
data.forEach((r, i) => {
  if (!r.some(c => c.trim() !== '')) return;
  const id = (r[col('ID')] || '').trim();
  if (!id) { problems.push(`ligne ${i + 2} : pas d'ID (relance setup())`); return; }
  const book = { id, removed: (r[col('Retiré')] || '').trim().toLowerCase() === 'oui', sort_order: i + 1 };
  Object.entries(FIELDS).forEach(([h, k]) => { if (col(h) !== -1) book[k] = (r[col(h)] || '').trim(); });
  books.push(book);
  readers.forEach(name => {
    let status = col(name) === -1 ? '' : (r[col(name)] || '').trim().toLowerCase();
    const comment = col(COMMENT_PREFIX + name) === -1 ? '' : (r[col(COMMENT_PREFIX + name)] || '').trim();
    if (status && !STATUSES.includes(status)) { problems.push(`ligne ${i + 2} : statut « ${status} » ignoré pour ${name}`); status = ''; }
    if (status || comment) readings.push({ book_id: id, reader: name, status: status || null, comment });
  });
});

const dup = books.map(b => b.id).filter((id, i, a) => a.indexOf(id) !== i);
if (dup.length) throw new Error(`IDs en double dans la Sheet : ${[...new Set(dup)].join(', ')}`);

const upsert = 'resolution=merge-duplicates,return=minimal';
for (let i = 0; i < books.length; i += 500) await api('POST', 'books?on_conflict=id', books.slice(i, i + 500), upsert);
for (let i = 0; i < readings.length; i += 500) await api('POST', 'readings?on_conflict=book_id,reader', readings.slice(i, i + 500), upsert);

console.log(`✅ ${books.length} livre(s), dont ${books.filter(b => b.removed).length} retiré(s), et ${readings.length} statut(s)/commentaire(s) importés.`);
problems.forEach(p => console.warn('⚠️ ', p));
