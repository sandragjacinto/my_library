# Notre bibliothèque — web app Google Apps Script

Petite app mobile pour chercher un livre, changer le statut de lecture d'Alice et de Sandra, et ajouter ou modifier des livres.
La Google Sheet reste la source de vérité : tout ce que vous faites dans l'app y est écrit directement.

## Fonctionnalités

- Recherche instantanée (titre, auteur·ice, thème, éditeur), sans tenir compte des accents.
- **Filtre par types à cocher :** on décoche ce qu'on ne veut pas voir (par exemple *Cuisine*), et le bouton affiche « Sans Cuisine ».
- **Filtre de lecture :** *Pas encore lu par moi* (statut vide ou « pas lu ») et *Lu par moi* en tête de liste, puis les options pour l'autre lectrice, « lu par les deux », « lu par aucune » et « avec commentaire ».
- Les types décochés et le filtre de lecture sont **mémorisés sur chaque téléphone** : chacune retrouve ses réglages à la prochaine ouverture.
- Filtre par emplacement.
- **Une PAL (pile à lire) privée pour chacune :** dans la fiche d'un livre, « 📚 Ajouter à ma PAL » le met en bas de ta pile. L'onglet **Ma PAL** affiche ta pile numérotée, avec ↑ ↓ pour changer l'ordre et « Retirer ». Personne d'autre ne la voit, ni dans l'app ni dans la Sheet. Un livre marqué « lu » sort tout seul de ta PAL (réglage `PAL_REMOVE_WHEN_READ`). On peut aussi cocher « Ajouter à ma PAL » au moment d'ajouter un nouveau livre.
- Tri par nom de famille de l'auteur·ice, par titre ou par ajout récent.
- Une pastille par lectrice : chacune ne peut toucher que **la sienne** (vide → lu → pas lu → vide). Celle de l'autre est visible mais verrouillée.
- **Un commentaire par lectrice** sur chaque livre : on écrit le sien, on lit celui de l'autre. Les commentaires sont pris en compte dans la recherche, et un filtre « Avec commentaire » permet de les retrouver.
- **Droits par personne :** l'app reconnaît qui est connectée grâce à son compte Google. Le serveur refuse toute écriture dans les colonnes de l'autre, et `setup()` protège en plus ces colonnes dans la Sheet elle-même.
- Ajout d'un livre avec remplissage automatique par ISBN (Open Library, puis Google Books en secours).
- Fiche détaillée au tap sur un livre. Les infos communes (titre, auteur·ice, emplacement…) restent modifiables par les deux, et le bouton « Retirer » est annulable.
- Mode sombre automatique, pensé pour le téléphone.

## Installation (10 minutes)

1. Ouvre la Google Sheet et vérifie que l'onglet s'appelle bien **Bibliothèque**. Les en-têtes doivent être ceux du fichier : `Titre`, `Auteur·ice(s)`, `Type`, `Thème / genre`, `Langue`, `Éditeur / collection`, `Photo`, `Remarque`, `Résumé`, `Emplacement`, `Alice`, `Sandra`.
2. Va dans **Extensions → Apps Script**.
3. Remplace le contenu de `Code.gs` par celui de ce dossier.
4. Crée un fichier HTML nommé exactement **Index** (bouton **+** puis **HTML**), et colles-y `Index.html`.
5. **Obligatoire :** dans `CONFIG.EMAILS`, remplace les deux adresses d'exemple par vos vraies adresses Google. C'est ce qui détermine qui peut modifier quoi. Une adresse absente de la liste ouvre l'app en lecture seule.
6. Sélectionne la fonction **setup** dans la barre du haut et clique sur **Exécuter**, puis accepte les autorisations. Cette fonction :
   - ajoute les colonnes manquantes : `ID`, `Commentaire Alice`, `Commentaire Sandra`, `Retiré`, `Ajouté par` ;
   - attribue un identifiant unique à chaque livre (certains titres existent en double) ;
   - protège les colonnes `Alice` et `Commentaire Alice` pour Alice seule, et celles de Sandra pour Sandra seule.
7. Clique sur **Déployer → Nouveau déploiement → Application Web** :
   - *Exécuter en tant que* : **Utilisateur accédant à l'application Web**
   - *Qui a accès* : **Tous les utilisateurs disposant d'un compte Google**
