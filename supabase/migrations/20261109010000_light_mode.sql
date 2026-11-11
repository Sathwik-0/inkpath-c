-- Light mode: panels can be rendered as designed text scenes when no image is made.
alter table public.panels drop constraint if exists panels_image_status_check;
alter table public.panels add constraint panels_image_status_check
  check (image_status in ('pending','generating','ready','failed','needs_review','skipped'));

alter table public.panels add column if not exists scene_style jsonb not null default '{}'::jsonb;

alter table public.projects add column if not exists render_mode text not null default 'light'
  check (render_mode in ('illustrated','light'));
