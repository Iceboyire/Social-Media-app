create table public.time_polls (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    created_by uuid not null references public.profiles (id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 120),
    location_text text,
    status text not null default 'open' check (status in ('open', 'closed')),
    closes_at timestamptz,
    created_at timestamptz not null default now(),
    plan_id uuid references public.plans (id) on delete set null
);

create table public.poll_options (
    id uuid primary key default gen_random_uuid(),
    poll_id uuid not null references public.time_polls (id) on delete cascade,
    starts_at timestamptz not null
);

alter table public.time_polls
    add column winning_option_id uuid references public.poll_options (id) on delete set null;

create table public.poll_votes (
    option_id uuid not null references public.poll_options (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    vote text not null check (vote in ('yes', 'maybe')),
    updated_at timestamptz not null default now(),
    primary key (option_id, user_id)
);

create index time_polls_conversation_created_idx on public.time_polls (conversation_id, created_at desc);
create index poll_options_poll_starts_idx on public.poll_options (poll_id, starts_at);
create index poll_votes_user_id_idx on public.poll_votes (user_id, option_id);

alter table public.messages
    add column poll_id uuid references public.time_polls (id) on delete set null;

create or replace function public.set_message_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.is_system then
        new.message_type := 'system';
    elsif new.plan_id is not null then
        new.message_type := 'plan';
    elsif new.poll_id is not null then
        new.message_type := 'poll';
    elsif new.image_url is not null then
        new.message_type := 'image';
    else
        new.message_type := 'text';
    end if;
    return new;
end;
$$;

drop trigger if exists messages_set_message_type on public.messages;
create trigger messages_set_message_type
before insert or update of is_system, plan_id, poll_id, image_url on public.messages
for each row execute function public.set_message_type();

alter table public.notifications
    drop constraint if exists notifications_type_check;
alter table public.notifications
    add constraint notifications_type_check
    check (type in (
        'friend_request', 'request_accepted', 'new_message', 'group_invite', 'admin_warning',
        'plan_created', 'plan_updated', 'plan_cancelled', 'plan_response',
        'poll_created', 'poll_closed', 'poll_vote'
    ));

create or replace function public.can_read_time_poll(target_poll uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select auth.uid() is not null
       and exists (
           select 1
             from public.time_polls p
            where p.id = target_poll
              and public.is_conversation_member(p.conversation_id, false)
              and not public.is_blocked_between(auth.uid(), p.created_by)
       );
$$;

create or replace function public.can_act_in_plan_conversation(target_conversation uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    conversation_type text;
    other_user uuid;
    other_count integer;
begin
    if caller is null
       or not exists (select 1 from public.profiles p where p.id = caller and p.status = 'active')
       or not exists (
           select 1 from public.conversation_members cm
            where cm.conversation_id = target_conversation
              and cm.user_id = caller
              and cm.left_at is null
       ) then
        return false;
    end if;
    select c.type into conversation_type from public.conversations c where c.id = target_conversation;
    if conversation_type = 'group' then
        return not exists (
            select 1 from public.conversation_members cm
             where cm.conversation_id = target_conversation
               and cm.left_at is null
               and cm.user_id <> caller
               and public.is_blocked_between(caller, cm.user_id)
        );
    end if;
    if conversation_type <> 'direct' then
        return false;
    end if;
    select count(*)::integer, (array_agg(cm.user_id))[1]
      into other_count, other_user
      from public.conversation_members cm
     where cm.conversation_id = target_conversation
       and cm.user_id <> caller
       and cm.left_at is null;
    return other_count = 1
       and public.are_friends(caller, other_user)
       and not public.is_blocked_between(caller, other_user);
end;
$$;

alter table public.time_polls enable row level security;
alter table public.poll_options enable row level security;
alter table public.poll_votes enable row level security;
revoke all on table public.time_polls, public.poll_options, public.poll_votes from public, anon, authenticated;
grant select on table public.time_polls, public.poll_options, public.poll_votes to authenticated;

create policy time_polls_select_conversation_members
on public.time_polls for select to authenticated
using (public.can_read_time_poll(time_polls.id));

create policy poll_options_select_conversation_members
on public.poll_options for select to authenticated
using (public.can_read_time_poll(poll_options.poll_id));

create policy poll_votes_select_conversation_members
on public.poll_votes for select to authenticated
using (
    public.can_read_time_poll((select po.poll_id from public.poll_options po where po.id = poll_votes.option_id))
    and not public.is_blocked_between(auth.uid(), poll_votes.user_id)
);

create or replace function public.create_time_poll(
    p_conversation_id uuid,
    p_title text,
    p_location_text text,
    p_options timestamptz[],
    p_closes_at timestamptz default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    created_poll uuid;
    option_time timestamptz;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not public.can_act_in_plan_conversation(p_conversation_id) then
        raise exception 'An active conversation member with permission is required' using errcode = '42501';
    end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 120
       or p_options is null or cardinality(p_options) not between 2 and 6
       or (p_location_text is not null and length(p_location_text) > 300)
       or (p_closes_at is not null and p_closes_at <= now()) then
        raise exception 'Poll details are invalid' using errcode = '22023';
    end if;
    if exists (select 1 from unnest(p_options) as options(option_time) where option_time <= now())
       or (select count(distinct option_time) from unnest(p_options) as options(option_time)) <> cardinality(p_options) then
        raise exception 'Poll options must be unique future times' using errcode = '22023';
    end if;

    insert into public.time_polls (conversation_id, created_by, title, location_text, closes_at)
    values (p_conversation_id, caller, btrim(p_title), nullif(btrim(p_location_text), ''), p_closes_at)
    returning id into created_poll;

    foreach option_time in array p_options loop
        insert into public.poll_options (poll_id, starts_at) values (created_poll, option_time);
    end loop;

    insert into public.messages (conversation_id, sender_id, body, message_type, poll_id)
    values (p_conversation_id, caller, btrim(p_title), 'poll', created_poll);

    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'poll_created', caller, created_poll
      from public.conversation_members cm
     where cm.conversation_id = p_conversation_id
       and cm.user_id <> caller
       and cm.left_at is null
       and not public.is_blocked_between(caller, cm.user_id);
    return created_poll;
end;
$$;

create or replace function public.vote_on_option(p_option_id uuid, p_vote text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target_poll public.time_polls%rowtype;
    target_option public.poll_options%rowtype;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    select * into target_option from public.poll_options where id = p_option_id;
    if not found then
        raise exception 'Poll option not found' using errcode = 'P0002';
    end if;
    select * into target_poll from public.time_polls where id = target_option.poll_id for update;
    if target_poll.status <> 'open'
       or (target_poll.closes_at is not null and target_poll.closes_at <= now())
       or target_option.starts_at <= now()
       or not public.can_act_in_plan_conversation(target_poll.conversation_id) then
        raise exception 'An open poll in an active conversation is required' using errcode = '42501';
    end if;
    if p_vote is null then
        delete from public.poll_votes where option_id = p_option_id and user_id = caller;
        return;
    end if;
    if p_vote not in ('yes', 'maybe') then
        raise exception 'Vote must be yes or maybe, or null to remove it' using errcode = '22023';
    end if;

    insert into public.poll_votes (option_id, user_id, vote, updated_at)
    values (p_option_id, caller, p_vote, now())
    on conflict (option_id, user_id)
    do update set vote = excluded.vote, updated_at = excluded.updated_at;

    insert into public.notifications (user_id, type, actor_id, reference_id)
    select target_poll.created_by, 'poll_vote', caller, target_poll.id
    where target_poll.created_by <> caller
      and not public.is_blocked_between(caller, target_poll.created_by);
end;
$$;

create or replace function public.close_poll(p_poll_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target public.time_polls%rowtype;
    caller_role text;
    winning_option uuid;
    winning_time timestamptz;
    created_plan uuid;
    creator_active boolean := false;
    can_auto_create boolean := false;
    conversation_type text;
    other_user uuid;
    other_count integer;
begin
    select * into target from public.time_polls where id = p_poll_id for update;
    if not found then
        raise exception 'Poll not found' using errcode = 'P0002';
    end if;
    if caller is not null then
        if not public.can_act_in_plan_conversation(target.conversation_id) then
            raise exception 'An active conversation member is required' using errcode = '42501';
        end if;
        select cm.role into caller_role from public.conversation_members cm
         where cm.conversation_id = target.conversation_id
           and cm.user_id = caller and cm.left_at is null;
        if caller <> target.created_by and not (caller_role = 'admin' and exists (
            select 1 from public.conversations c
             where c.id = target.conversation_id and c.type = 'group'
        )) then
            raise exception 'Only the poll creator or a group admin can close this poll' using errcode = '42501';
        end if;
    elsif current_user not in ('postgres', 'supabase_admin') then
        raise exception 'Internal poll closure only' using errcode = '42501';
    end if;
    if target.status <> 'open' then
        return target.plan_id;
    end if;

    select po.id, po.starts_at into winning_option, winning_time
      from public.poll_options po
     where po.poll_id = p_poll_id and po.starts_at > now()
     order by (
         select count(*) from public.poll_votes pv
          where pv.option_id = po.id and pv.vote = 'yes'
     ) desc, po.starts_at asc
     limit 1;

    update public.time_polls
       set status = 'closed', winning_option_id = winning_option
     where id = p_poll_id;
    if winning_option is not null then
        if caller is not null then
            created_plan := public.create_plan(
                target.conversation_id,
                target.title,
                'Created from availability poll',
                winning_time,
                null,
                target.location_text
            );
        else
            select c.type into conversation_type
              from public.conversations c where c.id = target.conversation_id;
            select exists (
                select 1 from public.profiles p
                 where p.id = target.created_by and p.status = 'active'
            ) and exists (
                select 1 from public.conversation_members cm
                 where cm.conversation_id = target.conversation_id
                   and cm.user_id = target.created_by and cm.left_at is null
            ) into creator_active;

            if creator_active and conversation_type = 'group' then
                can_auto_create := not exists (
                    select 1 from public.conversation_members cm
                     where cm.conversation_id = target.conversation_id
                       and cm.left_at is null
                       and cm.user_id <> target.created_by
                       and public.is_blocked_between(target.created_by, cm.user_id)
                );
            elsif creator_active and conversation_type = 'direct' then
                select count(*)::integer, (array_agg(cm.user_id))[1]
                  into other_count, other_user
                  from public.conversation_members cm
                 where cm.conversation_id = target.conversation_id
                   and cm.user_id <> target.created_by
                   and cm.left_at is null;
                can_auto_create := other_count = 1
                    and public.are_friends(target.created_by, other_user)
                    and not public.is_blocked_between(target.created_by, other_user);
            end if;

            if can_auto_create then
                insert into public.plans (
                    conversation_id, created_by, title, description, starts_at, location_text
                ) values (
                    target.conversation_id, target.created_by, target.title,
                    'Created from availability poll', winning_time, target.location_text
                ) returning id into created_plan;
                insert into public.messages (conversation_id, sender_id, body, message_type, plan_id)
                values (target.conversation_id, target.created_by, target.title, 'plan', created_plan);
                insert into public.notifications (user_id, type, actor_id, reference_id)
                select cm.user_id, 'plan_created', target.created_by, created_plan
                  from public.conversation_members cm
                 where cm.conversation_id = target.conversation_id
                   and cm.user_id <> target.created_by
                   and cm.left_at is null
                   and not public.is_blocked_between(target.created_by, cm.user_id);
            end if;
        end if;

        if created_plan is not null then
            update public.time_polls set plan_id = created_plan where id = p_poll_id;
        end if;
        if caller is not null or can_auto_create then
            insert into public.messages (conversation_id, sender_id, body, message_type, is_system)
            values (
                target.conversation_id,
                coalesce(caller, target.created_by),
                case when created_plan is not null
                    then 'Poll closed. A plan was created for the winning time.'
                    else 'Poll closed. No plan could be created for the winning time.'
                end,
                'system',
                true
            );
        end if;
    elsif caller is not null then
        insert into public.messages (conversation_id, sender_id, body, message_type, is_system)
        values (target.conversation_id, coalesce(caller, target.created_by), 'Poll closed. No upcoming option remained, so no plan was created.', 'system', true);
    end if;

    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'poll_closed', coalesce(caller, target.created_by), p_poll_id
      from public.conversation_members cm
     where cm.conversation_id = target.conversation_id
       and cm.user_id <> coalesce(caller, target.created_by)
       and cm.left_at is null
       and exists (
           select 1 from public.profiles actor
            where actor.id = coalesce(caller, target.created_by) and actor.status = 'active'
       )
       and not public.is_blocked_between(coalesce(caller, target.created_by), cm.user_id);
    return created_plan;
end;
$$;

create or replace function public.close_expired_time_polls()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    expired public.time_polls%rowtype;
    closed_count integer := 0;
begin
    for expired in
        select * from public.time_polls
         where status = 'open' and closes_at is not null and closes_at <= now()
         for update skip locked
    loop
        perform public.close_poll(expired.id);
        closed_count := closed_count + 1;
    end loop;
    return closed_count;
end;
$$;

drop policy if exists messages_select_member_history on public.messages;
create policy messages_select_member_history
on public.messages for select to authenticated
using (
    public.is_conversation_member(messages.conversation_id, false)
    and (
        (messages.message_type <> 'plan' or public.can_read_plan(messages.plan_id))
        and (messages.message_type <> 'poll' or public.can_read_time_poll(messages.poll_id))
    )
);

drop policy if exists messages_insert_active_member on public.messages;
create policy messages_insert_active_member
on public.messages for insert to authenticated
with check (
    sender_id = auth.uid()
    and message_type in ('text', 'image')
    and plan_id is null
    and poll_id is null
    and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.status = 'active'
    )
    and exists (
        select 1
          from public.conversations c
          join public.conversation_members own
            on own.conversation_id = c.id
           and own.user_id = auth.uid()
           and own.left_at is null
         where c.id = messages.conversation_id
           and (
               c.type = 'group'
               or (
                   c.type = 'direct'
                   and exists (
                       select 1 from public.conversation_members other
                       where other.conversation_id = c.id
                         and other.user_id <> auth.uid()
                         and other.left_at is null
                         and public.are_friends(auth.uid(), other.user_id)
                         and not public.is_blocked_between(auth.uid(), other.user_id)
                   )
               )
           )
    )
);

revoke all on function public.can_read_time_poll(uuid) from public;
revoke all on function public.create_time_poll(uuid, text, text, timestamptz[], timestamptz) from public;
revoke all on function public.vote_on_option(uuid, text) from public;
revoke all on function public.close_poll(uuid) from public;
revoke all on function public.close_expired_time_polls() from public, anon, authenticated;
grant execute on function public.can_read_time_poll(uuid) to authenticated;
grant execute on function public.create_time_poll(uuid, text, text, timestamptz[], timestamptz) to authenticated;
grant execute on function public.vote_on_option(uuid, text) to authenticated;
grant execute on function public.close_poll(uuid) to authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array['public.time_polls', 'public.poll_options', 'public.poll_votes'] loop
        if not exists (
            select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename = split_part(table_name, '.', 2)
        ) then
            execute format('alter publication supabase_realtime add table %s', table_name);
        end if;
    end loop;
end;
$$;
