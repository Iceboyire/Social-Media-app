create table public.circles (
    id uuid primary key default gen_random_uuid(),
    owner_id uuid not null references public.profiles (id) on delete cascade,
    name text not null check (length(btrim(name)) between 1 and 40),
    color text not null default '#5479d1' check (color ~ '^#[0-9A-Fa-f]{6}$'),
    created_at timestamptz not null default now()
);

create table public.circle_members (
    circle_id uuid not null references public.circles (id) on delete cascade,
    friend_id uuid not null references public.profiles (id) on delete cascade,
    primary key (circle_id, friend_id)
);

alter table public.availability
    add column visible_to_circle_id uuid references public.circles (id) on delete set null;

create or replace function public.can_view_availability_circle(p_owner_id uuid, p_circle_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select auth.uid() is not null
       and exists (
           select 1
             from public.circle_members cm
             join public.circles c on c.id = cm.circle_id
            where cm.circle_id = p_circle_id
              and cm.friend_id = auth.uid()
              and c.owner_id = p_owner_id
       );
$$;

drop policy if exists availability_select_visible_friends on public.availability;
create policy availability_select_visible_friends
on public.availability for select to authenticated
using (
    user_id <> auth.uid()
    and expires_at > now()
    and not is_hidden
    and public.are_friends(auth.uid(), user_id)
    and not public.is_blocked_between(auth.uid(), user_id)
    and exists (select 1 from public.profiles own where own.id = auth.uid() and own.status = 'active')
    and exists (select 1 from public.profiles person where person.id = availability.user_id and person.status = 'active')
    and (
        visible_to_circle_id is null
        or public.can_view_availability_circle(availability.user_id, availability.visible_to_circle_id)
    )
);

alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
revoke all on table public.circles, public.circle_members from public, anon, authenticated;
grant select on table public.circles, public.circle_members to authenticated;

create policy circles_select_owner
on public.circles for select to authenticated
using (owner_id = auth.uid());

create policy circle_members_select_owner
on public.circle_members for select to authenticated
using (exists (
    select 1 from public.circles c
     where c.id = circle_members.circle_id and c.owner_id = auth.uid()
));

create or replace function public.create_circle(p_name text, p_color text default '#5479d1')
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    created_circle uuid;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles p where p.id = caller and p.status = 'active') then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    if p_name is null or length(btrim(p_name)) not between 1 and 40
       or p_color is null or p_color !~ '^#[0-9A-Fa-f]{6}$' then
        raise exception 'Circle name or color is invalid' using errcode = '22023';
    end if;
    insert into public.circles (owner_id, name, color)
    values (caller, btrim(p_name), p_color)
    returning id into created_circle;
    return created_circle;
end;
$$;

create or replace function public.rename_circle(p_circle_id uuid, p_name text, p_color text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    if p_name is null or length(btrim(p_name)) not between 1 and 40
       or (p_color is not null and p_color !~ '^#[0-9A-Fa-f]{6}$') then
        raise exception 'Circle name or color is invalid' using errcode = '22023';
    end if;
    update public.circles
       set name = btrim(p_name), color = coalesce(p_color, color)
     where id = p_circle_id and owner_id = auth.uid();
    if not found then
        raise exception 'Circle not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.delete_circle(p_circle_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    delete from public.circles where id = p_circle_id and owner_id = auth.uid();
    if not found then
        raise exception 'Circle not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.add_to_circle(p_circle_id uuid, p_friend_id uuid)
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
    if not exists (select 1 from public.profiles p where p.id = caller and p.status = 'active') then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    if p_friend_id is null or p_friend_id = caller
       or not public.are_friends(caller, p_friend_id)
       or public.is_blocked_between(caller, p_friend_id) then
        raise exception 'Only accepted, unblocked friends can be added to a circle' using errcode = '42501';
    end if;
    if not exists (select 1 from public.circles where id = p_circle_id and owner_id = caller) then
        raise exception 'Circle not found' using errcode = 'P0002';
    end if;
    insert into public.circle_members (circle_id, friend_id)
    values (p_circle_id, p_friend_id)
    on conflict (circle_id, friend_id) do nothing;
end;
$$;

create or replace function public.remove_from_circle(p_circle_id uuid, p_friend_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles p where p.id = auth.uid() and p.status = 'active') then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.circles where id = p_circle_id and owner_id = auth.uid()) then
        raise exception 'Circle not found' using errcode = 'P0002';
    end if;
    delete from public.circle_members where circle_id = p_circle_id and friend_id = p_friend_id;
end;
$$;

create or replace function public.create_circle_plan(
    p_circle_id uuid,
    p_title text,
    p_description text,
    p_starts_at timestamptz,
    p_ends_at timestamptz default null,
    p_location_text text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    new_conversation uuid;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.circles c where c.id = p_circle_id and c.owner_id = caller) then
        raise exception 'Circle not found' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.circle_members cm where cm.circle_id = p_circle_id) then
        raise exception 'Add at least one friend to this circle before inviting them to a plan' using errcode = '22023';
    end if;
    if exists (
        select 1
          from public.circle_members cm
          join public.profiles p on p.id = cm.friend_id
         where cm.circle_id = p_circle_id
           and (p.status <> 'active'
                or not public.are_friends(caller, cm.friend_id)
                or public.is_blocked_between(caller, cm.friend_id))
    ) then
        raise exception 'The circle contains a friend who is no longer eligible for a group chat' using errcode = '42501';
    end if;

    insert into public.conversations (type, name, photo_url, created_by)
    values ('group', left(btrim(p_title), 80), null, caller)
    returning id into new_conversation;

    insert into public.conversation_members (conversation_id, user_id, role)
    values (new_conversation, caller, 'admin');
    insert into public.conversation_members (conversation_id, user_id)
    select new_conversation, cm.friend_id
      from public.circle_members cm
     where cm.circle_id = p_circle_id;

    perform public.create_plan(
        new_conversation, p_title, p_description, p_starts_at, p_ends_at, p_location_text
    );
    return new_conversation;
