/**
 * Synchronisation Supabase → Google Sheet.
 *
 * Supabase est la source de vérité : la PWA et cette app y écrivent. La Sheet est un miroir,
 * rafraîchi à l'ouverture de l'app, après chaque modification faite ici, et toutes les 5 minutes.
 * Les modifications faites à la main dans la Sheet ne sont PAS envoyées vers Supabase.
 */

// Colonne Supabase → en-tête de la Sheet
const SHEET_FIELDS = {
  titre: 'Titre', auteurs: 'Auteur·ice(s)', type: 'Type', theme: 'Thème / genre', langue: 'Langue',
  editeur: 'Éditeur / collection', photo: 'Photo', remarque: 'Remarque', resume: 'Résumé',
  emplacement: 'Emplacement', isbn: 'ISBN', added_by: 'Ajouté par',
};
const SYNC_KEY = 'SYNC_LAST';
const SYNC_OVERLAP_MS = 2 * 60 * 1000;   // on relit 2 min en arrière : une écriture en cours n'est jamais ratée
const SYNC_CELL_LIMIT = 50;              // au-delà, on réécrit des colonnes entières (plus rapide)

/** Déclencheur toutes les 5 minutes (installé par installSync). */
function syncNow() { return pullChanges_(); }

/**
 * À lancer UNE fois depuis l'éditeur, par la propriétaire de la Sheet, APRÈS avoir relié son compte
 * dans l'app (le déclencheur utilise sa session Supabase).
 */
function installSync() {
  if (!sbLinked_()) throw new Error('Ouvre d\'abord l\'app et relie ton compte à la base, puis relance installSync().');
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'syncNow')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('syncNow').timeBased().everyMinutes(5).create();
  Logger.log(pullChanges_());
}

/** Force une resynchronisation complète au prochain passage (à lancer depuis l'éditeur si besoin). */
function resetSync() {
  PropertiesService.getScriptProperties().deleteProperty(SYNC_KEY);
  Logger.log(pullChanges_());
}

/** Récupère ce qui a changé dans Supabase depuis la dernière fois et l'écrit dans la Sheet. */
function pullChanges_() {
  const props = PropertiesService.getScriptProperties();
  const last = props.getProperty(SYNC_KEY);
  const since = last ? new Date(new Date(last).getTime() - SYNC_OVERLAP_MS).toISOString() : null;
  const ch = sbRpc_('changes_since', { since });
  if (ch.books.length || ch.readings.length) withLock_(() => applyChanges_(ch));
  props.setProperty(SYNC_KEY, ch.now);
  return { books: ch.books.length, readings: ch.readings.length };
}

/** Comme pullChanges_, mais une panne ne bloque pas : la Sheet sera rattrapée au prochain passage. */
function pullQuietly_() {
  try { pullChanges_(); } catch (e) { Logger.log('Synchro différée : ' + e.message); }
}

function applyChanges_(ch) {
  const sh = sheet_();
  const headers = headers_(sh);
  const width = headers.length;
  const idCol = headers.indexOf(CONFIG.ID_HEADER);
  if (idCol === -1) throw new Error('Colonne ID absente : lance setup() une fois.');
  const lastRow = sh.getLastRow();
  const n = Math.max(lastRow - 1, 0);
  const range = n ? sh.getRange(2, 1, n, width) : null;
  const shown = range ? range.getDisplayValues() : [];
  const formulas = range ? range.getFormulas() : [];

  const rowOf = {};
  shown.forEach((r, i) => { if (r[idCol]) rowOf[r[idCol]] = i; });
  const dirty = [];                 // [ligne, colonne, valeur] pour les livres déjà dans la Sheet
  const newRows = [], newIndex = {};

  const set = (id, header, value) => {
    const j = headers.indexOf(header);
    if (j === -1) return;
    value = value == null ? '' : String(value);
    if (id in rowOf) { if (shown[rowOf[id]][j] !== value) dirty.push([rowOf[id], j, value]); }
    else if (id in newIndex) newRows[newIndex[id]][j] = value;
  };

  ch.books.forEach(b => {
    if (!(b.id in rowOf) && !(b.id in newIndex)) {
      newIndex[b.id] = newRows.length;
      const r = new Array(width).fill('');
      r[idCol] = b.id;
      newRows.push(r);
    }
    Object.keys(SHEET_FIELDS).forEach(k => set(b.id, SHEET_FIELDS[k], b[k]));
    set(b.id, 'Retiré', b.removed ? 'oui' : '');
  });
  ch.readings.forEach(r => {
    set(r.book_id, r.reader, r.status || '');
    set(r.book_id, CONFIG.COMMENT_PREFIX + r.reader, r.comment || '');
  });

  if (dirty.length <= SYNC_CELL_LIMIT) {
    dirty.forEach(([i, j, v]) => sh.getRange(i + 2, j + 1).setValue(v));
  } else {
    // Réécriture par colonne entière, en gardant les formules des cellules non modifiées.
    const next = shown.map((r, i) => r.map((v, j) => formulas[i][j] || v));
    const cols = {};
    dirty.forEach(([i, j, v]) => { next[i][j] = v; cols[j] = true; });
    Object.keys(cols).forEach(j => sh.getRange(2, Number(j) + 1, n, 1).setValues(next.map(r => [r[j]])));
  }

  if (newRows.length) {
    const need = lastRow + newRows.length - sh.getMaxRows();
    if (need > 0) sh.insertRowsAfter(sh.getMaxRows(), need + 100);
    sh.getRange(lastRow + 1, 1, newRows.length, width).setValues(newRows);
  }
}
