-- Life OS app database. One table mirrors the old artifact database:
-- every document is (col, id) -> data, so /life keeps the same shapes.
create table if not exists public.docs (
  col text not null,
  id text not null,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (col, id)
);

-- Who may read and write: only accounts listed here (Anton). setup.py --claim adds him.
create table if not exists public.owners (
  uid uuid primary key
);

alter table public.docs enable row level security;
alter table public.owners enable row level security;

drop policy if exists docs_owner_all on public.docs;
create policy docs_owner_all on public.docs
  for all to authenticated
  using (auth.uid() in (select uid from public.owners))
  with check (auth.uid() in (select uid from public.owners));

drop policy if exists owners_self_read on public.owners;
create policy owners_self_read on public.owners
  for select to authenticated using (uid = auth.uid());

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists docs_touch on public.docs;
create trigger docs_touch before update on public.docs for each row execute function public.touch_updated_at();

-- Live updates to the phone app.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and tablename = 'docs') then
    alter publication supabase_realtime add table public.docs;
  end if;
end $$;