end;
$$;

drop function public.set_availability(text, text, integer, boolean);
create or replace function public.set_availability(
    p_state text,
    p_note text default '',
    p_duration_minutes integer default 60,
    p_hidden boolean default false,
    p_visible_to_circle_id uuid default null
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
    if not exists (select 1 from public.profiles p where p.id = caller and p.status = 'active') then
        raise exception 'An active account is required' using errcode = '42501';
    end if;
    if p_state is null or p_state not in ('free_now', 'free_tonight', 'busy', 'studying', 'out')
       or (p_note is not null and length(p_note) > 60)
       or p_duration_minutes is null or p_duration_minutes < 1 or p_duration_minutes > 1440 then
        raise exception 'Availability details are invalid' using errcode = '22023';
    end if;
    if p_visible_to_circle_id is not null and not exists (
        select 1 from public.circles c where c.id = p_visible_to_circle_id and c.owner_id = caller
    ) then
        raise exception 'The selected visibility circle is not yours' using errcode = '42501';
    end if;

    insert into public.availability (
        user_id, state, note, expires_at, is_hidden, visible_to_circle_id, updated_at
    ) values (
        caller, p_state, coalesce(p_note, ''), now() + make_interval(mins => p_duration_minutes),
        coalesce(p_hidden, false), p_visible_to_circle_id, now()
    )
    on conflict (user_id) do update
       set state = excluded.state,
           note = excluded.note,
           expires_at = excluded.expires_at,
           is_hidden = excluded.is_hidden,
           visible_to_circle_id = excluded.visible_to_circle_id,
           updated_at = excluded.updated_at;
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
       and p.status = 'active'
       and a.expires_at > now()
       and not a.is_hidden
       and public.are_friends(auth.uid(), a.user_id)
       and not public.is_blocked_between(auth.uid(), a.user_id)
       and (
           a.visible_to_circle_id is null
           or exists (
               select 1 from public.circle_members cm
                where cm.circle_id = a.visible_to_circle_id
                  and cm.friend_id = auth.uid()
           )
       )
     order by
       case when a.state in ('free_now', 'free_tonight') then 0 else 1 end,
       a.updated_at desc;
$$;

create or replace function public.cleanup_circle_friendship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    first_user uuid;
    second_user uuid;
begin
    if tg_table_name = 'friendships' then
        first_user := old.requester_id;
        second_user := old.addressee_id;
    else
        first_user := new.blocker_id;
        second_user := new.blocked_id;
    end if;
    delete from public.circle_members cm
     using public.circles c
     where c.id = cm.circle_id
       and ((c.owner_id = first_user and cm.friend_id = second_user)
         or (c.owner_id = second_user and cm.friend_id = first_user));
    if tg_op = 'DELETE' then
        return old;
    end if;
    return new;
end;
$$;

create trigger friendships_cleanup_circle_members
after delete on public.friendships
for each row execute function public.cleanup_circle_friendship();

create trigger blocks_cleanup_circle_members
after insert on public.blocks
for each row execute function public.cleanup_circle_friendship();

create or replace function public.hide_availability_when_circle_deleted()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    update public.availability
       set is_hidden = true, visible_to_circle_id = null, updated_at = now()
     where visible_to_circle_id = old.id;
    return old;
end;
$$;

create trigger circles_hide_private_availability
before delete on public.circles
for each row execute function public.hide_availability_when_circle_deleted();

revoke all on function public.create_circle(text, text) from public;
revoke all on function public.rename_circle(uuid, text, text) from public;
revoke all on function public.delete_circle(uuid) from public;
revoke all on function public.add_to_circle(uuid, uuid) from public;
revoke all on function public.remove_from_circle(uuid, uuid) from public;
revoke all on function public.create_circle_plan(uuid, text, text, timestamptz, timestamptz, text) from public;
revoke all on function public.set_availability(text, text, integer, boolean, uuid) from public;
revoke all on function public.get_friends_availability() from public;
revoke all on function public.can_view_availability_circle(uuid, uuid) from public;
grant execute on function public.create_circle(text, text) to authenticated;
grant execute on function public.rename_circle(uuid, text, text) to authenticated;
grant execute on function public.delete_circle(uuid) to authenticated;
grant execute on function public.add_to_circle(uuid, uuid) to authenticated;
grant execute on function public.remove_from_circle(uuid, uuid) to authenticated;
grant execute on function public.create_circle_plan(uuid, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.set_availability(text, text, integer, boolean, uuid) to authenticated;
grant execute on function public.get_friends_availability() to authenticated;
grant execute on function public.can_view_availability_circle(uuid, uuid) to authenticated;

do $$
begin
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'circles') then
        alter publication supabase_realtime add table public.circles;
    end if;
    if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'circle_members') then
        alter publication supabase_realtime add table public.circle_members;
    end if;
end;
$$;
