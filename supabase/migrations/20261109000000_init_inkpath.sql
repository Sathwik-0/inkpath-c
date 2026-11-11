-- Inkpath initial schema
-- Rules: RLS on every table; clients can read their own rows; privileged writes
-- (anything that affects billing, gating, keys or generation) happen only on the
-- server with the service role.

create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------------------------------------------------------------- profiles
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  avatar_url text,
  purpose text not null default 'both' check (purpose in ('learn','create','both')),
  genres text[] not null default '{}',
  subjects text[] not null default '{}',
  reading_mode text not null default 'both' check (reading_mode in ('vertical','paged','both')),
  storytelling text not null default 'hybrid' check (storytelling in ('ai','custom','hybrid')),
  ai_routing jsonb not null default '{}'::jsonb,
  onboarded boolean not null default false,
  free_chapters_total int not null default 3 check (free_chapters_total >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, avatar_url)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------ provider connections
create table public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('gemini','openai','anthropic')),
  key_ciphertext text not null,
  key_iv text not null,
  key_tag text not null,
  key_mask text not null,
  status text not null default 'connected'
    check (status in ('connected','invalid','quota_exceeded','billing_required')),
  capabilities jsonb not null default '{"text": false, "image": false}'::jsonb,
  models jsonb not null default '{}'::jsonb,
  last_validated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);
create trigger provider_connections_updated before update on public.provider_connections
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ projects
create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  subject text,
  genre text,
  art_direction text,
  synopsis text,
  story_arc jsonb not null default '{}'::jsonb,
  estimated_chapters int not null default 1,
  status text not null default 'draft'
    check (status in ('draft','analyzed','previewed','approved','generating','ready','failed')),
  settings jsonb not null default '{}'::jsonb,
  character_sheet_path text,
  cover_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger projects_updated before update on public.projects
  for each row execute function public.set_updated_at();

create table public.source_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  kind text not null check (kind in ('pdf','docx','txt','text','youtube','topic')),
  title text,
  storage_path text,
  url text,
  status text not null default 'pending' check (status in ('pending','processing','ready','failed')),
  error text,
  created_at timestamptz not null default now()
);

create table public.extracted_content (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  source_id uuid not null references public.source_documents(id) on delete cascade,
  chunk_index int not null,
  content text not null,
  location text,
  created_at timestamptz not null default now()
);

create table public.concepts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  explanation text,
  objective text,
  source_ref text,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create table public.characters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  name text not null,
  role text,
  age_range text,
  appearance text,
  hair text,
  eyes text,
  clothing text,
  personality text,
  relationships text,
  visual_tag text,
  reference_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger characters_updated before update on public.characters
  for each row execute function public.set_updated_at();

-- ------------------------------------------------------------------ chapters
create table public.chapters (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  number int not null check (number > 0),
  title text not null,
  summary text,
  objectives text[] not null default '{}',
  status text not null default 'outline'
    check (status in ('outline','scripted','rendering','ready','failed')),
  funding text check (funding in ('platform','byok')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, number)
);
create trigger chapters_updated before update on public.chapters
  for each row execute function public.set_updated_at();

create table public.panels (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  number int not null check (number > 0),
  scene text not null,
  camera text,
  narration text,
  dialogue jsonb not null default '[]'::jsonb,
  concept_ids uuid[] not null default '{}',
  source_refs jsonb not null default '[]'::jsonb,
  bubble_layout jsonb not null default '{}'::jsonb,
  image_status text not null default 'pending'
    check (image_status in ('pending','generating','ready','failed','needs_review')),
  image_error text,
  image_path text,
  validation_status text not null default 'unchecked'
    check (validation_status in ('unchecked','passed','flagged')),
  retries_used int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (chapter_id, number)
);
create trigger panels_updated before update on public.panels
  for each row execute function public.set_updated_at();

create table public.panel_assets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  panel_id uuid not null references public.panels(id) on delete cascade,
  storage_path text not null,
  version int not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------------- quizzes
create table public.quizzes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null unique references public.chapters(id) on delete cascade,
  questions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table public.quiz_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quiz_id uuid not null references public.quizzes(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  answers jsonb not null default '[]'::jsonb,
  score int not null default 0,
  total int not null default 0,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------- reading progress, bookmarks
create table public.reading_progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  panel_number int not null default 1,
  percent numeric(5,2) not null default 0 check (percent between 0 and 100),
  completed boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key (user_id, chapter_id)
);

