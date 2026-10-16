create table public.chat_memories (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    message_id uuid not null references public.messages (id) on delete cascade,
    created_at timestamptz not null default now(),
    unique (user_id, message_id)
);

create index chat_memories_user_created_idx on public.chat_memories (user_id, created_at desc);

create table public.live_locations (
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    latitude double precision not null check (latitude between -90 and 90),
    longitude double precision not null check (longitude between -180 and 180),
    expires_at timestamptz not null,
    updated_at timestamptz not null default now(),
    primary key (conversation_id, user_id)
);

create index live_locations_expiry_idx on public.live_locations (expires_at);

alter table public.chat_memories enable row level security;
alter table public.live_locations enable row level security;

revoke all on table public.chat_memories, public.live_locations from public, anon, authenticated;
grant select on table public.chat_memories, public.live_locations to authenticated;

create policy chat_memories_select_own
on public.chat_memories for select to authenticated
using (user_id = auth.uid());

create policy live_locations_select_authorized_conversation
on public.live_locations for select to authenticated
using (
    expires_at > now()
    and public.can_write_chat_conversation(conversation_id)
    and exists (
        select 1 from public.conversation_members owner_member
         where owner_member.conversation_id = live_locations.conversation_id
           and owner_member.user_id = live_locations.user_id
           and owner_member.left_at is null
    )
    and not public.is_blocked_between(auth.uid(), user_id)
);

create or replace function public.save_chat_memory(p_message_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target public.messages%rowtype;
    memory_id uuid;
begin
    if caller is null then
        raise exception 'Authentication required.' using errcode = '42501';
    end if;
    select * into target
      from public.messages m
     where m.id = p_message_id
       and m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now())
       and m.message_type in ('text', 'image', 'voice')
     for share;
    if not found or not public.can_write_chat_conversation(target.conversation_id) then
        raise exception 'This message cannot be saved to memories.' using errcode = '42501';
    end if;

    insert into public.chat_memories (user_id, conversation_id, message_id)
    values (caller, target.conversation_id, target.id)
    on conflict (user_id, message_id) do update
       set created_at = public.chat_memories.created_at
    returning id into memory_id;
    return memory_id;
end;
$$;

create or replace function public.remove_chat_memory(p_memory_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.chat_memories
     where id = p_memory_id
       and user_id = auth.uid();
    if not found then
        raise exception 'Memory not found.' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.update_live_location(
    p_conversation_id uuid,
    p_latitude double precision,
    p_longitude double precision,
    p_expires_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is null
       or p_latitude is null or p_longitude is null
       or p_latitude not between -90 and 90
       or p_longitude not between -180 and 180
       or p_expires_at is null
       or p_expires_at <= now()
       or p_expires_at > now() + interval '1 hour' then
        raise exception 'Location or expiry is invalid.' using errcode = '22023';
    end if;
    if not public.can_write_chat_conversation(p_conversation_id) then
        raise exception 'Live location is unavailable in this conversation.' using errcode = '42501';
    end if;

    insert into public.live_locations (
        conversation_id, user_id, latitude, longitude, expires_at, updated_at
    )
    values (p_conversation_id, auth.uid(), p_latitude, p_longitude, p_expires_at, now())
    on conflict (conversation_id, user_id) do update
       set latitude = excluded.latitude,
           longitude = excluded.longitude,
           expires_at = excluded.expires_at,
           updated_at = excluded.updated_at;
end;
$$;

create or replace function public.stop_live_location(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    delete from public.live_locations
     where conversation_id = p_conversation_id
       and user_id = auth.uid();
end;
$$;

create or replace function public.cleanup_expired_live_locations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    deleted_count integer;
begin
    delete from public.live_locations where expires_at <= now();
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;

revoke all on function public.save_chat_memory(uuid) from public;
revoke all on function public.remove_chat_memory(uuid) from public;
revoke all on function public.update_live_location(uuid, double precision, double precision, timestamptz) from public;
revoke all on function public.stop_live_location(uuid) from public;
revoke all on function public.cleanup_expired_live_locations() from public, anon, authenticated;

grant execute on function public.save_chat_memory(uuid) to authenticated;
grant execute on function public.remove_chat_memory(uuid) to authenticated;
grant execute on function public.update_live_location(uuid, double precision, double precision, timestamptz) to authenticated;
grant execute on function public.stop_live_location(uuid) to authenticated;
grant execute on function public.cleanup_expired_live_locations() to service_role;

do $$
declare
    table_name text;
begin
    foreach table_name in array array['chat_memories', 'live_locations'] loop
        if not exists (
            select 1
              from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename = table_name
        ) then
            execute format('alter publication supabase_realtime add table public.%I', table_name);
        end if;
    end loop;

    if exists (select 1 from pg_extension where extname = 'pg_cron')
       and to_regclass('cron.job') is not null then
        perform cron.unschedule(jobid)
          from cron.job
         where jobname = 'gather-live-location-cleanup';
        perform cron.schedule(
            'gather-live-location-cleanup',
            '*/5 * * * *',
            'select public.cleanup_expired_live_locations();'
        );
    else
        raise notice 'pg_cron is unavailable; schedule public.cleanup_expired_live_locations() every 5 minutes.';
    end if;
end;
$$;
