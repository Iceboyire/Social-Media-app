create table public.plans (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    created_by uuid not null references public.profiles (id) on delete cascade,
    title text not null check (length(btrim(title)) between 1 and 120),
    description text,
    starts_at timestamptz not null,
    ends_at timestamptz,
    location_text text,
    status text not null default 'active' check (status in ('active', 'cancelled')),
    created_at timestamptz not null default now(),
    constraint plans_end_after_start check (ends_at is null or ends_at > starts_at),
    constraint plans_description_length check (description is null or length(description) <= 2000),
    constraint plans_location_length check (location_text is null or length(location_text) <= 300)
);

create index plans_conversation_starts_idx on public.plans (conversation_id, starts_at);
create index plans_created_by_idx on public.plans (created_by);

create table public.plan_responses (
    plan_id uuid not null references public.plans (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    response text not null check (response in ('going', 'maybe', 'declined')),
    updated_at timestamptz not null default now(),
    primary key (plan_id, user_id)
);

create index plan_responses_user_id_idx on public.plan_responses (user_id, plan_id);

alter table public.messages
    add column if not exists message_type text not null default 'text'
        check (message_type in ('text', 'image', 'plan', 'poll', 'system')),
    add column if not exists plan_id uuid references public.plans (id) on delete cascade;

update public.messages
   set message_type = 'system'
 where is_system
   and message_type = 'text';

update public.messages
   set message_type = 'image'
 where not is_system
   and image_url is not null
   and message_type = 'text';

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
    elsif new.image_url is not null then
        new.message_type := 'image';
    else
        new.message_type := 'text';
    end if;
    return new;
end;
$$;

create trigger messages_set_message_type
before insert or update of is_system, plan_id, image_url on public.messages
for each row execute function public.set_message_type();

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.is_system or new.message_type in ('plan', 'poll') then
        return new;
    end if;
    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'new_message', new.sender_id, new.id
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id <> new.sender_id
       and cm.left_at is null
       and not public.is_blocked_between(new.sender_id, cm.user_id);
    return new;
end;
$$;

create unique index messages_plan_id_uidx on public.messages (plan_id) where plan_id is not null;

alter table public.notifications
    drop constraint if exists notifications_type_check;

alter table public.notifications
    add constraint notifications_type_check
    check (type in (
        'friend_request',
        'request_accepted',
        'new_message',
        'group_invite',
        'admin_warning',
        'plan_created',
        'plan_updated',
        'plan_cancelled',
        'plan_response'
    ));

create or replace function public.can_read_plan(target_plan uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select auth.uid() is not null
       and exists (
           select 1
             from public.plans p
            where p.id = target_plan
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
       or not exists (
           select 1 from public.profiles p
            where p.id = caller and p.status = 'active'
       )
       or not exists (
           select 1 from public.conversation_members cm
            where cm.conversation_id = target_conversation
              and cm.user_id = caller
              and cm.left_at is null
       ) then
        return false;
    end if;

    select c.type into conversation_type
      from public.conversations c
     where c.id = target_conversation;
    if conversation_type = 'group' then
        return true;
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
    return other_count = 1 and public.are_friends(caller, other_user);
end;
$$;

alter table public.plans enable row level security;
alter table public.plan_responses enable row level security;

revoke all on table public.plans, public.plan_responses from public, anon, authenticated;
grant select on table public.plans, public.plan_responses to authenticated;

create policy plans_select_conversation_members
on public.plans for select to authenticated
using (public.can_read_plan(plans.id));

create policy plan_responses_select_conversation_members
on public.plan_responses for select to authenticated
using (
    public.can_read_plan(plan_responses.plan_id)
    and not public.is_blocked_between(auth.uid(), plan_responses.user_id)
);

create or replace function public.create_plan(
    p_conversation_id uuid,
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
    created_plan uuid;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if not public.can_act_in_plan_conversation(p_conversation_id) then
        raise exception 'An active conversation member with permission is required' using errcode = '42501';
    end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 120 then
        raise exception 'Plan title must be between 1 and 120 characters' using errcode = '22023';
    end if;
    if p_starts_at is null or p_starts_at <= now() then
        raise exception 'Plan start must be in the future' using errcode = '22023';
    end if;
    if p_ends_at is not null and p_ends_at <= p_starts_at then
        raise exception 'Plan end must be later than its start' using errcode = '22023';
    end if;
    if p_description is not null and length(p_description) > 2000 then
        raise exception 'Plan note cannot exceed 2000 characters' using errcode = '22023';
    end if;
    if p_location_text is not null and length(p_location_text) > 300 then
        raise exception 'Plan location cannot exceed 300 characters' using errcode = '22023';
    end if;

    insert into public.plans (
        conversation_id, created_by, title, description, starts_at, ends_at, location_text
    ) values (
        p_conversation_id,
        caller,
        btrim(p_title),
        nullif(btrim(p_description), ''),
        p_starts_at,
        p_ends_at,
        nullif(btrim(p_location_text), '')
    )
    returning id into created_plan;

    insert into public.messages (conversation_id, sender_id, body, message_type, plan_id)
    values (p_conversation_id, caller, btrim(p_title), 'plan', created_plan);

    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'plan_created', caller, created_plan
      from public.conversation_members cm
     where cm.conversation_id = p_conversation_id
       and cm.user_id <> caller
       and cm.left_at is null
       and not public.is_blocked_between(caller, cm.user_id);

    return created_plan;
end;
$$;

create or replace function public.update_plan(
    p_plan_id uuid,
    p_title text,
    p_description text,
    p_starts_at timestamptz,
    p_ends_at timestamptz default null,
    p_location_text text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target public.plans%rowtype;
    caller_role text;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    select * into target from public.plans p where p.id = p_plan_id for update;
    if not found then
        raise exception 'Plan not found' using errcode = 'P0002';
    end if;
    if target.status <> 'active'
       or not public.can_act_in_plan_conversation(target.conversation_id) then
        raise exception 'An active plan and conversation membership are required' using errcode = '42501';
    end if;
    select cm.role into caller_role
      from public.conversation_members cm
     where cm.conversation_id = target.conversation_id
       and cm.user_id = caller
       and cm.left_at is null;
    if caller <> target.created_by and not (caller_role = 'admin' and exists (
        select 1 from public.conversations c
         where c.id = target.conversation_id and c.type = 'group'
    )) then
        raise exception 'Only the plan creator or a group admin can update this plan' using errcode = '42501';
    end if;
    if p_title is null or length(btrim(p_title)) not between 1 and 120
       or p_starts_at is null or p_starts_at <= now()
       or (p_ends_at is not null and p_ends_at <= p_starts_at)
       or (p_description is not null and length(p_description) > 2000)
       or (p_location_text is not null and length(p_location_text) > 300) then
        raise exception 'Plan details are invalid' using errcode = '22023';
    end if;

    update public.plans
       set title = btrim(p_title),
           description = nullif(btrim(p_description), ''),
           starts_at = p_starts_at,
           ends_at = p_ends_at,
           location_text = nullif(btrim(p_location_text), '')
     where id = p_plan_id;

    update public.messages
       set body = btrim(p_title)
     where plan_id = p_plan_id;

    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'plan_updated', caller, p_plan_id
      from public.conversation_members cm
     where cm.conversation_id = target.conversation_id
       and cm.user_id <> caller
       and cm.left_at is null
       and not public.is_blocked_between(caller, cm.user_id);
end;
$$;

create or replace function public.cancel_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target public.plans%rowtype;
    caller_role text;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    select * into target from public.plans p where p.id = p_plan_id for update;
    if not found then
        raise exception 'Plan not found' using errcode = 'P0002';
    end if;
    if target.status <> 'active'
       or not public.can_act_in_plan_conversation(target.conversation_id) then
        raise exception 'An active plan and conversation membership are required' using errcode = '42501';
    end if;
    select cm.role into caller_role
      from public.conversation_members cm
     where cm.conversation_id = target.conversation_id
       and cm.user_id = caller
       and cm.left_at is null;
    if caller <> target.created_by and not (caller_role = 'admin' and exists (
        select 1 from public.conversations c
         where c.id = target.conversation_id and c.type = 'group'
    )) then
        raise exception 'Only the plan creator or a group admin can cancel this plan' using errcode = '42501';
    end if;

    update public.plans set status = 'cancelled' where id = p_plan_id;
    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'plan_cancelled', caller, p_plan_id
      from public.conversation_members cm
     where cm.conversation_id = target.conversation_id
       and cm.user_id <> caller
       and cm.left_at is null
       and not public.is_blocked_between(caller, cm.user_id);
end;
$$;

create or replace function public.respond_to_plan(p_plan_id uuid, p_response text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target public.plans%rowtype;
    previous_response text;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if p_response is null or p_response not in ('going', 'maybe', 'declined') then
        raise exception 'Response must be going, maybe or declined' using errcode = '22023';
    end if;
    select * into target from public.plans p where p.id = p_plan_id for update;
    if not found then
        raise exception 'Plan not found' using errcode = 'P0002';
    end if;
    if target.status <> 'active'
       or target.starts_at <= now()
       or not public.can_act_in_plan_conversation(target.conversation_id) then
        raise exception 'An upcoming active plan and conversation membership are required' using errcode = '42501';
    end if;

    select pr.response into previous_response
      from public.plan_responses pr
     where pr.plan_id = p_plan_id and pr.user_id = caller
     for update;
    insert into public.plan_responses (plan_id, user_id, response, updated_at)
    values (p_plan_id, caller, p_response, now())
    on conflict (plan_id, user_id)
    do update set response = excluded.response, updated_at = excluded.updated_at;

    if previous_response is distinct from p_response
       and target.created_by <> caller
       and not public.is_blocked_between(caller, target.created_by)
       and exists (
           select 1 from public.conversation_members cm
            where cm.conversation_id = target.conversation_id
              and cm.user_id = target.created_by
              and cm.left_at is null
       ) then
        insert into public.notifications (user_id, type, actor_id, reference_id)
        values (target.created_by, 'plan_response', caller, p_plan_id);
    end if;
end;
$$;

revoke all on function public.can_read_plan(uuid) from public;
revoke all on function public.can_act_in_plan_conversation(uuid) from public;
revoke all on function public.create_plan(uuid, text, text, timestamptz, timestamptz, text) from public;
revoke all on function public.update_plan(uuid, text, text, timestamptz, timestamptz, text) from public;
revoke all on function public.cancel_plan(uuid) from public;
revoke all on function public.respond_to_plan(uuid, text) from public;

grant execute on function public.can_read_plan(uuid) to authenticated;
grant execute on function public.can_act_in_plan_conversation(uuid) to authenticated;
grant execute on function public.create_plan(uuid, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.update_plan(uuid, text, text, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cancel_plan(uuid) to authenticated;
grant execute on function public.respond_to_plan(uuid, text) to authenticated;

drop policy if exists messages_select_member_history on public.messages;
create policy messages_select_member_history
on public.messages for select to authenticated
using (
    public.is_conversation_member(messages.conversation_id, false)
    and (
        messages.message_type <> 'plan'
        or public.can_read_plan(messages.plan_id)
    )
);

do $$
declare
    table_name text;
begin
    foreach table_name in array array['public.plans', 'public.plan_responses'] loop
        if not exists (
            select 1
              from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename = split_part(table_name, '.', 2)
        ) then
            execute format('alter publication supabase_realtime add table %s', table_name);
        end if;
    end loop;
end;
$$;
