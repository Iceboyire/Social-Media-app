create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.profiles p
        where p.id = auth.uid()
          and p.role = 'admin'
    );
$$;

create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select a is not null
       and b is not null
       and exists (
           select 1
           from public.blocks bl
           where (bl.blocker_id = a and bl.blocked_id = b)
              or (bl.blocker_id = b and bl.blocked_id = a)
       );
$$;

create or replace function public.are_friends(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select a is not null
       and b is not null
       and a <> b
       and exists (
           select 1
           from public.friendships f
           where f.status = 'accepted'
             and least(f.requester_id, f.addressee_id) = least(a, b)
             and greatest(f.requester_id, f.addressee_id) = greatest(a, b)
       )
       and not public.is_blocked_between(a, b);
$$;

create or replace function public.is_conversation_member(p_conversation uuid, p_active_only boolean default false)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select exists (
        select 1
        from public.conversation_members cm
        where cm.conversation_id = p_conversation
          and cm.user_id = auth.uid()
          and (not p_active_only or cm.left_at is null)
    );
$$;

create or replace function public.send_friend_request(target uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    relationship public.friendships%rowtype;
    relationship_id uuid;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if target is null or target = caller then
        raise exception 'A different target user is required' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(
        hashtextextended(
            least(caller::text, target::text) || ':' || greatest(caller::text, target::text),
            0
        )
    );
    if not exists (select 1 from public.profiles where id = caller and status = 'active') then
        raise exception 'An active profile is required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = target and status = 'active') then
        raise exception 'Target user is unavailable' using errcode = '22023';
    end if;
    if public.is_blocked_between(caller, target) then
        raise exception 'Friend requests are unavailable for this user' using errcode = '42501';
    end if;

    insert into public.friendships (requester_id, addressee_id)
    values (caller, target)
    on conflict ( (least(requester_id, addressee_id)), (greatest(requester_id, addressee_id)) )
    do nothing
    returning id into relationship_id;

    if relationship_id is not null then
        return relationship_id;
    end if;

    select *
      into relationship
      from public.friendships f
     where least(f.requester_id, f.addressee_id) = least(caller, target)
       and greatest(f.requester_id, f.addressee_id) = greatest(caller, target)
     for update;

    if relationship.status = 'declined' then
        update public.friendships
           set requester_id = caller,
               addressee_id = target,
               status = 'pending',
               created_at = now(),
               updated_at = now()
         where id = relationship.id
         returning id into relationship_id;
        return relationship_id;
    end if;

    raise exception 'A friendship or pending request already exists' using errcode = '23505';
end;
$$;

create or replace function public.cancel_friend_request(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    delete from public.friendships
     where requester_id = auth.uid()
       and addressee_id = target
       and status = 'pending';
    if not found then
        raise exception 'Pending request not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.respond_friend_request(requester uuid, accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if accept is null then
        raise exception 'An accept value is required' using errcode = '22023';
    end if;
    update public.friendships
       set status = case when accept then 'accepted' else 'declined' end,
           updated_at = now()
     where requester_id = requester
       and addressee_id = auth.uid()
       and status = 'pending';
    if not found then
        raise exception 'Pending request not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.unfriend(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    delete from public.friendships
     where status = 'accepted'
       and least(requester_id, addressee_id) = least(auth.uid(), target)
       and greatest(requester_id, addressee_id) = greatest(auth.uid(), target);
    if not found then
        raise exception 'Accepted friendship not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.block_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if target is null or target = auth.uid() then
        raise exception 'A different target user is required' using errcode = '22023';
    end if;
    if not exists (select 1 from public.profiles where id = target) then
        raise exception 'Target user not found' using errcode = 'P0002';
    end if;
    perform pg_advisory_xact_lock(
        hashtextextended(
            least(auth.uid()::text, target::text) || ':' || greatest(auth.uid()::text, target::text),
            0
        )
    );
    insert into public.blocks (blocker_id, blocked_id)
    values (auth.uid(), target)
    on conflict (blocker_id, blocked_id) do nothing;
    delete from public.friendships
     where least(requester_id, addressee_id) = least(auth.uid(), target)
       and greatest(requester_id, addressee_id) = greatest(auth.uid(), target);
end;
$$;

create or replace function public.unblock_user(target uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    delete from public.blocks
     where blocker_id = auth.uid()
       and blocked_id = target;
    if not found then
        raise exception 'Block not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.get_or_create_direct_conversation(friend uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    conversation_id uuid;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if friend is null or friend = caller or not public.are_friends(caller, friend) then
        raise exception 'A current friend is required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = caller and status = 'active') then
        raise exception 'An active profile is required' using errcode = '42501';
    end if;

    perform pg_advisory_xact_lock(
        hashtextextended(
            least(caller::text, friend::text) || ':' || greatest(caller::text, friend::text),
            0
        )
    );

    select c.id into conversation_id
      from public.conversations c
     where c.type = 'direct'
       and exists (
           select 1 from public.conversation_members cm
           where cm.conversation_id = c.id and cm.user_id = caller
       )
       and exists (
           select 1 from public.conversation_members cm
           where cm.conversation_id = c.id and cm.user_id = friend
       )
     order by c.created_at
     limit 1;

    if conversation_id is null then
        insert into public.conversations (type, created_by)
        values ('direct', caller)
        returning id into conversation_id;
        insert into public.conversation_members (conversation_id, user_id)
        values (conversation_id, caller), (conversation_id, friend);
    end if;
    return conversation_id;
end;
$$;

create or replace function public.create_group(name text, photo_url text, member_ids uuid[])
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    conversation_id uuid;
    group_name text := btrim(name);
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not exists (select 1 from public.profiles where id = caller and status = 'active') then
        raise exception 'An active profile is required' using errcode = '42501';
    end if;
    if group_name is null or length(group_name) = 0 then
        raise exception 'Group name is required' using errcode = '22023';
    end if;
    if member_ids is null then
        raise exception 'Member list is required' using errcode = '22023';
    end if;
    if exists (
           select 1 from unnest(member_ids) as members(member_id)
           where member_id is null or member_id = caller
       )
       or (select count(*) from unnest(member_ids)) <>
          (select count(distinct member_id)
           from unnest(member_ids) as members(member_id)) then
        raise exception 'Member list contains invalid or duplicate users' using errcode = '22023';
    end if;
    if exists (
        select 1 from unnest(member_ids) as targets(target_id)
        where not public.are_friends(caller, target_id)
           or not exists (
               select 1 from public.profiles p
               where p.id = target_id and p.status = 'active'
           )
    ) then
        raise exception 'Every group member must be an active friend' using errcode = '42501';
    end if;

    insert into public.conversations (type, name, photo_url, created_by)
    values ('group', group_name, photo_url, caller)
    returning id into conversation_id;

    insert into public.conversation_members (conversation_id, user_id, role)
    values (conversation_id, caller, 'admin');
    insert into public.conversation_members (conversation_id, user_id)
    select conversation_id, member_id
    from unnest(member_ids) as members(member_id);

    return conversation_id;
end;
$$;

create or replace function public.add_group_member(conversation uuid, "user" uuid)
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
    perform 1 from public.conversations
     where id = conversation and type = 'group'
     for update;
    if not exists (
        select 1 from public.conversations c
        join public.conversation_members cm on cm.conversation_id = c.id
        where c.id = conversation and c.type = 'group'
          and cm.user_id = caller and cm.role = 'admin' and cm.left_at is null
    ) then
        raise exception 'Active group admin permission required' using errcode = '42501';
    end if;
    if "user" is null or "user" = caller
       or not public.are_friends(caller, "user")
       or not exists (select 1 from public.profiles where id = "user" and status = 'active') then
        raise exception 'Target must be an active friend' using errcode = '42501';
    end if;

    insert into public.conversation_members as existing_member (conversation_id, user_id)
    values (conversation, "user")
    on conflict (conversation_id, user_id) do update
       set role = 'member', joined_at = now(), left_at = null, last_read_at = null
     where existing_member.left_at is not null;
    if not found then
        raise exception 'User is already an active group member' using errcode = '23505';
    end if;
end;
$$;

create or replace function public.remove_group_member(conversation uuid, "user" uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target_role text;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    perform 1 from public.conversations
     where id = conversation and type = 'group'
     for update;
    if not exists (
        select 1 from public.conversations c
        join public.conversation_members cm on cm.conversation_id = c.id
        where c.id = conversation and c.type = 'group'
          and cm.user_id = caller and cm.role = 'admin' and cm.left_at is null
    ) then
        raise exception 'Active group admin permission required' using errcode = '42501';
    end if;
    select role into target_role
      from public.conversation_members
     where conversation_id = conversation and user_id = "user" and left_at is null
     for update;
    if not found then
        raise exception 'Active group member not found' using errcode = 'P0002';
    end if;
    if target_role = 'admin' and (
        select count(*) from public.conversation_members
        where conversation_id = conversation and role = 'admin' and left_at is null
    ) <= 1 then
        raise exception 'Transfer group admin before removing the last admin' using errcode = '23514';
    end if;
    update public.conversation_members
       set left_at = now()
     where conversation_id = conversation and user_id = "user";
end;
$$;

create or replace function public.rename_group(conversation uuid, name text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    group_name text := btrim(name);
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if group_name is null or length(group_name) = 0 then
        raise exception 'Group name is required' using errcode = '22023';
    end if;
    perform 1 from public.conversations
     where id = conversation and type = 'group'
     for update;
    update public.conversations c
       set name = group_name
     where c.id = conversation
       and c.type = 'group'
       and exists (
           select 1 from public.conversation_members cm
           where cm.conversation_id = c.id and cm.user_id = auth.uid()
             and cm.role = 'admin' and cm.left_at is null
       );
    if not found then
        raise exception 'Group not found or active group admin permission required' using errcode = '42501';
    end if;
end;
$$;

create or replace function public.make_group_admin(conversation uuid, "user" uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    perform 1 from public.conversations
     where id = conversation and type = 'group'
     for update;
    if not exists (
        select 1 from public.conversations c
        join public.conversation_members cm on cm.conversation_id = c.id
        where c.id = conversation and c.type = 'group'
          and cm.user_id = auth.uid() and cm.role = 'admin' and cm.left_at is null
    ) then
        raise exception 'Active group admin permission required' using errcode = '42501';
    end if;
    update public.conversation_members
       set role = 'admin'
     where conversation_id = conversation and user_id = "user" and left_at is null;
    if not found then
        raise exception 'Active group member not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.leave_group(conversation uuid)
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
    perform 1 from public.conversations
     where id = conversation and type = 'group'
     for update;
    if not exists (
        select 1 from public.conversations c
        join public.conversation_members cm on cm.conversation_id = c.id
        where c.id = conversation and c.type = 'group'
          and cm.user_id = caller and cm.left_at is null
    ) then
        raise exception 'Active group membership not found' using errcode = 'P0002';
    end if;
    if exists (
        select 1 from public.conversation_members leaving
        where leaving.conversation_id = conversation and leaving.user_id = caller
          and leaving.role = 'admin' and leaving.left_at is null
          and (select count(*) from public.conversation_members admins
               where admins.conversation_id = conversation
                 and admins.role = 'admin' and admins.left_at is null) = 1
          and exists (select 1 from public.conversation_members others
                      where others.conversation_id = conversation
                        and others.user_id <> caller and others.left_at is null)
    ) then
        raise exception 'Transfer group admin before leaving' using errcode = '23514';
    end if;
    update public.conversation_members
       set left_at = now()
     where conversation_id = conversation and user_id = caller and left_at is null;
end;
$$;

create or replace function public.search_users(query text)
returns table (
    id uuid,
    name text,
    username text,
    bio text,
    location text,
    photo_url text,
    last_seen timestamptz
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if query is null or length(btrim(query)) = 0 then
        return;
    end if;
    return query
    select p.id, p.name, p.username, p.bio, p.location, p.photo_url, p.last_seen
      from public.profiles p
     where p.id <> auth.uid()
       and p.status <> 'banned'
       and (p.name ilike '%' || btrim(query) || '%'
            or p.username ilike '%' || btrim(query) || '%')
       and not public.is_blocked_between(auth.uid(), p.id)
     order by p.name, p.username;
end;
$$;

create or replace function public.mark_conversation_read(conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    update public.conversation_members
       set last_read_at = now()
     where conversation_id = conversation
       and user_id = auth.uid()
       and left_at is null;
    if not found then
        raise exception 'Active conversation membership not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.admin_set_user_status("user" uuid, status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_user uuid := "user";
    target_status text := status;
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    if target_status is null or target_status not in ('active', 'suspended', 'banned') then
        raise exception 'Invalid account status' using errcode = '22023';
    end if;
    update public.profiles set status = target_status where id = target_user;
    if not found then
        raise exception 'Profile not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.admin_dashboard_stats()
returns table (
    total_users bigint,
    active_users bigint,
    suspended_users bigint,
    banned_users bigint,
    total_messages bigint,
    open_reports bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    return query
    select count(*)::bigint,
           count(*) filter (where p.status = 'active')::bigint,
           count(*) filter (where p.status = 'suspended')::bigint,
           count(*) filter (where p.status = 'banned')::bigint,
           (select count(*)::bigint from public.messages),
           (select count(*)::bigint from public.reports where status = 'open')
      from public.profiles p;
end;
$$;

create or replace function public.admin_signups_by_day(days integer)
returns table (signup_day date, signups bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    if days is null or days < 1 then
        raise exception 'Days must be positive' using errcode = '22023';
    end if;
    return query
    select calendar.day::date,
           count(p.id)::bigint
      from generate_series(current_date - (days - 1), current_date, interval '1 day') calendar(day)
      left join public.profiles p on p.created_at >= calendar.day
                                and p.created_at < calendar.day + interval '1 day'
     group by calendar.day
     order by calendar.day;
end;
$$;

create or replace function public.can_access_chat_image(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    conversation_text text;
    v_conversation_id uuid;
begin
    if auth.uid() is null then
        return false;
    end if;
    conversation_text := split_part(object_name, '/', 2);
    if conversation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    v_conversation_id := conversation_text::uuid;
    return exists (
        select 1 from public.conversation_members cm
        where cm.conversation_id = v_conversation_id
          and cm.user_id = auth.uid()
    );
end;
$$;

create or replace function public.can_upload_chat_image(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    conversation_text text;
    conversation_id uuid;
    caller uuid := auth.uid();
    conversation_type text;
    other_user uuid;
begin
    if caller is null or split_part(object_name, '/', 1) <> caller::text then
        return false;
    end if;
    conversation_text := split_part(object_name, '/', 2);
    if conversation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    conversation_id := conversation_text::uuid;

    select c.type into conversation_type
      from public.conversations c
      join public.conversation_members cm on cm.conversation_id = c.id
     where c.id = conversation_id and cm.user_id = caller and cm.left_at is null;
    if not found then
        return false;
    end if;
    if conversation_type = 'group' then
        return true;
    end if;
    select cm.user_id into other_user
      from public.conversation_members cm
     where cm.conversation_id = conversation_id
       and cm.user_id <> caller
       and cm.left_at is null
     limit 1;
    return other_user is not null and public.are_friends(caller, other_user);
end;
$$;
