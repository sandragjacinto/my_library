/**
 * Bibliothèque familiale — web app Google Apps Script
 *
 * Les données vivent dans Supabase, partagées avec la PWA (dossier web/).
 * Cette app écrit dans Supabase en ton nom, puis met à jour la Google Sheet, qui sert de miroir (voir Sync.gs).
 *
 * Installation : voir README.md
 */

const CONFIG = {
  SHEET_NAME: "Bibliothèque",
  READERS: ["Alice", "Sandra"], // noms exacts des colonnes de statut (et de la table readers de Supabase)
  STATUS: ["lu", "pas lu"], // valeurs possibles (vide = non renseigné)
  ID_HEADER: "ID",
  COMMENT_PREFIX: "Commentaire ", // colonnes « Commentaire Alice », « Commentaire Sandra »
  PAL_PREFIX: "PAL ", // anciennes colonnes « PAL Prénom », masquées dans l'app
  // OBLIGATOIRE : l'adresse Google de chaque lectrice (les mêmes que dans la table readers de Supabase).
  EMAILS: {
    "mariette.alice@gmail.com": "Alice",
    "sandragjacinto@gmail.com": "Sandra",
  },
  // Les infos communes du livre (titre, auteur·ice, emplacement…) sont modifiables par les deux
  // (c'est aussi la règle côté Supabase).
  SHARED_EDIT: true,
};

// Colonnes éditables depuis le formulaire (en-têtes exacts de la feuille)
const EDITABLE = [
  "Titre",
  "Auteur·ice(s)",
  "Type",
  "Thème / genre",
  "Langue",
  "Éditeur / collection",
  "Remarque",
  "Résumé",
  "Emplacement",
  "ISBN",
];

/* ---------- Web app ---------- */

function doGet() {
  return HtmlService.createTemplateFromFile("Index")
    .evaluate()
    .setTitle("Bibliothèque")
    .addMetaTag(
      "viewport",
      "width=device-width, initial-scale=1, viewport-fit=cover",
    )
    .setFaviconUrl(
      "https://fonts.gstatic.com/s/e/notoemoji/latest/1f4da/512.png",
    );
}

/* ---------- Mise en place (à lancer depuis l'éditeur, par la propriétaire de la Sheet) ---------- */

/**
 * À lancer une fois (et après chaque ajout de lectrice) :
 * - ajoute les colonnes manquantes (ID, ISBN, statut et commentaire de chaque lectrice…) ;
 * - attribue un ID unique à chaque ligne ;
 * - remplace les anciennes protections par colonne par un simple avertissement sur tout l'onglet :
 *   la synchro doit pouvoir écrire les colonnes des deux lectrices, et c'est Supabase qui fait respecter les droits.
 */
function setup() {
  const sh = sheet_();
  const needed = [CONFIG.ID_HEADER, "Retiré", "Ajouté par", "ISBN"].concat(
    ...CONFIG.READERS.map((r) => [r, CONFIG.COMMENT_PREFIX + r]),
  );
  needed.forEach((h) => {
    if (headers_(sh).indexOf(h) === -1)
      sh.getRange(1, sh.getLastColumn() + 1).setValue(h);
  });
  const headers = headers_(sh);
  sh.getRange(1, colOf_(headers, "ISBN"), sh.getMaxRows(), 1).setNumberFormat(
    "@",
  ); // ISBN en texte, pas en nombre
  const n = sh.getLastRow() - 1;
  if (n >= 1) {
    const range = sh.getRange(2, colOf_(headers, CONFIG.ID_HEADER), n, 1);
    range.setValues(range.getValues().map(([v]) => [v || Utilities.getUuid()]));
    Logger.log(`${n} lignes ont un ID.`);
  }
  protectAsMirror_();
}

function protectAsMirror_() {
  const sh = sheet_();
  sh.getProtections(SpreadsheetApp.ProtectionType.RANGE)
    .filter((p) => String(p.getDescription()).indexOf("[biblio]") === 0)
    .forEach((p) => p.remove());
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET)
    .filter((p) => String(p.getDescription()).indexOf("[biblio]") === 0)
    .forEach((p) => p.remove());
  sh.protect()
    .setDescription(
      "[biblio] Miroir de la base : modifie les livres depuis l'app, les changements faits ici ne sont pas synchronisés.",
    )
    .setWarningOnly(true);
  Logger.log("Onglet protégé par un avertissement.");
}

