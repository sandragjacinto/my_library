/**
 * Bibliothèque familiale — web app Google Apps Script
 * La Google Sheet reste la source de vérité ; cette app lit et écrit dedans.
 *
 * Installation : voir README.md
 */

const CONFIG = {
  SHEET_NAME: 'Bibliothèque',
  READERS: ['Alice', 'Sandra'],          // noms exacts des colonnes de statut
  STATUS: ['lu', 'pas lu'],               // valeurs possibles (vide = non renseigné)
  ID_HEADER: 'ID',
  COMMENT_PREFIX: 'Commentaire ',         // colonnes « Commentaire Alice », « Commentaire Sandra »
  PAL_PREFIX: 'PAL ',                     // uniquement pour reprendre les anciennes colonnes « PAL Prénom »
  PAL_REMOVE_WHEN_READ: true,             // un livre passé à « lu » sort automatiquement de ma PAL
  // OBLIGATOIRE : l'adresse Google de chaque lectrice. C'est elle qui décide qui peut modifier quoi.
  EMAILS: {
    'alice@gmail.com': 'Alice',
    'sandra@gmail.com': 'Sandra',
  },
  // true : les infos communes du livre (titre, auteur·ice, emplacement…) sont modifiables par les deux.
  SHARED_EDIT: true,
};

// Colonnes éditables depuis le formulaire (en-têtes exacts de la feuille)
const EDITABLE = ['Titre', 'Auteur·ice(s)', 'Type', 'Thème / genre', 'Langue',
                  'Éditeur / collection', 'Remarque', 'Résumé', 'Emplacement'];

/* ---------- Web app ---------- */

function doGet() {
  return HtmlService.createTemplateFromFile('Index')
    .evaluate()
    .setTitle('Bibliothèque')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setFaviconUrl('https://fonts.gstatic.com/s/e/notoemoji/latest/1f4da/512.png');
}

/* ---------- Mise en place (à lancer une fois depuis l'éditeur) ---------- */

/**
 * À lancer une fois (et après chaque ajout de lectrice) :
 * - ajoute les colonnes manquantes (ID, statut et commentaire de chaque lectrice) ;
 * - attribue un ID unique à chaque ligne ;
 * - protège les colonnes personnelles pour que seule la bonne personne puisse les modifier.
 */
