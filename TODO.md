# TODO: setting up the two apps

Every step to do once, in this order. Tick the boxes as you go.
The README has more detail in French for each part.

**Before you start, have:**
- Node 18 or newer on your computer (`node --version`).
- Owner access to the Google Sheet.
- The real email addresses of Alice and Sandra: the Google account each of you uses to open the Google Script app.

---

## 0. Make a backup

- [ ] In the Google Sheet: **File → Make a copy**. Keep it until everything works.

## 1. Create the Supabase database

- [ ] Create an account on [supabase.com](https://supabase.com), then a new project (region: Europe, e.g. Paris or Frankfurt). Save the database password somewhere safe.
- [ ] Open `supabase/schema.sql`. At the very bottom, replace `alice@gmail.com` and `sandra@gmail.com` with your real addresses, **in lowercase**. Keep the names `Alice` and `Sandra` exactly as they are.
- [ ] In Supabase: **SQL Editor → New query**, paste the whole file, click **Run**. It should end with "Success".
- [ ] **Authentication → Sign In / Providers**: keep **Email** on, and turn **off** "Allow new users to sign up".
- [ ] **Authentication → Users → Add user → Create new user**: create Alice's account, with **"Auto Confirm User" ticked** and any long random password (it is never used).
- [ ] Do the same for Sandra's account.
- [ ] **Authentication → Emails → Templates → Magic Link**: replace the content with:
  ```html
  <h2>Ton code pour la bibliothèque</h2>
  <p style="font-size:28px;letter-spacing:4px"><b>{{ .Token }}</b></p>
  <p>Il est valable quelques minutes.</p>
  ```
  Save. Without `{{ .Token }}`, nobody can log in.
- [ ] **Project Settings → API**: copy these three values somewhere private for the next steps:
  - the **Project URL** (`https://xxxx.supabase.co`)
  - the **anon / publishable** key (public)
  - the **service_role** key (**secret**; only used in step 3, never paste it in a file of the repo)

## 2. Update the Google Script app

- [ ] In `Code.gs`, in `CONFIG.EMAILS` (near the top), replace the two placeholder addresses with your real ones.
- [ ] In the Google Sheet: **Extensions → Apps Script**.
- [ ] Replace the content of `Code.gs` and `Index` with the files from this repo.
- [ ] Click **+ → Script**, name it `Supabase`, paste `Supabase.gs`.
- [ ] Click **+ → Script**, name it `Sync`, paste `Sync.gs`.
  (Alternative to the four steps above: `clasp push`.)
- [ ] **Project Settings (⚙️) → Script properties → Add property**:
  - `SUPABASE_URL` = the Project URL
  - `SUPABASE_ANON_KEY` = the **anon** key (not the service_role one)
- [ ] Select the function **setup** in the toolbar, click **Run**, and accept the permissions. It adds the `ID` and `ISBN` columns and gives every book an ID.

## 3. Copy the books into Supabase

This must come **after** `setup()`, because the import needs the `ID` column.

- [ ] In the Sheet, on the **Bibliothèque** tab: **File → Download → Comma-separated values (.csv)**.
- [ ] In a terminal, in this repo folder (use your own URL, key and file path):
  ```sh
  SUPABASE_URL=https://xxxx.supabase.co SUPABASE_SERVICE_KEY=eyJ... node scripts/import-sheet.mjs ~/Downloads/Bibliotheque.csv
  ```
- [ ] Check the message: `✅ N livre(s)…`. N should match the number of books in the Sheet. Read any `⚠️` lines (unreadable statuses are skipped).
- [ ] Optional: in Supabase **Table Editor → books**, check a few books.
- [ ] Delete the CSV file and clear the service_role key from your terminal history if you want to be extra careful.

## 4. Publish the new Google Script app

- [ ] In Apps Script: **Deploy → Manage deployments → pencil ✏️ → Version: New version → Deploy**. The `/exec` URL stays the same.
- [ ] **Sandra:** open the app. A banner offers to link your account: tap "Recevoir un code par e-mail", then type the 6-digit code. Your old PAL is copied over automatically.
- [ ] **Alice:** do the same on her side, with her own Google account.
- [ ] **Sheet owner** (after linking her own account): back in the Apps Script editor, select **installSync** and click **Run**. The Sheet will now update every 5 minutes.

## 5. Publish the phone app

- [ ] In `web/config.js`, replace `https://VOTRE-PROJET.supabase.co` with the Project URL and `VOTRE-CLE-ANON` with the **anon** key.
- [ ] Decide on hosting: GitHub Pages on a **private** repo needs a paid GitHub plan. Either make the repo public (it contains no secrets), or host the `web/` folder elsewhere (Cloudflare Pages, Netlify).
- [ ] On GitHub: **Settings → Pages → Source: GitHub Actions**.
- [ ] Commit and push everything to `main` (make sure no service_role key is in any file).
- [ ] In the **Actions** tab, wait for "Publier la PWA" to turn green.
- [ ] Open `https://sandragjacinto.github.io/my_library/` and log in with your email and the code you receive.
- [ ] Install it on each phone:
  - **iPhone:** open the address in Safari → **Share → Add to Home Screen**, then open the app from the home screen and **log in there** (Safari and the installed app don't share the login).
  - **Android:** open it in Chrome, log in, then **⋮ → Install app**.
- [ ] Install it on the **Mac**: in Chrome, click the install icon at the right of the address bar (or in Safari: **File → Add to Dock**, then log in inside that window). Pin it to the Dock.
- [ ] Install it on the **Ubuntu PC**: in Chrome or Chromium (not Firefox), click the install icon at the right of the address bar, then log in. Pin it to the dock from the app list.

## 6. Check that everything works

- [ ] Phone app: change a status, then open the Google Script app: the change is there.
- [ ] Google Script app: write a comment, then reload the phone app: the comment is there.
- [ ] Your PAL is the same in both apps, and in the same order as before.
- [ ] Alice can't see your PAL, and can't change your status (your pill is greyed out for her).
- [ ] Scan a book's barcode with the phone (📷 in "Ajouter un livre"): the title and author fill in.
- [ ] Scan a book you already own: the app says it's already in the library.
- [ ] After 5 minutes, the change made in the phone app also appears in the Sheet itself.
- [ ] On a computer: the app opens in its own window; `/` jumps to the search box, `N` opens "Ajouter un livre", and right-clicking the app icon offers "Ajouter un livre".

If something looks out of sync, run **resetSync** in the Apps Script editor to compare the whole Sheet with the database.

## 7. Cleanup (optional, once all is fine)

- [ ] Delete the old `PAL Alice` / `PAL Sandra` columns from the Sheet (no longer used).
- [ ] Delete the backup copy of the Sheet.
- [ ] Delete this file.

---

**From now on:** don't edit the Sheet by hand. Changes made there are not synced and get overwritten. Use one of the two apps.