/* ---------- API appelée par l'interface ---------- */

/** Données de départ : livres, lectrices, listes de choix, utilisatrice courante. */
function getInitialData() {
  const reader = currentReader_();
  let me = null,
    warning = "";
  if (reader && sbLinked_()) {
    try {
      pullChanges_();
      me = reader;
    } catch (e) {
      warning = `La base est injoignable (${e.message}). L'app est en lecture seule pour l'instant.`;
    }
  }
  const sh = sheet_();
  const headers = headers_(sh);
  const values = sh.getDataRange().getDisplayValues(); // tout en texte : pas de Date à sérialiser
  const books = values
    .slice(1)
    .filter((r) => r.some((c) => c !== ""))
    .map((r) => rowToBook_(headers, r))
    .filter((b) => b["Retiré"] !== "oui")
    .map((b) => {
      Object.keys(b).forEach((k) => {
        if (k.indexOf(CONFIG.PAL_PREFIX) === 0) delete b[k];
      });
      return b;
    });
  const existing = {};
  books.forEach((b) => (existing[b.id] = true));
  let myPal = [];
  if (me) {
    try {
      migrateLegacyPal_(existing);
      myPal = getMyPal_().filter((id) => existing[id]);
    } catch (e) {
      warning = "Impossible de lire ta PAL : " + e.message;
    }
  }
  return {
    books,
    readers: CONFIG.READERS,
    statuses: CONFIG.STATUS,
    commentPrefix: CONFIG.COMMENT_PREFIX,
    me,
    myPal,
    link: reader && !sbLinked_() ? reader : null, // reconnue, mais compte pas encore relié à la base
    warning,
    email: currentEmail_(),
    sharedEdit: CONFIG.SHARED_EDIT,
    options: {
      types: uniq_(books.map((b) => b["Type"])),
      places: uniq_(books.map((b) => b["Emplacement"])),
      languages: uniq_(books.map((b) => b["Langue"])),
    },
  };
}

/** Change MON statut de lecture. La lectrice est déduite du compte Google, jamais envoyée par le navigateur. */
function setStatus(id, status) {
  const me = requireReader_();
  if (status !== "" && CONFIG.STATUS.indexOf(status) === -1)
    throw new Error("Statut invalide : " + status);
  // La base retire d'elle-même un livre « lu » de la PAL : on regarde seulement s'il y était.
  const leftPal = status === "lu" && getMyPal_().indexOf(String(id)) !== -1;
  sbUpsertReading_(id, me, { status: status || null });
  pullQuietly_();
  return { id, status, leftPal };
}

/** Change MON commentaire sur un livre. */
function setComment(id, text) {
  const me = requireReader_();
  text = clean_(text).slice(0, 5000);
  sbUpsertReading_(id, me, { comment: text });
  pullQuietly_();
  return { id, header: CONFIG.COMMENT_PREFIX + me, value: text };
}

/* ---------- Pile à lire (PAL) : PRIVÉE ----------
 * La PAL est dans Supabase (table pal), partagée avec la PWA. Les règles RLS font que chacune
 * ne peut lire et modifier que la sienne.
 */

function getMyPal_() {
  return (sb_("get", "pal?select=book_id&order=position") || []).map((r) =>
    String(r.book_id),
  );
}

function saveMyPal_(ids) {
  const me = requireReader_();
  ids = ids.map(String);
  if (ids.length) {
    sb_(
      "post",
      "pal?on_conflict=reader,book_id",
      ids.map((book_id, position) => ({ reader: me, book_id, position })),
      "resolution=merge-duplicates,return=minimal",
    );
  }
  const others = ids.length
    ? "&book_id=" +
      encodeURIComponent(`not.in.(${ids.map((i) => `"${i}"`).join(",")})`)
    : "";
  sb_(
    "delete",
    "pal?reader=eq." + encodeURIComponent(me) + others,
    undefined,
    "return=minimal",
  );
  return ids;
}

/** Ajoute un livre en bas de MA PAL (on = true) ou l'en retire (on = false). Renvoie ma PAL. */
function setPal(id, on) {
  requireReader_();
  id = String(id);
  const pal = getMyPal_().filter((x) => x !== id);
  if (on) pal.push(id);
  return saveMyPal_(pal);
}