create table public.bookmarks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  panel_id uuid not null references public.panels(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  note text,
  created_at timestamptz not null default now(),
  unique (user_id, panel_id)
);

-- ------------------------------------------------------- usage and job tables
create table public.usage_ledger (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in (
    'free_chapter_reserved','free_chapter_released','text_call','image_call','explanation'
  )),
  chapter_id uuid references public.chapters(id) on delete set null,
  units int not null default 1,
  meta jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete cascade,
  type text not null check (type in ('analyze','preview','chapter','panel')),
  status text not null default 'queued'
    check (status in ('queued','running','paused','succeeded','failed')),
  step text,
  progress int not null default 0 check (progress between 0 and 100),
  attempts int not null default 0,
  payload jsonb not null default '{}'::jsonb,
  funding text check (funding in ('platform','byok')),
  provider text,
  error_code text,
  error_message text,
  locked_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger generation_jobs_updated before update on public.generation_jobs
  for each row execute function public.set_updated_at();

-- one active job per (chapter, type) so duplicate clicks cannot double-spend
create unique index generation_jobs_one_active
  on public.generation_jobs (chapter_id, type)
  where status in ('queued','running','paused') and chapter_id is not null;

-- ------------------------------------------------------------------- indexes
create index on public.provider_connections (user_id);
create index on public.projects (user_id);
create index on public.source_documents (user_id);
create index on public.source_documents (project_id);
create index on public.extracted_content (user_id);
create index on public.extracted_content (project_id);
create index on public.extracted_content (source_id);
create index on public.concepts (user_id);
create index on public.concepts (project_id);
create index on public.characters (user_id);
create index on public.characters (project_id);
create index on public.chapters (user_id);
create index on public.chapters (project_id);
create index on public.panels (user_id);
create index on public.panels (chapter_id);
create index on public.panel_assets (user_id);
create index on public.panel_assets (panel_id);
create index on public.quizzes (user_id);
create index on public.quiz_attempts (user_id);
create index on public.quiz_attempts (quiz_id);
create index on public.quiz_attempts (chapter_id);
create index on public.reading_progress (chapter_id);
create index on public.reading_progress (project_id);
create index on public.bookmarks (panel_id);
create index on public.bookmarks (chapter_id);
create index on public.usage_ledger (user_id, kind);
create index on public.usage_ledger (chapter_id);
create index on public.generation_jobs (user_id);
create index on public.generation_jobs (project_id);

-- ----------------------------------------------------------------------- RLS
alter table public.profiles enable row level security;
alter table public.provider_connections enable row level security;
alter table public.projects enable row level security;
alter table public.source_documents enable row level security;
alter table public.extracted_content enable row level security;
alter table public.concepts enable row level security;
alter table public.characters enable row level security;
alter table public.chapters enable row level security;
alter table public.panels enable row level security;
alter table public.panel_assets enable row level security;
alter table public.quizzes enable row level security;
alter table public.quiz_attempts enable row level security;
alter table public.reading_progress enable row level security;
alter table public.bookmarks enable row level security;
alter table public.usage_ledger enable row level security;
alter table public.generation_jobs enable row level security;

-- read-own policy for every table that has a user_id column
do $$
declare t text;
begin
  foreach t in array array[
    'provider_connections','projects','source_documents','extracted_content','concepts',
    'characters','chapters','panels','panel_assets','quizzes','quiz_attempts',
    'reading_progress','bookmarks','usage_ledger','generation_jobs'
  ] loop
    execute format(
      'create policy "%1$s_select_own" on public.%1$I for select to authenticated using (user_id = (select auth.uid()))',
      t
    );
  end loop;
end $$;

create policy "profiles_select_own" on public.profiles
  for select to authenticated using (id = (select auth.uid()));
create policy "profiles_update_own" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- the only direct client writes: bookmarks and reading progress
create policy "bookmarks_insert_own" on public.bookmarks
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.panels p where p.id = panel_id and p.user_id = (select auth.uid()))
  );
create policy "bookmarks_delete_own" on public.bookmarks
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "reading_progress_insert_own" on public.reading_progress
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.chapters c where c.id = chapter_id and c.user_id = (select auth.uid()))
  );
create policy "reading_progress_update_own" on public.reading_progress
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- privileges
revoke all on all tables in schema public from anon;
revoke insert, update, delete, truncate on all tables in schema public from authenticated;

-- encrypted key material is never readable by the client, even for the owner
revoke select on public.provider_connections from authenticated;
grant select (id, user_id, provider, key_mask, status, capabilities, models,
              last_validated_at, created_at, updated_at)
  on public.provider_connections to authenticated;

