-- One active analyze/bible job per project so duplicate clicks cannot double-spend.
create unique index if not exists generation_jobs_one_active_project
  on public.generation_jobs (project_id, type)
  where status in ('queued','running','paused') and chapter_id is null;