8. Copie l'URL `/exec` et envoie-la à ta conjointe. Sur le téléphone, ouvrez-la puis faites « Ajouter à l'écran d'accueil ».

Avec ce réglage, chacune agit avec son propre compte Google. Seules les personnes qui ont accès à la Sheet peuvent lire ou modifier les données, les autres voient une erreur.

## Les droits, en détail

| | Alice | Sandra |
|---|---|---|
| Statut et commentaire d'Alice | ✏️ | 👁️ |
| Statut et commentaire de Sandra | 👁️ | ✏️ |
| PAL d'Alice | ✏️ | 🚫 invisible |
| PAL de Sandra | 🚫 invisible | ✏️ |
| Infos communes, ajout, retrait | ✏️ | ✏️ |

- La protection est double : le serveur vérifie qui est connectée avant chaque écriture, et la Sheet refuse les modifications dans les colonnes protégées.
- **Une limite :** la **propriétaire** du fichier Google peut toujours tout modifier directement dans la Sheet, c'est une règle de Google. Dans l'app, elle reste limitée à ses propres colonnes.
- Pour rendre les infos communes non modifiables, mets `SHARED_EDIT: false`.
- **« Retirer » n'efface pas la ligne :** une suppression échouerait, puisque la ligne contient les colonnes protégées de l'autre. Le livre est marqué `Retiré = oui` et disparaît de l'app. Pour le remettre, efface ce « oui » dans la Sheet ou utilise « Annuler » juste après le retrait.

## Mettre à jour l'app

Après une modification du code : **Déployer → Gérer les déploiements → crayon → Version : Nouvelle version**. L'URL ne change pas.
Pour tester sans redéployer, utilise l'URL `/dev` donnée par **Déployer → Tester les déploiements**.

## Bon à savoir

- **Onglets « Zone » de l'Excel :** ce sont des listes figées au moment de l'export. Les livres ajoutés depuis l'app n'y apparaissent pas, et supprimer une ligne casse leurs formules. Dans l'app, le filtre **Emplacement** les remplace. Tu peux supprimer ces onglets dans la Sheet.
- **Écritures simultanées :** `LockService` met les écritures en file d'attente, il n'y a donc pas de conflit si vous modifiez en même temps.
- **Vitesse :** chaque écriture prend environ 1 seconde, mais l'interface n'attend pas pour les statuts de lecture.
- **Liste déroulante lu / pas lu :** elle couvre les lignes existantes. Pour les nouvelles lignes, étends la validation des données à toute la colonne (`K2:L`).
- **Ajouter une lectrice :** ajoute son prénom dans `CONFIG.READERS` et son adresse dans `CONFIG.EMAILS`, puis relance `setup()` pour créer ses colonnes et leur protection.
- **Mettre à jour vers une nouvelle version (commentaires, PAL…) :** colle les deux nouveaux fichiers, relance `setup()` pour créer et protéger les nouvelles colonnes, puis crée une **nouvelle version** du déploiement.
- **Où est stockée la PAL :** pas dans la Sheet, mais dans les *propriétés utilisateur* du script (`PropertiesService.getUserProperties()`). Comme l'app s'exécute avec le compte de la personne connectée, chacune n'a accès qu'à sa propre PAL, même la propriétaire du script ou de la Sheet.
- **Si vous aviez déjà des colonnes `PAL Alice` / `PAL Sandra` (version précédente) :** à sa première ouverture de la nouvelle version, chacune voit sa PAL copiée automatiquement en privé, et sa colonne vidée. Une fois que vous avez ouvert l'app toutes les deux, supprime ces deux colonnes de la Sheet.
- **Limite :** une PAL n'existe que dans ce script. Si tu recrées le projet Apps Script, elles repartent à zéro.

## Pistes pour la suite

- **Scan du code-barres :** l'iframe d'Apps Script n'a pas accès à la caméra. C'est le bon moment pour passer à une PWA (Supabase ou Firebase + ZXing) en important le CSV de la Sheet.
- **Couvertures :** `https://covers.openlibrary.org/b/isbn/<ISBN>-M.jpg`, à condition de stocker l'ISBN dans une nouvelle colonne.
- **Historique :** une colonne de date de lecture par lectrice, remplie automatiquement quand le statut passe à « lu ».