/** Réordonne MA PAL. On ne garde que des livres qui y étaient déjà. */
function reorderPal(orderedIds) {
  requireReader_();
  if (!Array.isArray(orderedIds)) throw new Error("Liste invalide.");
  const current = getMyPal_();
  const next = orderedIds
    .map(String)
    .filter((id) => current.indexOf(id) !== -1);
  current.forEach((id) => {
    if (next.indexOf(id) === -1) next.push(id);
  });
  return saveMyPal_(next);
}

/**
 * Reprise de l'ancienne PAL, rangée dans les propriétés utilisateur du script (version précédente) :
 * si ma PAL est vide dans la base, elle y est copiée dans le même ordre, puis l'ancienne est effacée.
 */
function migrateLegacyPal_(existing) {
  const props = PropertiesService.getUserProperties();
  const n = Number(props.getProperty("pal_n") || 0);
  if (!n) return;
  let json = "";
  for (let i = 0; i < n; i++) json += props.getProperty(`pal_${i}`) || "";
  let legacy = [];
  try {
    legacy = JSON.parse(json || "[]")
      .map(String)
      .filter((id) => existing[id]);
  } catch (e) {
    /* illisible : ignorée */
  }
  if (legacy.length && !getMyPal_().length) saveMyPal_(legacy);
  for (let i = 0; i < n; i++) props.deleteProperty(`pal_${i}`);
  props.deleteProperty("pal_n");
}

/** Ajoute un livre (infos communes + MON statut et MON commentaire). */
function addBook(data) {
  const me = requireReader_();
  if (!data || !clean_(data["Titre"]))
    throw new Error("Le titre est obligatoire.");
  const id = Utilities.getUuid();
  const row = Object.assign({ id, photo: "app" }, bookFields_(data));
  sb_("post", "books", row, "return=minimal");
  let status = clean_(data[me]);
  if (CONFIG.STATUS.indexOf(status) === -1) status = "";
  const comment = clean_(data[CONFIG.COMMENT_PREFIX + me]).slice(0, 5000);
  if (status || comment)
    sbUpsertReading_(id, me, { status: status || null, comment });
  pullQuietly_();
  return bookFromSheet_(id, () => {
    const b = {
      id,
      [CONFIG.ID_HEADER]: id,
      Photo: "app",
      "Ajouté par": me,
      [me]: status,
      [CONFIG.COMMENT_PREFIX + me]: comment,
    };
    EDITABLE.forEach((h) => (b[h] = clean_(data[h])));
    return b;
  });
}

/** Modifie les infos communes d'un livre (jamais les colonnes personnelles). */
function updateBook(id, data) {
  requireReader_();
  if (!CONFIG.SHARED_EDIT)
    throw new Error("La modification des infos communes est désactivée.");
  const fields = bookFields_(data);
  if (Object.keys(fields).length) sbPatchBook_(id, fields);
  pullQuietly_();
  return bookFromSheet_(id, () => {
    throw new Error(
      "Modifié, mais la Sheet n'est pas encore à jour : recharge la page.",
    );
  });
}

/**
 * Retire un livre de la bibliothèque. Rien n'est effacé : le livre est marqué « Retiré », ce qui permet d'annuler.
 */
function deleteBook(id) {
  requireReader_();
  if (!CONFIG.SHARED_EDIT) throw new Error("La suppression est désactivée.");
  sbPatchBook_(id, { removed: true });
  pullQuietly_();
  return { id };
}

/** Annule le retrait d'un livre. */
function restoreBook(id) {
  requireReader_();
  sbPatchBook_(id, { removed: false });
  pullQuietly_();
  return { id };
}

