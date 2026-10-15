create table public.availability (
    user_id uuid primary key references public.profiles (id) on delete cascade,
    state text not null check (state in ('free_now', 'free_tonight', 'busy', 'studying', 'out')),
    note text not null default '' check (length(note) <= 60),
    expires_at timestamptz not null,
    is_hidden boolean not null default false,
    updated_at timestamptz not null default now()
);

create index availability_expires_at_idx on public.availability (expires_at);
alter table public.availability enable row level security;
revoke all on table public.availability from public, anon, authenticated;
grant select on table public.availability to authenticated;

create policy availability_select_own
on public.availability for select to authenticated
using (user_id = auth.uid());

create policy availability_select_visible_friends
on public.availability for select to authenticated
using (
    user_id <> auth.uid()
    and expires_at > now()
    and not is_hidden
    and public.are_friends(auth.uid(), user_id)
    and not public.is_blocked_between(auth.uid(), user_id)
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active')
    and exists (select 1 from public.profiles p where p.id = availability.user_id and p.status = 'active')
);

create or replace function public.set_availability(
    p_state text,
    p_note text default '',
    p_duration_minutes integer default 60,
    p_hidden boolean default false
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (
        select 1 from public.profiles p where p.id = caller and p.status = 'active'
    ) then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    if p_state is null or p_state not in ('free_now', 'free_tonight', 'busy', 'studying', 'out') then
        raise exception 'Choose a valid availability status' using errcode = '22023';
    end if;
    if p_note is not null and length(p_note) > 60 then
        raise exception 'Status notes cannot exceed 60 characters' using errcode = '22023';
    end if;
    if p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
        raise exception 'Status duration must be between 1 and 1440 minutes' using errcode = '22023';
    end if;

    insert into public.availability (user_id, state, note, expires_at, is_hidden, updated_at)
    values (
        caller,
        p_state,
        coalesce(p_note, ''),
        now() + make_interval(mins => p_duration_minutes),
        coalesce(p_hidden, false),
        now()
    )
    on conflict (user_id) do update
       set state = excluded.state,
           note = excluded.note,
           expires_at = excluded.expires_at,
           is_hidden = excluded.is_hidden,
           updated_at = excluded.updated_at;
end;
$$;

create or replace function public.clear_availability()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    delete from public.availability where user_id = auth.uid();
end;
$$;

create or replace function public.set_availability_hidden(p_hidden boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_hidden is null then
        raise exception 'A visibility choice is required' using errcode = '22023';
    end if;
    update public.availability
       set is_hidden = p_hidden,
           updated_at = now()
     where user_id = auth.uid()
       and expires_at > now();
end;
$$;

create or replace function public.get_friends_availability()
returns table (
    user_id uuid,
    name text,
    username text,
    photo_url text,
    state text,
    note text,
    expires_at timestamptz,
    updated_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
    select p.id, p.name, p.username, p.photo_url, a.state, a.note, a.expires_at, a.updated_at
      from public.availability a
      join public.profiles p on p.id = a.user_id
     where auth.uid() is not null
       and a.user_id <> auth.uid()
       and exists (select 1 from public.profiles own where own.id = auth.uid() and own.status = 'active')
       and p.status = 'active'
       and a.expires_at > now()
       and not a.is_hidden
       and public.are_friends(auth.uid(), a.user_id)
       and not public.is_blocked_between(auth.uid(), a.user_id)
     order by
       case when a.state in ('free_now', 'free_tonight') then 0 else 1 end,
       a.updated_at desc;
$$;

revoke all on function public.set_availability(text, text, integer, boolean) from public;
revoke all on function public.clear_availability() from public;
revoke all on function public.set_availability_hidden(boolean) from public;
revoke all on function public.get_friends_availability() from public;
grant execute on function public.set_availability(text, text, integer, boolean) to authenticated;
grant execute on function public.clear_availability() to authenticated;
grant execute on function public.set_availability_hidden(boolean) to authenticated;
grant execute on function public.get_friends_availability() to authenticated;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'availability'
    ) then
        alter publication supabase_realtime add table public.availability;
    end if;
end;
$$;
