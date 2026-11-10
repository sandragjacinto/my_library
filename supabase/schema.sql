-- Notre bibliothèque : schéma Supabase
-- À coller dans Supabase → SQL Editor → New query → Run. Peut être relancé sans danger.
--
-- Supabase est la source de vérité. La PWA et l'app Google Script y écrivent toutes les deux ;
-- la Google Sheet en est un miroir mis à jour par l'app Google Script.

/* ---------- Tables ---------- */

-- Lectrices autorisées. Remplace CONFIG.EMAILS. Le nom doit être EXACTEMENT celui de sa colonne dans la Sheet.
create table if not exists public.readers (
  email    text primary key check (email = lower(email)),
  name     text not null unique,
  position int  not null default 0
);

create table if not exists public.books (
  id          text primary key default gen_random_uuid()::text,  -- reprend la colonne « ID » de la Sheet
  titre       text not null default '',
  auteurs     text not null default '',
  type        text not null default '',
  theme       text not null default '',
  langue      text not null default '',
  editeur     text not null default '',
  photo       text not null default '',
  remarque    text not null default '',
  resume      text not null default '',
  emplacement text not null default '',
  isbn        text not null default '',
  added_by    text not null default '',
  removed     boolean not null default false,                    -- « Retiré » : jamais de suppression
  -- ordre d'ajout (tri « ajouts récents ») : numéro de ligne pour l'import, horodatage en ms ensuite
  sort_order  bigint not null default (extract(epoch from clock_timestamp()) * 1000)::bigint,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists books_updated_at on public.books (updated_at);
create index if not exists books_isbn on public.books (isbn) where isbn <> '';

-- Statut et commentaire : une ligne par livre et par lectrice.
create table if not exists public.readings (
  book_id    text not null references public.books (id) on delete cascade,
  reader     text not null references public.readers (name) on update cascade,
  status     text check (status in ('lu', 'pas lu')),           -- null = non renseigné
  comment    text not null default '',
  updated_at timestamptz not null default now(),
  primary key (book_id, reader)
);
create index if not exists readings_updated_at on public.readings (updated_at);

-- Pile à lire : privée, chacune ne voit que la sienne.
create table if not exists public.pal (
  reader   text not null references public.readers (name) on update cascade,
  book_id  text not null references public.books (id) on delete cascade,
  position int  not null,
  primary key (reader, book_id)
);

/* ---------- Fonctions et triggers ---------- */

-- Lectrice correspondant à l'utilisatrice connectée (null si inconnue).
create or replace function public.my_reader() returns text
language sql stable security definer set search_path = public as $$
  select name from public.readers where email = lower(coalesce(auth.jwt() ->> 'email', ''))
$$;

create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists books_touch on public.books;
create trigger books_touch before update on public.books
  for each row execute function public.touch_updated_at();

drop trigger if exists readings_touch on public.readings;
create trigger readings_touch before update on public.readings
  for each row execute function public.touch_updated_at();

-- « Ajouté par » vient du compte connecté, et l'ordre d'ajout ne peut pas être modifié après coup.
create or replace function public.books_guard() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.added_by := coalesce(public.my_reader(), new.added_by);  -- import (clé service) : valeur gardée
  else
    new.added_by   := old.added_by;
    new.sort_order := old.sort_order;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

drop trigger if exists books_guard on public.books;
create trigger books_guard before insert or update on public.books
  for each row execute function public.books_guard();

-- Un livre marqué « lu » sort tout seul de la PAL de cette lectrice (pour les deux apps).
create or replace function public.leave_pal_when_read() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'lu' and (tg_op = 'INSERT' or old.status is distinct from 'lu') then
    delete from public.pal where reader = new.reader and book_id = new.book_id;
  end if;
  return new;
end $$;

drop trigger if exists readings_leave_pal on public.readings;
create trigger readings_leave_pal after insert or update on public.readings
  for each row execute function public.leave_pal_when_read();

-- Synchronisation vers la Sheet : tout ce qui a changé depuis `since` (tout si null).
-- `now` sert de point de départ à la synchro suivante (horloge du serveur, pas de Google).
-- security invoker : les règles RLS s'appliquent, la PAL n'en fait jamais partie.
create or replace function public.changes_since(since timestamptz default null) returns jsonb
language sql stable security invoker set search_path = public as $$
  select jsonb_build_object(
    'now', now(),
    'books', coalesce((select jsonb_agg(to_jsonb(b) order by b.sort_order)
                       from public.books b where since is null or b.updated_at > since), '[]'::jsonb),
    'readings', coalesce((select jsonb_agg(to_jsonb(r))
                          from public.readings r where since is null or r.updated_at > since), '[]'::jsonb)
  )
$$;

/* ---------- Droits (Row Level Security) ---------- */

alter table public.readers  enable row level security;
alter table public.books    enable row level security;
alter table public.readings enable row level security;
alter table public.pal      enable row level security;

revoke all on public.readers, public.books, public.readings, public.pal from anon;
grant select                         on public.readers  to authenticated;
grant select, insert, update         on public.books    to authenticated;
grant select, insert, update, delete on public.readings to authenticated;
grant select, insert, update, delete on public.pal      to authenticated;
grant execute on function public.my_reader(), public.changes_since(timestamptz) to authenticated;

drop policy if exists readers_read on public.readers;
create policy readers_read on public.readers for select to authenticated
  using (public.my_reader() is not null);

-- Infos communes : lisibles et modifiables par les deux (équivalent de SHARED_EDIT: true). Pas de suppression.
drop policy if exists books_read on public.books;
create policy books_read on public.books for select to authenticated
  using (public.my_reader() is not null);
drop policy if exists books_add on public.books;
create policy books_add on public.books for insert to authenticated
  with check (public.my_reader() is not null);
drop policy if exists books_edit on public.books;
create policy books_edit on public.books for update to authenticated
  using (public.my_reader() is not null) with check (public.my_reader() is not null);

-- Statuts et commentaires : chacune lit tout, mais n'écrit que les siens.
drop policy if exists readings_read on public.readings;
create policy readings_read on public.readings for select to authenticated
  using (public.my_reader() is not null);
drop policy if exists readings_add on public.readings;
create policy readings_add on public.readings for insert to authenticated
  with check (reader = public.my_reader());
drop policy if exists readings_edit on public.readings;
create policy readings_edit on public.readings for update to authenticated
  using (reader = public.my_reader()) with check (reader = public.my_reader());
drop policy if exists readings_delete on public.readings;
create policy readings_delete on public.readings for delete to authenticated
  using (reader = public.my_reader());

-- PAL : invisible pour l'autre.
drop policy if exists pal_mine on public.pal;
create policy pal_mine on public.pal for all to authenticated
  using (reader = public.my_reader()) with check (reader = public.my_reader());

/* ---------- Lectrices ---------- */
-- REMPLACE les adresses par vos vraies adresses (en minuscules), mêmes noms que les colonnes de la Sheet.
-- Puis, dans Authentication → Users → « Add user » → « Send invitation » (ou « Create new user »),
-- crée un compte pour chacune de ces adresses : les inscriptions libres sont désactivées.
insert into public.readers (email, name, position) values
  ('mariette.alice@gmail.com',  'Alice',  0),
  ('sandragjacinto@gmail.com', 'Sandra', 1)
on conflict (email) do nothing;
