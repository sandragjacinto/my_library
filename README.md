# Notre bibliothèque — deux apps, une seule base

Petite bibliothèque partagée : chercher un livre, noter si Alice ou Sandra l'a lu, le commenter, gérer sa pile à lire, ajouter ou modifier des livres.

Il y a **deux apps qui montrent les mêmes données** :

| | App mobile (PWA) | App Google Script |
|---|---|---|
| Appareils | téléphone **et ordinateur** (Mac, Ubuntu) | tout navigateur |
| Adresse | `https://<compte>.github.io/my_library/` | l'URL `/exec` de toujours |
| Scanner le code-barres | ✅ | ❌ (pas d'accès à la caméra) |
| Connexion | code reçu par e-mail | compte Google, relié une fois à la base |
| Vitesse | instantané | ~1 s par modification |

Tout ce que tu fais dans l'une apparaît dans l'autre.

## Comment c'est organisé

```
   App mobile (web/)  ──┐
                        ├──►  Supabase (la base, source de vérité)
   App Google Script ───┘            │
           ▲                         │ synchro (à l'ouverture, après chaque modif, toutes les 5 min)
           └──── Google Sheet ◄──────┘  (miroir en lecture)
```

- **Supabase** contient les livres, les statuts, les commentaires et les PAL. Les deux apps y écrivent directement.
- **La Google Sheet est un miroir.** L'app Google Script la met à jour depuis Supabase et l'affiche. On peut toujours la consulter, la trier, l'exporter… mais **une modification faite à la main dans la Sheet n'est pas synchronisée** (et sera écrasée la prochaine fois que ce livre changera). Un avertissement s'affiche si on essaie.

## Fonctionnalités

- Recherche instantanée (titre, auteur·ice, thème, éditeur, commentaires), sans tenir compte des accents.
- **Filtre par types à cocher :** on décoche ce qu'on ne veut pas voir (par exemple *Cuisine*), et le bouton affiche « Sans Cuisine ».
- **Filtre de lecture :** *Pas encore lu par moi* et *Lu par moi* en tête, puis l'autre lectrice, « lu par les deux », « lu par aucune » et « avec commentaire ».
- Les types décochés et le filtre de lecture sont **mémorisés sur chaque téléphone**.
- Filtre par emplacement ; tri par nom de famille de l'auteur·ice, par titre ou par ajout récent.
- Une pastille par lectrice : chacune ne peut toucher que **la sienne** (vide → lu → pas lu → vide).
- **Un commentaire par lectrice** sur chaque livre.
- **Une PAL (pile à lire) privée pour chacune**, la même dans les deux apps : « 📚 Ajouter à ma PAL », onglet **Ma PAL** avec ↑ ↓ et « Retirer ». Un livre marqué « lu » sort tout seul de ta PAL.
- **Scan du code-barres (app mobile) :** dans « Ajouter un livre », touche 📷 et vise le code-barres au dos. L'ISBN est lu, puis le titre, l'auteur·ice et l'éditeur sont remplis automatiquement (Open Library, puis Google Books en secours). Si le livre est **déjà dans la bibliothèque**, l'app te le dit et te propose de l'ouvrir : pratique en librairie !
- L'ISBN est maintenant enregistré (colonne `ISBN`).
- Fiche détaillée au tap sur un livre ; infos communes modifiables par les deux ; « Retirer » est annulable.
- Mode sombre automatique, pensé pour le téléphone. L'app mobile s'installe sur l'écran d'accueil, et aussi **sur l'ordinateur** (Mac, Ubuntu) comme une vraie app, avec sa fenêtre et son icône.
- **Raccourcis clavier (ordinateur) :** `/` ou `Ctrl+K` (`⌘K` sur Mac) pour chercher, `N` pour ajouter un livre, `Échap` pour effacer la recherche. Clic droit sur l'icône de l'app installée → « Ajouter un livre ».

## Installation (environ 45 minutes, une seule fois)

### 1. Supabase (la base)

1. Crée un compte sur [supabase.com](https://supabase.com) puis un projet (région : Europe, par exemple *Paris* ou *Frankfurt*).
2. Ouvre `supabase/schema.sql`. Tout en bas, **remplace les deux adresses** par vos vraies adresses e-mail (en minuscules). Les noms doivent être exactement ceux des colonnes de la Sheet (`Alice`, `Sandra`).
3. Dans Supabase : **SQL Editor → New query**, colle tout le fichier et clique sur **Run**.
4. **Authentication → Sign In / Providers** : laisse **Email** activé, et **désactive « Allow new users to sign up »** (seules vos deux adresses pourront se connecter).
5. **Authentication → Users → Add user → Create new user** : crée un compte pour chacune des deux adresses, avec **« Auto Confirm User » coché**. Le mot de passe ne servira jamais : mets-en un long au hasard.
6. **Envoi des e-mails (SMTP)** : l'envoi intégré de Supabase ne permet pas de modifier les modèles d'e-mail, n'écrit qu'aux membres de l'équipe Supabase (Alice ne recevrait rien) et n'envoie que quelques e-mails par heure. On passe donc par Gmail, gratuitement :
   - sur le compte Google qui enverra les codes, active la **validation en deux étapes** ;
   - sur <https://myaccount.google.com/apppasswords>, crée un mot de passe d'application `Supabase` et copie les 16 lettres (sans espaces) ;
   - dans Supabase, **Authentication → Emails → SMTP Settings** : active **Enable custom SMTP**. Sender email et Username : ton adresse Gmail ; Sender name : `Notre bibliothèque` ; Host : `smtp.gmail.com` ; Port : `465` ; Password : le mot de passe d'application. Enregistre.
7. **Authentication → Emails → Templates → Magic Link** (modifiable une fois le SMTP configuré) : mets comme sujet `Ton code pour la bibliothèque`, puis dans l'onglet **Source** remplace le contenu par un message qui contient le code, par exemple :
   ```html
   <h2>Ton code pour la bibliothèque</h2>
   <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
   <p>Il est valable quelques minutes.</p>
   ```
   On se connecte avec ce code plutôt qu'avec un lien, parce que sur iPhone un lien s'ouvrirait dans Safari et pas dans l'app installée.
8. **Project Settings → API Keys** : note l'**URL du projet**, la clé **publishable** `sb_publishable_…` (publique ; « anon » dans l'onglet Legacy) et la clé **secrète** `sb_secret_…` (bouton Reveal ; « service_role » dans l'onglet Legacy). La clé secrète ne sert qu'à l'import de l'étape 3.

### 2. App Google Script (et préparation de la Sheet)

1. Dans la Google Sheet : **Extensions → Apps Script**.
2. Remplace `Code.gs` et `Index` par ceux de ce dossier, et crée deux nouveaux fichiers de script **Supabase** et **Sync** (bouton **+** puis **Script**) avec le contenu de `Supabase.gs` et `Sync.gs`. (Ou utilise `clasp push` : `.claspignore` n'envoie que ces fichiers.)
3. Dans `CONFIG.EMAILS`, mets vos vraies adresses Google (les mêmes que dans Supabase).
4. **Paramètres du projet (⚙️) → Propriétés du script** : ajoute `SUPABASE_URL` (l'URL du projet) et `SUPABASE_ANON_KEY` (la clé anon, **pas** la clé service_role).
5. Sélectionne la fonction **setup** et clique sur **Exécuter** (accepte les autorisations). Elle :
   - ajoute les colonnes manquantes (`ID`, `ISBN`, `Retiré`, `Ajouté par`, commentaires…) ;
   - donne un identifiant unique à chaque livre ;
   - remplace les anciennes protections par colonne par un **avertissement** sur tout l'onglet. C'est maintenant Supabase qui fait respecter les droits.

### 3. Importer les livres dans Supabase

1. Dans la Sheet, onglet **Bibliothèque** : **Fichier → Télécharger → Valeurs séparées par des virgules (.csv)**.
2. Sur ton ordinateur (Node 18 ou plus) :
   ```sh
   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... node scripts/import-sheet.mjs ~/Téléchargements/Bibliotheque.csv
   ```
   Le script affiche le nombre de livres importés et signale les statuts qu'il n'a pas compris. On peut le relancer sans créer de doublons. **Ne commite jamais la clé service_role.**

### 4. Mettre en ligne la nouvelle app Google Script

1. **Déployer → Gérer les déploiements → crayon → Version : Nouvelle version.** L'URL `/exec` ne change pas.
2. Chacune ouvre l'app : un bandeau propose de **relier son compte à la base**. Touche « Recevoir un code par e-mail », puis tape le code. C'est à faire une seule fois. Ta PAL de l'ancienne version est alors copiée automatiquement dans la base, dans le même ordre.
3. La propriétaire de la Sheet, **après avoir relié son compte**, retourne dans l'éditeur et lance **installSync** : la Sheet sera mise à jour toutes les 5 minutes, même quand personne n'ouvre l'app.

### 5. Mettre en ligne l'app mobile

1. Dans `web/config.js`, mets l'URL du projet et la clé **anon** (elles sont publiques par nature, les règles de la base protègent les données).
2. Sur GitHub : **Settings → Pages → Source : GitHub Actions**. Puis pousse sur `main` : l'app est publiée sur `https://<compte>.github.io/my_library/`.
   - GitHub Pages sur un dépôt **privé** demande un abonnement payant. Le dépôt ne contient aucun secret : tu peux le rendre public, ou héberger le dossier `web/` ailleurs (Cloudflare Pages, Netlify…).
3. Sur chaque téléphone :
   - **iPhone :** ouvre l'adresse dans Safari, **Partager → Sur l'écran d'accueil**, puis ouvre l'app depuis l'écran d'accueil et **connecte-toi là** (l'app installée et Safari ne partagent pas la connexion).
   - **Android :** ouvre l'adresse dans Chrome, connecte-toi, puis **⋮ → Installer l'application**.
4. Sur chaque ordinateur :
   - **Chrome, Chromium ou Edge (Mac et Ubuntu) :** ouvre l'adresse, puis clique sur l'icône d'installation à droite de la barre d'adresse (ou **⋮ → Caster, enregistrer et partager → Installer la page en tant qu'application**). L'app apparaît dans le Dock (Mac) ou dans la liste des applications (Ubuntu) ; tu peux l'y épingler.
   - **Safari sur Mac (macOS 14 ou plus) :** **Fichier → Ajouter au Dock**, puis ouvre l'app depuis le Dock et **connecte-toi là** (comme sur iPhone, la connexion n'est pas partagée avec Safari).
   - **Ubuntu :** utilise Chrome ou Chromium. Firefox ne sait pas installer les apps web, mais l'adresse marche très bien dans un onglet normal.
   - Le scan marche aussi avec la webcam (tiens le code-barres face à la caméra), mais taper l'ISBN est souvent plus simple sur ordinateur.

## Les droits, en détail

| | Alice | Sandra |
|---|---|---|
| Statut et commentaire d'Alice | ✏️ | 👁️ |
| Statut et commentaire de Sandra | 👁️ | ✏️ |
| PAL d'Alice | ✏️ | 🚫 invisible |
| PAL de Sandra | 🚫 invisible | ✏️ |
| Infos communes, ajout, retrait | ✏️ | ✏️ |

- Les règles sont dans la base (**Row Level Security** de Supabase, voir `supabase/schema.sql`). Elles s'appliquent pareil aux deux apps : l'app Google Script parle à la base au nom de la personne connectée. Elle vérifie en plus qui est connectée avant chaque écriture.
- Une adresse qui n'est pas dans la table `readers` ne peut pas se connecter à l'app mobile. Dans l'app Google Script, elle voit les livres en lecture seule.
- **« Retirer » n'efface rien :** le livre est marqué `Retiré` et disparaît des apps. Pour le remettre, utilise « Annuler » juste après, ou mets `removed` à `false` dans Supabase (**Table Editor → books**).
- **Une limite :** la propriétaire du **projet Supabase** voit tout dans le tableau de bord de Supabase, PAL comprises. Dans les apps, elle reste limitée à ses propres colonnes.

## Mettre à jour les apps

- **App Google Script :** après une modification du code, **Déployer → Gérer les déploiements → crayon → Nouvelle version**. Pour tester sans redéployer, utilise l'URL `/dev` (**Déployer → Tester les déploiements**).
- **App mobile :** pousse sur `main`, GitHub la republie en une minute. Augmente `VERSION` dans `web/sw.js` pour que les téléphones prennent tout de suite la nouvelle version.
- **Tester l'app mobile sur l'ordinateur :** `python3 -m http.server -d web 8000` puis ouvre `http://localhost:8000`. La caméra ne fonctionne qu'en `localhost` ou en HTTPS.
- **Base :** `supabase/schema.sql` peut être relancé sans danger après une modification.

## Bon à savoir

- **Délai de la Sheet :** l'app Google Script est toujours à jour (elle synchronise à l'ouverture). La Sheet elle-même peut avoir jusqu'à 5 minutes de retard sur l'app mobile.
- **Modifications en même temps :** chaque modification touche un seul champ, donc il n'y a pas de conflit. Si vous modifiez le même champ du même livre au même moment, la dernière modification gagne.
- **Synchro complète :** si la Sheet semble décalée, lance **resetSync** dans l'éditeur Apps Script : toute la Sheet est recomparée avec la base.
- **« La base est injoignable » :** l'app Google Script affiche alors la Sheet en lecture seule. Vérifie les propriétés du script et que le projet Supabase n'est pas en pause.
- **Projet Supabase gratuit :** il se met en pause après une semaine sans activité. La synchro toutes les 5 minutes le garde actif ; si besoin, relance-le depuis le tableau de bord.
- **E-mails de connexion :** le service d'e-mail intégré de Supabase est limité à quelques envois par heure, c'est suffisant pour deux personnes. Une fois connectée, on le reste.
- **« Ta connexion à la base a expiré » (app Google Script) :** recharge l'app et relie de nouveau ton compte.
- **Onglets « Zone » de l'Excel :** ce sont des listes figées. Le filtre **Emplacement** les remplace ; tu peux les supprimer.
- **Ajouter une lectrice :** ajoute une ligne dans la table `readers` (Supabase), crée son compte (**Authentication → Users**), ajoute son prénom dans `CONFIG.READERS` et son adresse dans `CONFIG.EMAILS`, puis relance `setup()` pour créer ses colonnes dans la Sheet.
- **Anciennes colonnes `PAL Alice` / `PAL Sandra` :** elles ne servent plus et sont masquées dans les apps, tu peux les supprimer de la Sheet.

## Pistes pour la suite

- **Couvertures :** l'ISBN est maintenant enregistré, il suffit d'afficher `https://covers.openlibrary.org/b/isbn/<ISBN>-M.jpg` dans la fiche.
- **Historique :** une date de lecture par lectrice, remplie automatiquement quand le statut passe à « lu » (un trigger dans `schema.sql`, une colonne de plus dans la Sheet).
- **Mode hors connexion :** garder la dernière liste en cache sur le téléphone pour consulter sans réseau.
