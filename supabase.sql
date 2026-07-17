-- Выполните этот файл один раз в Supabase: SQL Editor → New query → Run.
create table if not exists public.notes (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null default '',
  content text not null default '',
  item_type text not null default 'task',
  amount numeric(12,2),
  due_date date,
  repeat_rule text not null default 'none',
  repeat_interval integer not null default 1,
  remind_days_before integer not null default 0,
  completed_at timestamptz,
  pinned boolean not null default false,
  deleted boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table public.notes add column if not exists due_date date;
alter table public.notes add column if not exists item_type text not null default 'task';
alter table public.notes add column if not exists amount numeric(12,2);
alter table public.notes add column if not exists repeat_rule text not null default 'none';
alter table public.notes add column if not exists repeat_interval integer not null default 1;
alter table public.notes add column if not exists remind_days_before integer not null default 0;
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

create table if not exists public.expenses (
  id uuid primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id uuid references public.notes(id) on delete set null,
  title text not null default '',
  category text not null default 'Продукты',
  amount numeric(12,2) not null default 0,
  occurrence_date date not null,
  spent_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted boolean not null default false
);

create index if not exists expenses_user_spent_idx on public.expenses (user_id, spent_at desc);
alter table public.expenses enable row level security;
drop policy if exists "Users read own expenses" on public.expenses;
create policy "Users read own expenses" on public.expenses for select using (auth.uid() = user_id);
drop policy if exists "Users insert own expenses" on public.expenses;
create policy "Users insert own expenses" on public.expenses for insert with check (auth.uid() = user_id);
drop policy if exists "Users update own expenses" on public.expenses;
create policy "Users update own expenses" on public.expenses for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "Users delete own expenses" on public.expenses;
create policy "Users delete own expenses" on public.expenses for delete using (auth.uid() = user_id);
