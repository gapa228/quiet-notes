-- Выполните этот файл один раз в Supabase: SQL Editor → New query → Run.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  due_date date,
  repeat_rule text not null default 'none',
  completed_at timestamptz,
  pinned boolean not null default false,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notes add column if not exists due_date date;
alter table public.notes add column if not exists repeat_rule text not null default 'none';
alter table public.notes add column if not exists completed_at timestamptz;

create index if not exists notes_user_updated_idx on public.notes (user_id, updated_at desc);
alter table public.notes enable row level security;

drop policy if exists "Users read own notes" on public.notes;
create policy "Users read own notes" on public.notes for select using (auth.uid() = user_id);
drop policy if exists "Users insert own notes" on public.notes;
create policy "Users insert own notes" on public.notes for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own notes" on public.notes;
create policy "Users update own notes" on public.notes for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own notes" on public.notes;
create policy "Users delete own notes" on public.notes for delete using (auth.uid() = user_id);
