alter table public.messages
    add column reply_to_message_id uuid references public.messages (id) on delete set null,
    add column edited_at timestamptz,
    add column deleted_at timestamptz,
    add column expires_at timestamptz,
    add column voice_path text;

alter table public.messages
    drop constraint if exists messages_have_content,
    drop constraint if exists messages_message_type_check,
    add constraint messages_message_type_check
        check (message_type in ('text', 'image', 'plan', 'poll', 'system', 'voice', 'deleted')),
    add constraint messages_have_content
        check (
            deleted_at is not null
            or nullif(btrim(body), '') is not null
            or nullif(btrim(image_url), '') is not null
            or nullif(btrim(voice_path), '') is not null
        );

create index messages_reply_to_idx on public.messages (reply_to_message_id);
create index messages_expires_at_idx on public.messages (expires_at) where expires_at is not null;

create table public.message_reactions (
    message_id uuid not null references public.messages (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    emoji text not null check (emoji in ('❤️', '😂', '👍', '😮', '😢', '🎉')),
    created_at timestamptz not null default now(),
    primary key (message_id, user_id, emoji)
);

create index message_reactions_message_idx on public.message_reactions (message_id);

create table public.conversation_chat_settings (
    conversation_id uuid primary key references public.conversations (id) on delete cascade,
    expires_in_seconds integer not null default 0
        check (expires_in_seconds in (0, 86400, 604800, 2592000)),
    updated_by uuid not null references public.profiles (id),
    updated_at timestamptz not null default now()
);

create table public.conversation_pins (
    conversation_id uuid primary key references public.conversations (id) on delete cascade,
    message_id uuid not null references public.messages (id) on delete cascade,
    pinned_by uuid not null references public.profiles (id),
    created_at timestamptz not null default now()
);

create table public.expired_chat_objects (
    bucket_id text not null check (bucket_id in ('chat-images', 'chat-voice-notes')),
    object_path text not null,
    owner_id uuid not null references public.profiles (id) on delete cascade,
    queued_at timestamptz not null default now(),
    primary key (bucket_id, object_path)
);

alter table public.message_reactions enable row level security;
alter table public.conversation_chat_settings enable row level security;
alter table public.conversation_pins enable row level security;
alter table public.expired_chat_objects enable row level security;

create policy message_reactions_select_member_history
on public.message_reactions for select to authenticated
using (
    exists (
        select 1 from public.messages m
        where m.id = message_reactions.message_id
          and m.deleted_at is null
          and (m.expires_at is null or m.expires_at > now())
          and public.is_conversation_member(m.conversation_id, false)
    )
);

create policy conversation_chat_settings_select_member_history
on public.conversation_chat_settings for select to authenticated
using (public.is_conversation_member(conversation_id, false));

create policy conversation_pins_select_member_history
on public.conversation_pins for select to authenticated
using (public.is_conversation_member(conversation_id, false));

grant select on public.message_reactions, public.conversation_chat_settings, public.conversation_pins to authenticated;
revoke insert, update, delete on public.message_reactions, public.conversation_chat_settings, public.conversation_pins from anon, authenticated;
revoke all on public.expired_chat_objects from anon, authenticated;

create or replace function public.can_write_chat_conversation(target_conversation uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    conversation_type text;
begin
    if caller is null or not exists (
        select 1 from public.profiles p where p.id = caller and p.status = 'active'
    ) then
        return false;
    end if;

    select c.type into conversation_type
      from public.conversations c
      join public.conversation_members own
        on own.conversation_id = c.id
       and own.user_id = caller
       and own.left_at is null
     where c.id = target_conversation;
    if not found then
        return false;
    end if;

    if conversation_type = 'direct' then
        return exists (
            select 1
              from public.conversation_members other
             where other.conversation_id = target_conversation
               and other.user_id <> caller
               and other.left_at is null
               and public.are_friends(caller, other.user_id)
        );
    end if;

    return not exists (
        select 1
          from public.conversation_members other
         where other.conversation_id = target_conversation
           and other.user_id <> caller
           and other.left_at is null
           and public.is_blocked_between(caller, other.user_id)
    );
end;
$$;

create or replace function public.set_chat_message_type()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.deleted_at is not null then
        new.message_type := 'deleted';
    elsif new.is_system then
        new.message_type := 'system';
    elsif new.plan_id is not null then
        new.message_type := 'plan';
    elsif new.poll_id is not null then
        new.message_type := 'poll';
    elsif new.voice_path is not null then
        new.message_type := 'voice';
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
before insert or update of is_system, plan_id, poll_id, image_url, voice_path, deleted_at on public.messages
for each row execute function public.set_chat_message_type();

create or replace function public.set_chat_message_expiry()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    expiry_seconds integer;
begin
    if auth.uid() is not null
       and not new.is_system
       and not public.can_write_chat_conversation(new.conversation_id) then
        raise exception 'You cannot add content to this conversation.' using errcode = '42501';
    end if;
    select s.expires_in_seconds into expiry_seconds
      from public.conversation_chat_settings s
     where s.conversation_id = new.conversation_id;
    if coalesce(expiry_seconds, 0) > 0 then
        new.expires_at := now() + make_interval(secs => expiry_seconds);
    end if;
    return new;
end;
$$;

create trigger messages_set_chat_expiry
before insert on public.messages
for each row execute function public.set_chat_message_expiry();

create or replace function public.can_access_chat_image(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    return auth.uid() is not null and exists (
        select 1
          from public.messages m
         where m.image_url = object_name
           and m.deleted_at is null
           and (m.expires_at is null or m.expires_at > now())
           and public.is_conversation_member(m.conversation_id, false)
    );
end;
$$;

create or replace function public.can_access_chat_voice(object_name text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select auth.uid() is not null and exists (
        select 1
          from public.messages m
         where m.voice_path = object_name
           and m.deleted_at is null
           and (m.expires_at is null or m.expires_at > now())
           and public.is_conversation_member(m.conversation_id, false)
    );
$$;

create or replace function public.can_upload_chat_voice(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    conversation_text text;
    target_conversation uuid;
begin
    if caller is null or split_part(object_name, '/', 1) <> caller::text then
        return false;
    end if;
    conversation_text := split_part(object_name, '/', 2);
    if conversation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    target_conversation := conversation_text::uuid;
    return public.can_write_chat_conversation(target_conversation);
end;
$$;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'chat-voice-notes',
    'chat-voice-notes',
    false,
    5242880,
    array['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav']
)
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy chat_voice_member_read
on storage.objects for select to authenticated
using (bucket_id = 'chat-voice-notes' and public.can_access_chat_voice(name));

create policy chat_voice_upload_active_member
on storage.objects for insert to authenticated
with check (bucket_id = 'chat-voice-notes' and public.can_upload_chat_voice(name));

create policy chat_voice_delete_owner
on storage.objects for delete to authenticated
using (bucket_id = 'chat-voice-notes' and split_part(name, '/', 1) = auth.uid()::text);

create or replace function public.send_chat_message(
    p_conversation_id uuid,
    p_body text,
    p_image_path text,
    p_reply_to_message_id uuid
)
returns setof public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    cleaned_body text := nullif(btrim(p_body), '');
begin
    if not public.can_write_chat_conversation(p_conversation_id) then
        raise exception 'You cannot send messages in this conversation.' using errcode = '42501';
    end if;
    if length(coalesce(cleaned_body, '')) > 5000
       or (cleaned_body is null and p_image_path is null) then
        raise exception 'Message content is invalid.' using errcode = '22023';
    end if;
    if p_image_path is not null and (
        not public.can_upload_chat_image(p_image_path)
        or split_part(p_image_path, '/', 1) <> caller::text
        or not exists (
            select 1 from storage.objects o
            where o.bucket_id = 'chat-images' and o.name = p_image_path
        )
    ) then
        raise exception 'The selected image is unavailable.' using errcode = '42501';
    end if;
    if p_reply_to_message_id is not null and not exists (
        select 1 from public.messages m
        where m.id = p_reply_to_message_id
          and m.conversation_id = p_conversation_id
          and m.deleted_at is null
          and (m.expires_at is null or m.expires_at > now())
    ) then
        raise exception 'The message being replied to is no longer available.' using errcode = '22023';
    end if;
    return query
    insert into public.messages (conversation_id, sender_id, body, image_url, reply_to_message_id)
    values (p_conversation_id, caller, cleaned_body, p_image_path, p_reply_to_message_id)
    returning *;
end;
$$;

create or replace function public.send_chat_voice_note(
    p_conversation_id uuid,
    p_voice_path text,
    p_reply_to_message_id uuid
)
returns setof public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
begin
    if not public.can_write_chat_conversation(p_conversation_id)
       or not public.can_upload_chat_voice(p_voice_path)
       or split_part(p_voice_path, '/', 1) <> caller::text
       or not exists (
           select 1 from storage.objects o
           where o.bucket_id = 'chat-voice-notes' and o.name = p_voice_path
       ) then
        raise exception 'The voice note could not be sent in this conversation.' using errcode = '42501';
    end if;
    if p_reply_to_message_id is not null and not exists (
        select 1 from public.messages m
        where m.id = p_reply_to_message_id
          and m.conversation_id = p_conversation_id
          and m.deleted_at is null
          and (m.expires_at is null or m.expires_at > now())
    ) then
        raise exception 'The message being replied to is no longer available.' using errcode = '22023';
    end if;
    return query
    insert into public.messages (conversation_id, sender_id, voice_path, reply_to_message_id)
    values (p_conversation_id, caller, p_voice_path, p_reply_to_message_id)
    returning *;
end;
$$;

create or replace function public.react_to_chat_message(p_message_id uuid, p_emoji text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
    target_conversation uuid;
    removed integer;
begin
    select m.conversation_id into target_conversation
      from public.messages m
     where m.id = p_message_id
       and m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now())
       and m.message_type in ('text', 'image', 'voice');
    if not found or not public.can_write_chat_conversation(target_conversation) then
        raise exception 'This message cannot be reacted to.' using errcode = '42501';
    end if;
    if p_emoji not in ('❤️', '😂', '👍', '😮', '😢', '🎉') then
        raise exception 'Choose one of the available reactions.' using errcode = '22023';
    end if;
    delete from public.message_reactions
     where message_id = p_message_id
       and user_id = auth.uid()
       and emoji = p_emoji;
    get diagnostics removed = row_count;
    if removed = 0 then
        insert into public.message_reactions (message_id, user_id, emoji)
        values (p_message_id, auth.uid(), p_emoji);
        return true;
    end if;
    return false;
end;
$$;

create or replace function public.edit_chat_message(p_message_id uuid, p_body text)
returns setof public.messages
language plpgsql
security definer
set search_path = public
as $$
declare
    target_conversation uuid;
    cleaned_body text := nullif(btrim(p_body), '');
begin
    select m.conversation_id into target_conversation
      from public.messages m
     where m.id = p_message_id
       and m.sender_id = auth.uid()
       and m.message_type = 'text'
       and m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now());
    if not found or not public.can_write_chat_conversation(target_conversation) then
        raise exception 'This message can no longer be edited.' using errcode = '42501';
    end if;
    if cleaned_body is null or length(cleaned_body) > 5000 then
        raise exception 'Message text must contain 1 to 5000 characters.' using errcode = '22023';
    end if;
    return query
    update public.messages
       set body = cleaned_body, edited_at = now()
     where id = p_message_id
    returning *;
end;
$$;

create or replace function public.delete_chat_message(p_message_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
    target public.messages%rowtype;
    bucket text;
    object_path text;
begin
    select * into target
      from public.messages m
     where m.id = p_message_id
       and m.sender_id = auth.uid()
       and m.message_type in ('text', 'image', 'voice')
       and m.deleted_at is null
     for update;
    if not found or not public.can_write_chat_conversation(target.conversation_id) then
        raise exception 'This message can no longer be deleted.' using errcode = '42501';
    end if;
    bucket := case when target.voice_path is not null then 'chat-voice-notes'
                   when target.image_url is not null then 'chat-images'
                   else null end;
    object_path := coalesce(target.voice_path, target.image_url);
    if bucket is not null then
        insert into public.expired_chat_objects (bucket_id, object_path, owner_id)
        values (bucket, object_path, target.sender_id)
        on conflict (bucket_id, object_path) do nothing;
    end if;
    delete from public.message_reactions where message_id = p_message_id;
    delete from public.conversation_pins where message_id = p_message_id;
    update public.messages
       set body = null, image_url = null, voice_path = null, deleted_at = now()
     where id = p_message_id;
    return object_path;
end;
$$;

create or replace function public.pin_chat_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_conversation uuid;
begin
    select m.conversation_id into target_conversation
      from public.messages m
     where m.id = p_message_id
       and m.message_type in ('text', 'image', 'voice')
       and m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now());
    if not found or not public.can_write_chat_conversation(target_conversation) then
        raise exception 'This message cannot be pinned.' using errcode = '42501';
    end if;
    insert into public.conversation_pins (conversation_id, message_id, pinned_by)
    values (target_conversation, p_message_id, auth.uid())
    on conflict (conversation_id) do update
       set message_id = excluded.message_id,
           pinned_by = excluded.pinned_by,
           created_at = now();
end;
$$;

create or replace function public.unpin_chat_message(p_conversation_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if not public.can_write_chat_conversation(p_conversation_id) then
        raise exception 'You cannot change pins in this conversation.' using errcode = '42501';
    end if;
    delete from public.conversation_pins where conversation_id = p_conversation_id;
end;
$$;

create or replace function public.set_chat_expiry(p_conversation_id uuid, p_expires_in_seconds integer)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if p_expires_in_seconds is null
       or p_expires_in_seconds not in (0, 86400, 604800, 2592000) then
        raise exception 'Choose a supported message expiry.' using errcode = '22023';
    end if;
    if not public.can_write_chat_conversation(p_conversation_id) then
        raise exception 'You cannot change settings for this conversation.' using errcode = '42501';
    end if;
    insert into public.conversation_chat_settings (conversation_id, expires_in_seconds, updated_by, updated_at)
    values (p_conversation_id, p_expires_in_seconds, auth.uid(), now())
    on conflict (conversation_id) do update
       set expires_in_seconds = excluded.expires_in_seconds,
           updated_by = excluded.updated_by,
           updated_at = now();
end;
$$;

create or replace function public.take_expired_chat_objects()
returns table(bucket_id text, object_path text)
language plpgsql
security definer
set search_path = public
as $$
begin
    return query
    select o.bucket_id, o.object_path
      from public.expired_chat_objects o
     where o.owner_id = auth.uid()
     order by o.queued_at
     limit 50;
end;
$$;

create or replace function public.ack_expired_chat_objects(p_object_paths text[])
returns void
language sql
security definer
set search_path = public
as $$
    delete from public.expired_chat_objects o
     where o.owner_id = auth.uid()
       and o.object_path = any(coalesce(p_object_paths, array[]::text[]));
$$;

create or replace function public.cleanup_expired_chat_messages()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    deleted_count integer;
begin
    insert into public.expired_chat_objects (bucket_id, object_path, owner_id)
    select case when m.voice_path is not null then 'chat-voice-notes' else 'chat-images' end,
           coalesce(m.voice_path, m.image_url),
           m.sender_id
      from public.messages m
     where m.expires_at <= now()
       and m.deleted_at is null
       and (m.voice_path is not null or m.image_url is not null)
    on conflict (bucket_id, object_path) do nothing;

    delete from public.messages where expires_at <= now();
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$;

drop policy if exists messages_select_member_history on public.messages;
create policy messages_select_member_history
on public.messages for select to authenticated
using (
    public.is_conversation_member(messages.conversation_id, false)
    and (messages.expires_at is null or messages.expires_at > now())
    and (
        (messages.message_type <> 'plan' or public.can_read_plan(messages.plan_id))
        and (messages.message_type <> 'poll' or public.can_read_time_poll(messages.poll_id))
    )
);

drop policy if exists messages_insert_active_member on public.messages;
revoke insert, update, delete on public.messages from anon, authenticated;

create or replace function public.can_upload_chat_image(object_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    conversation_text text;
    target_conversation uuid;
begin
    if caller is null or split_part(object_name, '/', 1) <> caller::text then
        return false;
    end if;
    conversation_text := split_part(object_name, '/', 2);
    if conversation_text !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        return false;
    end if;
    target_conversation := conversation_text::uuid;
    return public.can_write_chat_conversation(target_conversation);
end;
$$;

revoke all on function public.can_write_chat_conversation(uuid) from public;
revoke all on function public.send_chat_message(uuid, text, text, uuid) from public;
revoke all on function public.send_chat_voice_note(uuid, text, uuid) from public;
revoke all on function public.react_to_chat_message(uuid, text) from public;
revoke all on function public.edit_chat_message(uuid, text) from public;
revoke all on function public.delete_chat_message(uuid) from public;
revoke all on function public.pin_chat_message(uuid) from public;
revoke all on function public.unpin_chat_message(uuid) from public;
revoke all on function public.set_chat_expiry(uuid, integer) from public;
revoke all on function public.take_expired_chat_objects() from public;
revoke all on function public.ack_expired_chat_objects(text[]) from public;
revoke all on function public.cleanup_expired_chat_messages() from public;

grant execute on function public.can_write_chat_conversation(uuid) to authenticated;
grant execute on function public.send_chat_message(uuid, text, text, uuid) to authenticated;
grant execute on function public.send_chat_voice_note(uuid, text, uuid) to authenticated;
grant execute on function public.react_to_chat_message(uuid, text) to authenticated;
grant execute on function public.edit_chat_message(uuid, text) to authenticated;
grant execute on function public.delete_chat_message(uuid) to authenticated;
grant execute on function public.pin_chat_message(uuid) to authenticated;
grant execute on function public.unpin_chat_message(uuid) to authenticated;
grant execute on function public.set_chat_expiry(uuid, integer) to authenticated;
grant execute on function public.take_expired_chat_objects() to authenticated;
grant execute on function public.ack_expired_chat_objects(text[]) to authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'message_reactions',
        'conversation_chat_settings',
        'conversation_pins'
    ] loop
        if not exists (
            select 1 from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename = table_name
        ) then
            execute format('alter publication supabase_realtime add table public.%I', table_name);
        end if;
    end loop;
end;
$$;

create extension if not exists pg_cron with schema extensions;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron')
       and to_regclass('cron.job') is not null then
        perform cron.unschedule(jobid)
          from cron.job
         where jobname = 'gather-chat-expiry-cleanup';
        perform cron.schedule(
            'gather-chat-expiry-cleanup',
            '*/5 * * * *',
            'select public.cleanup_expired_chat_messages()'
        );
    else
        raise notice 'pg_cron is unavailable; enable it and schedule public.cleanup_expired_chat_messages() every 5 minutes.';
    end if;
end;
$$;
