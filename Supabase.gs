/**
 * Accès à Supabase depuis l'app Google Script, AU NOM de la lectrice connectée.
 *
 * Chacune « relie » une fois son compte : elle reçoit un code par e-mail, et la session
 * Supabase obtenue est rangée dans SES propriétés utilisateur (privées, même pour la propriétaire du script).
 * Les règles de sécurité (RLS) de Supabase s'appliquent donc exactement comme dans la PWA.
 *
 * Propriétés du script à renseigner (Paramètres du projet → Propriétés du script) :
 *   SUPABASE_URL       https://xxxx.supabase.co
 *   SUPABASE_ANON_KEY  la clé « anon / publishable » (publique, ce n'est PAS la clé service_role)
 */

const SB_SESSION_KEY = 'sb_session';

function sbConfig_() {
  const p = PropertiesService.getScriptProperties();
  const url = p.getProperty('SUPABASE_URL'), key = p.getProperty('SUPABASE_ANON_KEY');
  if (!url || !key) throw new Error('Supabase n\'est pas configuré : ajoute SUPABASE_URL et SUPABASE_ANON_KEY dans les propriétés du script.');
  return { url: url.replace(/\/$/, ''), key };
}

/* ---------- Session de la lectrice ---------- */

function sbSession_() {
  try { return JSON.parse(PropertiesService.getUserProperties().getProperty(SB_SESSION_KEY) || 'null'); }
  catch (e) { return null; }
}

function sbSaveSession_(s) {
  PropertiesService.getUserProperties().setProperty(SB_SESSION_KEY, JSON.stringify({
    access_token: s.access_token,
    refresh_token: s.refresh_token,
    expires_at: s.expires_at || Math.floor(Date.now() / 1000) + (s.expires_in || 3600),
  }));
}

function sbLinked_() { return !!sbSession_(); }

/** Interface : envoie un code à l'adresse du compte Google connecté. */
function sendLinkCode() {
  if (!currentReader_()) throw new Error('Ton compte Google n\'est pas dans CONFIG.EMAILS.');
  const email = currentEmail_();
  sbAuth_('otp', { email, create_user: false });
  return email;
}

/** Interface : vérifie le code reçu et enregistre la session. */
function verifyLinkCode(code) {
  const token = String(code || '').replace(/\D/g, '');
  if (token.length < 6 || token.length > 10) throw new Error('Tape le code reçu par e-mail (6 à 10 chiffres).');
  const s = sbAuth_('verify', { type: 'email', email: currentEmail_(), token });
  if (!s.access_token) throw new Error('Code refusé.');
  sbSaveSession_(s);
  return true;
}

/** À lancer depuis l'éditeur pour « délier » son compte (ou depuis l'app en cas de souci). */
function unlinkAccount() { PropertiesService.getUserProperties().deleteProperty(SB_SESSION_KEY); }

function sbAuth_(path, body) {
  const { url, key } = sbConfig_();
  const res = UrlFetchApp.fetch(`${url}/auth/v1/${path}`, {
    method: 'post', contentType: 'application/json', headers: { apikey: key },
    payload: JSON.stringify(body), muteHttpExceptions: true,
  });
  const code = res.getResponseCode(), json = parseJson_(res.getContentText());
  if (code >= 300) {
    const msg = (json && (json.msg || json.error_description || json.message)) || `erreur ${code}`;
    const err = new Error(/expired|invalid/i.test(msg) && path === 'verify' ? 'Code incorrect ou expiré.' : msg);
    err.status = code;
    throw err;
  }
  return json || {};
}

/** Jeton d'accès valide (rafraîchi si besoin, un seul rafraîchissement à la fois). */
function sbAccessToken_() {
  let s = sbSession_();
  if (!s) throw new Error('Relie d\'abord ton compte à la base (bandeau en haut de l\'app).');
  if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
  const lock = LockService.getUserLock();
  lock.waitLock(15000);
  try {
    s = sbSession_();
    if (!s) throw new Error('Relie d\'abord ton compte à la base.');
    if (s.expires_at - 60 > Date.now() / 1000) return s.access_token;
    try {
      const fresh = sbAuth_('token?grant_type=refresh_token', { refresh_token: s.refresh_token });
      sbSaveSession_(fresh);
      return fresh.access_token;
    } catch (e) {
      if (e.status >= 400 && e.status < 500) {
        unlinkAccount();
        throw new Error('Ta connexion à la base a expiré : recharge l\'app et relie ton compte.');
      }
      throw e;
    }
  } finally { lock.releaseLock(); }
}

/* ---------- API REST ---------- */

/** Appel REST Supabase (PostgREST) en tant que la lectrice connectée. */
function sb_(method, path, body, prefer) {
  const { url, key } = sbConfig_();
  const opts = {
    method, muteHttpExceptions: true,
    headers: { apikey: key, Authorization: 'Bearer ' + sbAccessToken_() },
  };
  if (prefer) opts.headers.Prefer = prefer;
  if (body !== undefined) { opts.contentType = 'application/json'; opts.payload = JSON.stringify(body); }
  const res = UrlFetchApp.fetch(`${url}/rest/v1/${path}`, opts);
  const code = res.getResponseCode(), json = parseJson_(res.getContentText());
  if (code >= 300) {
    if (json && json.code === '42501') throw new Error('Action refusée par la base : ce n\'est pas ta colonne.');
    throw new Error('Base : ' + ((json && (json.message || json.msg)) || `erreur ${code}`));
  }
  return json;
}

function sbRpc_(fn, args) { return sb_('post', 'rpc/' + fn, args || {}); }

/** Écrit MON statut et/ou MON commentaire (crée la ligne si besoin). */
function sbUpsertReading_(bookId, reader, fields) {
  const row = Object.assign({ book_id: String(bookId), reader }, fields);
  return sb_('post', 'readings?on_conflict=book_id,reader', [row], 'resolution=merge-duplicates,return=minimal');
}

function sbPatchBook_(bookId, fields) {
  return sb_('patch', 'books?id=eq.' + encodeURIComponent(bookId), fields, 'return=minimal');
}

function parseJson_(text) {
  try { return text ? JSON.parse(text) : null; } catch (e) { return null; }
}