/** Cherche un livre par ISBN : Open Library d'abord, Google Books en secours. */
function lookupIsbn(isbn) {
  isbn = String(isbn || "").replace(/[^0-9Xx]/g, "");
  if (isbn.length !== 10 && isbn.length !== 13)
    throw new Error("Un ISBN fait 10 ou 13 chiffres.");

  const ol = fetchJson_(
    `https://openlibrary.org/api/books?bibkeys=ISBN:${isbn}&format=json&jscmd=data`,
  );
  const o = ol && ol["ISBN:" + isbn];
  if (o) {
    return {
      Titre: o.title || "",
      "Auteur·ice(s)": (o.authors || []).map((a) => a.name).join(" & "),
      "Éditeur / collection": (o.publishers || [])
        .map((p) => p.name)
        .join(", "),
      source: "Open Library",
    };
  }
  const gb = fetchJson_(
    `https://www.googleapis.com/books/v1/volumes?q=isbn:${isbn}`,
  );
  const v = gb && gb.items && gb.items[0] && gb.items[0].volumeInfo;
  if (v) {
    return {
      Titre: v.title + (v.subtitle ? " – " + v.subtitle : ""),
      "Auteur·ice(s)": (v.authors || []).join(" & "),
      "Éditeur / collection": v.publisher || "",
      Langue:
        { fr: "Français", pt: "Portugais", en: "Anglais" }[v.language] || "",
      Résumé: v.description ? v.description.slice(0, 400) : "",
      source: "Google Books",
    };
  }
  throw new Error(
    "Aucun livre trouvé pour cet ISBN. Remplis les champs à la main.",
  );
}

/* ---------- Utilitaires ---------- */

/** Champs communs envoyés par le formulaire → colonnes Supabase (seules les colonnes éditables passent). */
function bookFields_(data) {
  const out = {};
  Object.keys(SHEET_FIELDS).forEach((k) => {
    const h = SHEET_FIELDS[k];
    if (EDITABLE.indexOf(h) === -1 || !data || !(h in data)) return;
    out[k] =
      h === "ISBN"
        ? clean_(data[h])
            .replace(/[^0-9Xx]/g, "")
            .toUpperCase()
        : clean_(data[h]);
  });
  return out;
}

/** Le livre tel qu'il est dans la Sheet ; `fallback()` si la synchro n'a pas encore eu lieu. */
function bookFromSheet_(id, fallback) {
  const sh = sheet_();
  const headers = headers_(sh);
  try {
    return rowToBook_(
      headers,
      sh
        .getRange(findRow_(sh, headers, id), 1, 1, headers.length)
        .getDisplayValues()[0],
    );
  } catch (e) {
    return fallback();
  }
}

function colOf_(headers, h) {
  const c = headers.indexOf(h) + 1;
  if (!c) throw new Error(`Colonne « ${h} » absente : lance setup() une fois.`);
  return c;
}

function currentEmail_() {
  return String(Session.getActiveUser().getEmail() || "").toLowerCase();
}

/** Lectrice correspondant au compte Google connecté, ou null. */
function currentReader_() {
  const map = {};
  Object.keys(CONFIG.EMAILS).forEach(
    (e) => (map[e.toLowerCase()] = CONFIG.EMAILS[e]),
  );
  return map[currentEmail_()] || null;
}

function requireReader_() {
  const me = currentReader_();
  if (!me)
    throw new Error(
      "Ton compte Google n'est pas reconnu : l'app est en lecture seule. Ajoute ton adresse dans CONFIG.EMAILS.",
    );
  if (!sbLinked_())
    throw new Error(
      "Relie d'abord ton compte à la base (bandeau en haut de l'app).",
    );
  return me;
}

function sheet_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    CONFIG.SHEET_NAME,
  );
  if (!sh) throw new Error(`Onglet « ${CONFIG.SHEET_NAME} » introuvable.`);
  return sh;
}

function headers_(sh) {
  return sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
}

function findRow_(sh, headers, id) {
  const idCol = headers.indexOf(CONFIG.ID_HEADER) + 1;
  if (!idCol) throw new Error("Colonne ID absente : lance setup() une fois.");
  const found = sh
    .getRange(2, idCol, Math.max(sh.getLastRow() - 1, 1), 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .findNext();
  if (!found)
    throw new Error(
      "Livre introuvable : il a peut-être été supprimé. Recharge la page.",
    );
  return found.getRow();
}

function rowToBook_(headers, row) {
  const b = {};
  headers.forEach((h, i) => {
    if (h) b[h] = row[i] == null ? "" : String(row[i]);
  });
  b.id = b[CONFIG.ID_HEADER];
  return b;
}

function withLock_(fn) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000))
    throw new Error("La feuille est occupée, réessaie dans un instant.");
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

function fetchJson_(url) {
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    return res.getResponseCode() === 200
      ? JSON.parse(res.getContentText())
      : null;
  } catch (e) {
    return null;
  }
}

function clean_(v) {
  return v == null ? "" : String(v).trim();
}
function uniq_(arr) {
  return [...new Set(arr.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, "fr"),
  );
}
