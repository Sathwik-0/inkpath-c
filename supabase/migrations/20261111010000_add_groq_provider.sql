-- Allow 'groq' in provider_connections
alter table public.provider_connections drop constraint if exists provider_connections_provider_check;
alter table public.provider_connections add constraint provider_connections_provider_check
  check (provider in ('gemini', 'openai', 'anthropic', 'groq'));