-- profiles: the client may edit preferences only (never the free-chapter allowance)
grant update (display_name, avatar_url, purpose, genres, subjects, reading_mode,
              storytelling, ai_routing, onboarded)
  on public.profiles to authenticated;

grant insert, delete on public.bookmarks to authenticated;
grant insert, update on public.reading_progress to authenticated;

-- ------------------------------------------------- free-chapter gating (atomic)
-- Locks the user's profile row so two parallel requests cannot both pass.
create or replace function public.reserve_free_chapter(p_user uuid, p_chapter uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_total int;
  v_used int;
  v_net int;
  v_last uuid;
begin
  select free_chapters_total into v_total from public.profiles where id = p_user for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'no_profile');
  end if;

  select coalesce(sum(case when kind = 'free_chapter_reserved' then 1 else -1 end), 0) into v_net
  from public.usage_ledger
  where user_id = p_user and chapter_id = p_chapter
    and kind in ('free_chapter_reserved','free_chapter_released');
  if v_net > 0 then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  select coalesce(sum(case when kind = 'free_chapter_reserved' then 1 else -1 end), 0) into v_used
  from public.usage_ledger
  where user_id = p_user and kind in ('free_chapter_reserved','free_chapter_released');

  if v_used >= v_total then
    return jsonb_build_object('ok', false, 'reason', 'free_limit_reached', 'used', v_used, 'total', v_total);
  end if;

  if v_used >= 1 then
    select l.chapter_id into v_last
    from public.usage_ledger l
    where l.user_id = p_user and l.kind = 'free_chapter_reserved' and l.chapter_id is not null
      and not exists (
        select 1 from public.usage_ledger r
        where r.user_id = p_user and r.chapter_id = l.chapter_id and r.kind = 'free_chapter_released'
      )
    order by l.created_at desc, l.id desc
    limit 1;

    if v_last is not null and not exists (
      select 1 from public.quiz_attempts q where q.user_id = p_user and q.chapter_id = v_last
    ) then
      return jsonb_build_object('ok', false, 'reason', 'quiz_required', 'chapter_id', v_last);
    end if;
  end if;

  insert into public.usage_ledger (user_id, kind, chapter_id)
  values (p_user, 'free_chapter_reserved', p_chapter);

  return jsonb_build_object('ok', true, 'used', v_used + 1, 'total', v_total);
end $$;

create or replace function public.release_free_chapter(p_user uuid, p_chapter uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_net int;
begin
  perform 1 from public.profiles where id = p_user for update;
  select coalesce(sum(case when kind = 'free_chapter_reserved' then 1 else -1 end), 0) into v_net
  from public.usage_ledger
  where user_id = p_user and chapter_id = p_chapter
    and kind in ('free_chapter_reserved','free_chapter_released');
  if v_net > 0 then
    insert into public.usage_ledger (user_id, kind, chapter_id)
    values (p_user, 'free_chapter_released', p_chapter);
  end if;
end $$;

revoke execute on function public.reserve_free_chapter(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.release_free_chapter(uuid, uuid) from public, anon, authenticated;
grant execute on function public.reserve_free_chapter(uuid, uuid) to service_role;
grant execute on function public.release_free_chapter(uuid, uuid) to service_role;

-- what the signed-in user sees about their own allowance
create or replace function public.free_status()
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'total', p.free_chapters_total,
    'used', coalesce(u.used, 0),
    'remaining', greatest(p.free_chapters_total - coalesce(u.used, 0), 0)
  )
  from public.profiles p
  left join lateral (
    select sum(case when l.kind = 'free_chapter_reserved' then 1 else -1 end)::int as used
    from public.usage_ledger l
    where l.user_id = p.id and l.kind in ('free_chapter_reserved','free_chapter_released')
  ) u on true
  where p.id = (select auth.uid());
$$;
revoke execute on function public.free_status() from public, anon;
grant execute on function public.free_status() to authenticated;

-- ------------------------------------------------------------------- storage
insert into storage.buckets (id, name, public, file_size_limit)
values
  ('sources', 'sources', false, 26214400),
  ('panels', 'panels', false, 10485760),
  ('characters', 'characters', false, 10485760)
on conflict (id) do nothing;

create policy "inkpath_storage_read_own" on storage.objects
  for select to authenticated
  using (
    bucket_id in ('sources', 'panels', 'characters')
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
