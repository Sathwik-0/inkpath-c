-- Foundation v2: novel-first serial driven by a learner model.
-- The database is the brain; the model only writes prose from a brief.

-- ------------------------------------------------------------ concept graph
alter table public.concepts
  add column if not exists kind text not null default 'idea'
    check (kind in ('idea','fact','procedure','relationship')),
  add column if not exists world_rule text,          -- how the story world embodies this concept
  add column if not exists misconceptions text[] not null default '{}';

create table public.concept_edges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  from_concept uuid not null references public.concepts(id) on delete cascade, -- prerequisite
  to_concept uuid not null references public.concepts(id) on delete cascade,   -- depends on it
  unique (from_concept, to_concept),
  check (from_concept <> to_concept)
);

-- ------------------------------------------------------------- story memory
create table public.story_bibles (
  project_id uuid primary key references public.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  bible jsonb not null,          -- world, rules, cast, voice, themes, ending
  rolling_summary text not null default '',
  voice text,
  version int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger story_bibles_updated before update on public.story_bibles
  for each row execute function public.set_updated_at();

-- Chekhov ledger: every planted setup must be paid off.
create table public.story_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  label text not null,
  concept_id uuid references public.concepts(id) on delete set null,
  planted_in int,                 -- chapter number
  due_by int,                     -- latest chapter for payoff
  paid_off_in int,
  status text not null default 'open' check (status in ('open','paid_off','dropped')),
  created_at timestamptz not null default now()
);

-- Craft cards: abstract techniques, never copied content.
create table public.craft_cards (
  slug text primary key,
  name text not null,
  principle text not null,
  how_to text not null,
  avoid text
);

-- ----------------------------------------------------------- chapter prose
alter table public.chapters
  add column if not exists format text not null default 'novel' check (format in ('novel','manga')),
  add column if not exists prose jsonb,            -- {scenes:[{heading,text,concepts:[...]}]}
  add column if not exists hook text,
  add column if not exists brief jsonb,            -- planner output used to write this chapter
  add column if not exists verified boolean not null default false,
  add column if not exists verify_notes text;

-- ----------------------------------------------------------- learner model
create table public.learner_concepts (
  user_id uuid not null references auth.users(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  level int not null default 0 check (level between 0 and 10),  -- System window level
  stability_days numeric not null default 0,                    -- spaced-repetition interval
  ease numeric not null default 2.3,
  lapses int not null default 0,
  reps int not null default 0,
  last_seen_at timestamptz,
  next_review_at timestamptz,
  introduced_in int,
  updated_at timestamptz not null default now(),
  primary key (user_id, concept_id)
);

-- Append-only log of every recall answer.
create table public.review_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id uuid not null references public.projects(id) on delete cascade,
  concept_id uuid not null references public.concepts(id) on delete cascade,
  chapter_id uuid references public.chapters(id) on delete set null,
  correct boolean not null,
  kind text not null default 'chapter_end' check (kind in ('chapter_end','next_day','review')),
  created_at timestamptz not null default now()
);

alter table public.generation_jobs drop constraint if exists generation_jobs_type_check;
alter table public.generation_jobs add constraint generation_jobs_type_check
  check (type in ('analyze','preview','bible','chapter','panel'));

-- ----------------------------------------------------------------- indexes
create index on public.concept_edges (project_id);
create index on public.concept_edges (user_id);
create index on public.concept_edges (from_concept);
create index on public.concept_edges (to_concept);
create index on public.story_bibles (user_id);
create index on public.story_threads (project_id);
create index on public.story_threads (user_id);
create index on public.story_threads (concept_id);
create index on public.learner_concepts (project_id);
create index on public.learner_concepts (concept_id);
create index on public.learner_concepts (user_id, next_review_at);
create index on public.review_events (user_id);
create index on public.review_events (project_id);
create index on public.review_events (concept_id);
create index on public.review_events (chapter_id);

-- ------------------------------------------------------------ RLS (read own)
alter table public.concept_edges enable row level security;
alter table public.story_bibles enable row level security;
alter table public.story_threads enable row level security;
alter table public.craft_cards enable row level security;
alter table public.learner_concepts enable row level security;
alter table public.review_events enable row level security;

do $$
declare t text;
begin
  foreach t in array array['concept_edges','story_bibles','story_threads','learner_concepts','review_events'] loop
    execute format(
      'create policy "%1$s_select_own" on public.%1$I for select to authenticated using (user_id = (select auth.uid()))', t);
  end loop;
end $$;

create policy "craft_cards_read" on public.craft_cards for select to authenticated using (true);

-- Writes to the learner model and story memory happen only on the server (service role).
revoke insert, update, delete on public.concept_edges, public.story_bibles, public.story_threads,
  public.learner_concepts, public.review_events, public.craft_cards from anon, authenticated;

-- ---------------------------------------------------------------- craft cards
insert into public.craft_cards (slug, name, principle, how_to, avoid) values
('rule-trap','Rule trap',
 'A world rule blocks the hero, and the rule is the concept.',
 'Make the character fail or stall until they work out the rule. Let the reader try to solve it before the character does.',
 'A mentor reciting the rule.'),
('plant-payoff','Plant and pay off',
 'A concept appears early as a puzzle and returns later as the solution.',
 'Plant it casually in one scene; log the thread; resolve it two or more chapters later using the same concept in a harder situation.',
 'Paying off in the same scene it was planted.'),
('information-gap','Information gap',
 'Open a question the reader cannot rest without answering.',
 'End the chapter on a specific unanswered question whose answer needs the next concept.',
 'Vague cliffhangers with no link to a concept.'),
('misconception-villain','Misconception villain',
 'The antagonist voices the wrong idea learners tend to hold.',
 'Let the wrong idea look reasonable, then have the hero''s concrete evidence break it.',
 'Strawman wrong ideas nobody would believe.'),
('stakes-escalation','Escalation by constraint',
 'Each scene applies the same concept under a tighter constraint.',
 'Repeat the concept with higher stakes or fewer resources so the reader reapplies it.',
 'Repeating the same scene with new names.'),
('show-dont-tell','Show the idea through consequence',
 'Teach through what happens, not what is said.',
 'Let an outcome demonstrate the idea, then name it briefly in the character''s own words.',
 'Paragraphs of explanation in dialogue.'),
('callback','Callback review',
 'Bring back an earlier concept inside a new problem, forcing recall.',
 'Pick a concept due for review and make it the missing piece of the current scene.',
 'Reminding the reader what it was; make them retrieve it.');
