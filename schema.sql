-- IG Tracker – Supabase schema
-- Spusť v SQL Editoru: supabase.com/dashboard/project/tolfunyrkqvjoscepkzw/sql/new

create table if not exists logs (
  id uuid default gen_random_uuid() primary key,
  date date unique not null,
  followers integer not null,
  note text default '',
  created_at timestamptz default now()
);

create table if not exists reels (
  id uuid default gen_random_uuid() primary key,
  url text unique not null,
  views integer not null default 0,
  likes integer not null default 0,
  description text default '',
  posted_at timestamptz,
  created_at timestamptz default now()
);

create table if not exists plan (
  id uuid default gen_random_uuid() primary key,
  date date unique not null,
  note text not null,
  created_at timestamptz default now()
);

-- RLS (Row Level Security) – povol vše pro anon klíč (osobní nástroj)
alter table logs  enable row level security;
alter table reels enable row level security;
alter table plan  enable row level security;

create policy "public all" on logs  for all using (true) with check (true);
create policy "public all" on reels for all using (true) with check (true);
create policy "public all" on plan  for all using (true) with check (true);