function setup() {
  const sh = sheet_();
  const needed = [CONFIG.ID_HEADER, 'Retiré', 'Ajouté par'].concat(...CONFIG.READERS.map(r => [r, CONFIG.COMMENT_PREFIX + r]));
  needed.forEach(h => {
    if (headers_(sh).indexOf(h) === -1) sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
  let headers = headers_(sh);
  const idCol = headers.indexOf(CONFIG.ID_HEADER) + 1;
  const n = sh.getLastRow() - 1;
  if (n < 1) return;
  const range = sh.getRange(2, idCol, n, 1);
  const ids = range.getValues().map(([v]) => [v || Utilities.getUuid()]);
  range.setValues(ids);
  Logger.log(`${n} lignes ont un ID.`);
  protectPersonalColumns_();
}

/** Protège les colonnes « Prénom » et « Commentaire Prénom » : seule la lectrice concernée (et la propriétaire du fichier) peut y écrire. */
function protectPersonalColumns_() {
  const sh = sheet_();
  const headers = headers_(sh);
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter(p => String(p.getDescription()).indexOf('[biblio]') === 0)
    .forEach(p => p.remove());
  const emailOf = {};
  Object.keys(CONFIG.EMAILS).forEach(e => emailOf[CONFIG.EMAILS[e]] = e);
  CONFIG.READERS.forEach(reader => {
    const email = emailOf[reader];
    if (!email) { Logger.log(`Pas d'e-mail pour ${reader} : colonnes non protégées.`); return; }
    [reader, CONFIG.COMMENT_PREFIX + reader].forEach(h => {
      const col = headers.indexOf(h) + 1;
      const p = sh.getRange(2, col, sh.getMaxRows() - 1, 1).protect().setDescription(`[biblio] ${h}`);
      p.removeEditors(p.getEditors());
      p.addEditor(email);
      if (p.canDomainEdit()) p.setDomainEdit(false);
    });
  });
  Logger.log('Colonnes personnelles protégées.');
}

/* ---------- API appelée par l'interface ---------- */

/** Données de départ : livres, lectrices, listes de choix, utilisatrice courante. */
function getInitialData() {
  const me = currentReader_();
  if (me) migrateSheetPal_(me);
  const sh = sheet_();
  const headers = headers_(sh);
  const values = sh.getDataRange().getDisplayValues(); // tout en texte : pas de Date à sérialiser
  const books = values.slice(1)
    .filter(r => r.some(c => c !== ''))
    .map(r => rowToBook_(headers, r))
    .filter(b => b['Retiré'] !== 'oui')
    .map(b => { Object.keys(b).forEach(k => { if (k.indexOf(CONFIG.PAL_PREFIX) === 0) delete b[k]; }); return b; });
  const existing = {};
  books.forEach(b => existing[b.id] = true);
  return {
    books,
    readers: CONFIG.READERS,
    statuses: CONFIG.STATUS,
    commentPrefix: CONFIG.COMMENT_PREFIX,
    me,
    myPal: me ? getMyPal_().filter(id => existing[id]) : [],
    email: Session.getActiveUser().getEmail(),
    sharedEdit: CONFIG.SHARED_EDIT,
    options: {
      types: uniq_(books.map(b => b['Type'])),
      places: uniq_(books.map(b => b['Emplacement'])),
      languages: uniq_(books.map(b => b['Langue'])),
    },
  };
}

/** Change MON statut de lecture. La lectrice est déduite du compte Google, jamais envoyée par le navigateur. */
function setStatus(id, status) {
  const me = requireReader_();
  if (status !== '' && CONFIG.STATUS.indexOf(status) === -1) throw new Error('Statut invalide : ' + status);
  writeCell_(id, me, status);
  let leftPal = false;
  if (status === 'lu' && CONFIG.PAL_REMOVE_WHEN_READ) {
    const pal = getMyPal_();
    if (pal.indexOf(id) !== -1) { saveMyPal_(pal.filter(x => x !== id)); leftPal = true; }
  }
  return { id, status, leftPal };
}

/* ---------- Pile à lire (PAL) : PRIVÉE ----------
 * La PAL n'est pas dans la Sheet : elle est stockée dans les « propriétés utilisateur » du script
 * (PropertiesService.getUserProperties). Comme l'app s'exécute avec le compte de la personne connectée,
 * chacune n'a accès qu'à sa propre PAL ; l'autre ne peut la voir ni dans l'app, ni dans la Sheet.
 */

const PAL_KEY = 'pal';
const PAL_CHUNK = 8000; // une propriété est limitée à 9 Ko : on découpe si la PAL est longue

function getMyPal_() {
  const props = PropertiesService.getUserProperties();
  const n = Number(props.getProperty(PAL_KEY + '_n') || 0);
  let json = '';
  for (let i = 0; i < n; i++) json += props.getProperty(`${PAL_KEY}_${i}`) || '';
  try { return json ? JSON.parse(json) : []; } catch (e) { return []; }
}

function saveMyPal_(ids) {
  const props = PropertiesService.getUserProperties();
  const old = Number(props.getProperty(PAL_KEY + '_n') || 0);
  const json = JSON.stringify(ids.map(String));
  const chunks = {};
  let n = 0;
  for (let i = 0; i < json.length; i += PAL_CHUNK) chunks[`${PAL_KEY}_${n++}`] = json.slice(i, i + PAL_CHUNK);
  chunks[PAL_KEY + '_n'] = String(n);
  props.setProperties(chunks);
  for (let i = n; i < old; i++) props.deleteProperty(`${PAL_KEY}_${i}`);
  return ids;
}

/** Ajoute un livre en bas de MA PAL (on = true) ou l'en retire (on = false). Renvoie ma PAL. */
function setPal(id, on) {
  requireReader_();
  id = String(id);
  const pal = getMyPal_().filter(x => x !== id);
  if (on) pal.push(id);
  return saveMyPal_(pal);
}

/** Réordonne MA PAL. On ne garde que des livres qui y étaient déjà. */
function reorderPal(orderedIds) {
  requireReader_();
  if (!Array.isArray(orderedIds)) throw new Error('Liste invalide.');
  const current = getMyPal_();
  const next = orderedIds.map(String).filter(id => current.indexOf(id) !== -1);
  current.forEach(id => { if (next.indexOf(id) === -1) next.push(id); });
  return saveMyPal_(next);
}

/**
 * Reprise des anciennes colonnes « PAL Prénom » de la Sheet (version précédente de l'app) :
 * au premier chargement, ma PAL est copiée en privé, puis ma colonne est vidée.
 */
function migrateSheetPal_(me) {
  try {
    if (getMyPal_().length) return;
    const sh = sheet_();
    const headers = headers_(sh);
    const col = headers.indexOf(CONFIG.PAL_PREFIX + me) + 1;
    if (!col || sh.getLastRow() < 2) return;
    const n = sh.getLastRow() - 1;
    const ids = sh.getRange(2, colOf_(headers, CONFIG.ID_HEADER), n, 1).getValues().map(([v]) => String(v));
    const range = sh.getRange(2, col, n, 1);
    const ranks = range.getValues().map(([v]) => v);
    const pal = ids.map((id, i) => [id, Number(ranks[i])]).filter(([, r]) => r > 0)
                   .sort((a, b) => a[1] - b[1]).map(([id]) => id);
    if (!pal.length) return;
    saveMyPal_(pal);
    range.clearContent();
  } catch (e) { /* la migration ne doit jamais bloquer l'app */ }
}

/** Change MON commentaire sur un livre. */
function setComment(id, text) {
  const me = requireReader_();
  text = clean_(text).slice(0, 5000);
  return writeCell_(id, CONFIG.COMMENT_PREFIX + me, text);
}

function writeCell_(id, header, value) {
  return withLock_(() => {
    const sh = sheet_();
    const headers = headers_(sh);
    const col = headers.indexOf(header) + 1;
    if (!col) throw new Error(`Colonne « ${header} » absente : lance setup() une fois.`);
    sh.getRange(findRow_(sh, headers, id), col).setValue(value);
    return { id, header, value };
  });
}

/**
 * Ajoute un livre. On n'écrit que dans les colonnes communes et dans MES colonnes :
 * les colonnes protégées de l'autre lectrice ne sont jamais touchées.
 */
function addBook(data) {
  const me = requireReader_();
  if (!data || !String(data['Titre'] || '').trim()) throw new Error('Le titre est obligatoire.');
  const mine = [me, CONFIG.COMMENT_PREFIX + me];
  return withLock_(() => {
    const sh = sheet_();
    const headers = headers_(sh);
    const row = sh.getLastRow() + 1;
    if (row > sh.getMaxRows()) {
      sh.insertRowsAfter(sh.getMaxRows(), 100);
      protectPersonalColumns_(); // étend la protection aux nouvelles lignes
    }
    const values = {};
    headers.forEach(h => {
      if (h === CONFIG.ID_HEADER) values[h] = Utilities.getUuid();
      else if (h === 'Photo') values[h] = 'app';
      else if (h === 'Ajouté par') values[h] = me;
      else if (EDITABLE.indexOf(h) !== -1 || mine.indexOf(h) !== -1) values[h] = clean_(data[h]);
    });
    headers.forEach((h, i) => { if (values[h]) sh.getRange(row, i + 1).setValue(values[h]); });
    return rowToBook_(headers, headers.map(h => values[h] || ''));
  });
}

/** Modifie les infos communes d'un livre (jamais les colonnes personnelles). */
function updateBook(id, data) {
  requireReader_();
  if (!CONFIG.SHARED_EDIT) throw new Error('La modification des infos communes est désactivée.');
  return withLock_(() => {
    const sh = sheet_();
    const headers = headers_(sh);
    const row = findRow_(sh, headers, id);
    const current = sh.getRange(row, 1, 1, headers.length).getValues()[0];
    headers.forEach((h, i) => {
      if (EDITABLE.indexOf(h) !== -1 && h in data && clean_(data[h]) !== clean_(current[i])) {
        sh.getRange(row, i + 1).setValue(clean_(data[h]));
      }
    });
    return rowToBook_(headers, sh.getRange(row, 1, 1, headers.length).getDisplayValues()[0]);
  });
}

/**
 * Retire un livre de la bibliothèque. La ligne n'est pas effacée (elle contient les colonnes
 * protégées de l'autre lectrice) : elle est marquée « Retiré », ce qui permet aussi d'annuler.
 */
function deleteBook(id) {
  requireReader_();
  if (!CONFIG.SHARED_EDIT) throw new Error('La suppression est désactivée.');
  return writeCell_(id, 'Retiré', 'oui');
}

/** Annule le retrait d'un livre. */
function restoreBook(id) {
  requireReader_();
  return writeCell_(id, 'Retiré', '');
}

/** Cherche un livre par ISBN : Open Library d'abord, Google Books en secours. */
function lookupIsbn(isbn) {
  isbn = String(isbn || '').replace(/[^0-9Xx]/g, '');
  if (isbn.length !== 10 && isbn.length !== 13) throw new Error('Un ISBN fait 10 ou 13 chiffres.');

  const ol = fetchJson_(`https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`);
  const o = ol && ol['ISBN:' + isbn];
  if (o) {
    return {
      'Titre': o.title || '',
      'Auteur·ice(s)': (o.authors || []).map(a => a.name).join(' & '),
      'Éditeur / collection': (o.publishers || []).map(p => p.name).join(', '),
      source: 'Open Library',
    };
  }
  const gb = fetchJson_(`https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`);
  const v = gb && gb.items && gb.items[0] && gb.items[0].volumeInfo;
  if (v) {
    return {
      'Titre': v.title + (v.subtitle ? ' – ' + v.subtitle : ''),
      'Auteur·ice(s)': (v.authors || []).join(' & '),
      'Éditeur / collection': v.publisher || '',
      'Langue': ({ fr: 'Français', pt: 'Portugais', en: 'Anglais' })[v.language] || '',
      'Résumé': v.description ? v.description.slice(0, 400) : '',
      source: 'Google Books',
    };
  }
  throw new Error('Aucun livre trouvé pour cet ISBN. Remplis les champs à la main.');
}

/* ---------- Utilitaires ---------- */

function colOf_(headers, h) {
  const c = headers.indexOf(h) + 1;
  if (!c) throw new Error(`Colonne « ${h} » absente : lance setup() une fois.`);
  return c;
}

/** Lectrice correspondant au compte Google connecté, ou null. */
function currentReader_() {
  const email = String(Session.getActiveUser().getEmail() || '').toLowerCase();
  const map = {};
  Object.keys(CONFIG.EMAILS).forEach(e => map[e.toLowerCase()] = CONFIG.EMAILS[e]);
  return map[email] || null;
}

function requireReader_() {
  const me = currentReader_();
  if (!me) throw new Error('Ton compte Google n\'est pas reconnu : l\'app est en lecture seule. Ajoute ton adresse dans CONFIG.EMAILS.');
  return me;
}

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) throw new Error(`Onglet « ${CONFIG.SHEET_NAME} » introuvable.`);
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function findRow_(sh, headers, id) {
  const idCol = headers.indexOf(CONFIG.ID_HEADER) + 1;
  if (!idCol) throw new Error('Colonne ID absente : lance setup() une fois.');
  const found = sh.getRange(2, idCol, Math.max(sh.getLastRow() - 1, 1), 1)
    .createTextFinder(String(id)).matchEntireCell(true).findNext();
  if (!found) throw new Error('Livre introuvable : il a peut-être été supprimé. Recharge la page.');
  return found.getRow();
}

function rowToBook_(headers, row) {
  const b = {};
  headers.forEach((h, i) => { if (h) b[h] = row[i] == null ? '' : String(row[i]); });
  b.id = b[CONFIG.ID_HEADER];
  return b;
}

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(10000)) throw new Error('La feuille est occupée, réessaie dans un instant.');
  try { return fn(); } finally { lock.releaseLock(); }
}

function fetchJson_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return res.getResponseCode() === 200 ? JSON.parse(res.getContentText()) : null;
  } catch (e) { return null; }
}

function clean_(v) { return v == null ? '' : String(v).trim(); }
function uniq_(arr) { return [...new Set(arr.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'fr')); }
