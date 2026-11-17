-- Fleet & Rider CRM – Supabase schema. Run once in the SQL editor (Dashboard → SQL).

-- 1. People and roles ---------------------------------------------------------
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  role text not null default 'viewer' check (role in ('viewer','contributor','editor','owner')),
  created_at timestamptz not null default now()
);

-- 1 = viewer (rider), 2 = contributor (staff), 3 = editor, 4 = owner
create or replace function public.app_level() returns int
language sql stable security definer set search_path = public as $$
  select coalesce((select case role when 'viewer' then 1 when 'contributor' then 2 when 'editor' then 3 when 'owner' then 4 end
                   from public.profiles where id = auth.uid()), 0)
$$;

-- every new sign-up gets a profile; the very first account becomes the owner
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, name, role)
  values (new.id, new.email,
          coalesce(nullif(new.raw_user_meta_data->>'name',''), split_part(new.email,'@',1)),
          case when exists (select 1 from public.profiles where role = 'owner') then 'viewer' else 'owner' end);
  return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
drop policy if exists "read own profile" on public.profiles;
drop policy if exists "staff read profiles" on public.profiles;
drop policy if exists "owner updates profiles" on public.profiles;
create policy "read own profile" on public.profiles for select using (id = auth.uid());
create policy "staff read profiles" on public.profiles for select using (public.app_level() >= 2);
create policy "owner updates profiles" on public.profiles for update using (public.app_level() >= 4) with check (public.app_level() >= 4);

-- 2. Document store used by the dashboard -----------------------------------
create table if not exists public.kv (
  col text not null,
  id text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (col, id)
);
create index if not exists kv_col_created on public.kv (col, created_at);

create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists kv_touch on public.kv;
create trigger kv_touch before update on public.kv for each row execute function public.touch_updated_at();

-- minimum role level per collection
create or replace function public.kv_read_level(c text) returns int language sql immutable as $$
  select case c when 'masters' then 2 when 'events' then 2 when 'docs' then 2 when 'service' then 2 when 'riderinfo' then 2
                when 'adj' then 2 when 'onb' then 2 when 'links' then 3 when 'wallets' then 3 else 99 end $$;
create or replace function public.kv_insert_level(c text) returns int language sql immutable as $$
  select case c when 'events' then 2 when 'docs' then 2 when 'service' then 2 when 'onb' then 2 when 'riderinfo' then 2
                when 'masters' then 3 when 'adj' then 3 when 'links' then 3 when 'wallets' then 3 else 99 end $$;
create or replace function public.kv_update_level(c text) returns int language sql immutable as $$
  select case c when 'onb' then 2 when 'riderinfo' then 2 else 3 end $$;

alter table public.kv enable row level security;
drop policy if exists kv_select on public.kv;
drop policy if exists kv_insert on public.kv;
drop policy if exists kv_update on public.kv;
drop policy if exists kv_delete on public.kv;
-- riders (viewers) can read only their own wallet document: wallets/<their user id>
create policy kv_select on public.kv for select using (
  public.app_level() >= public.kv_read_level(col) or (col = 'wallets' and id = auth.uid()::text));
create policy kv_insert on public.kv for insert with check (public.app_level() >= public.kv_insert_level(col));
create policy kv_update on public.kv for update using (public.app_level() >= public.kv_update_level(col))
                                                  with check (public.app_level() >= public.kv_update_level(col));
create policy kv_delete on public.kv for delete using (public.app_level() >= 3);

-- live updates
do $$ begin
  alter publication supabase_realtime add table public.kv;
exception when duplicate_object then null; end $$;

-- 3. Private file storage for rider documents -------------------------------
insert into storage.buckets (id, name, public) values ('rider-docs', 'rider-docs', false) on conflict (id) do nothing;
drop policy if exists "staff read rider docs" on storage.objects;
drop policy if exists "staff upload rider docs" on storage.objects;
drop policy if exists "editors delete rider docs" on storage.objects;
create policy "staff read rider docs" on storage.objects for select using (bucket_id = 'rider-docs' and public.app_level() >= 2);
create policy "staff upload rider docs" on storage.objects for insert with check (bucket_id = 'rider-docs' and public.app_level() >= 2);
create policy "editors delete rider docs" on storage.objects for delete using (bucket_id = 'rider-docs' and public.app_level() >= 3);

-- 4. Promote staff (run per person, after they have signed up) ---------------
-- update public.profiles set role = 'contributor' where email = 'staff@example.com';
-- update public.profiles set role = 'editor'      where email = 'manager@example.com';

-- 5. Hardening ----------------------------------------------------------------
alter function public.touch_updated_at() set search_path = public;
alter function public.kv_read_level(text) set search_path = public;
alter function public.kv_insert_level(text) set search_path = public;
alter function public.kv_update_level(text) set search_path = public;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.app_level() from public, anon;
grant execute on function public.app_level() to authenticated;
