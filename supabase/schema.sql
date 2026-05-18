-- After this schema: Supabase Dashboard → Storage → New bucket → name must match
-- SUPABASE_STORAGE_BUCKET (e.g. contact-uploads). Keep the bucket private; the app uses the service role.

create extension if not exists "pgcrypto";

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.contact_files (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete set null,
  storage_path text not null,
  original_filename text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.contacts (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete cascade,
  contact_file_id uuid not null references public.contact_files (id) on delete cascade,
  email text not null,
  name text not null default '',
  company text not null default '',
  created_at timestamptz not null default now(),
  unique (contact_file_id, email)
);

create index if not exists contacts_category_id_idx on public.contacts (category_id);

create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  category_id uuid references public.categories (id) on delete set null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns (id) on delete cascade,
  contact_id uuid references public.contacts (id) on delete set null,
  recipient_email text not null,
  sg_message_id text,
  status text not null default 'queued',
  delivered_at timestamptz,
  opened_at timestamptz,
  last_error text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (campaign_id, recipient_email)
);

create index if not exists email_events_campaign_id_idx on public.email_events (campaign_id);
create index if not exists email_events_sg_message_id_idx on public.email_events (sg_message_id);

create table if not exists public.sendgrid_events (
  id uuid primary key default gen_random_uuid(),
  payload jsonb not null,
  created_at timestamptz not null default now()
);
