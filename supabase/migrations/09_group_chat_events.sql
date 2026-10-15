alter table public.messages
    add column if not exists is_system boolean not null default false;

create or replace function public.log_group_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    actor uuid := coalesce(auth.uid(), new.user_id);
    subject_name text;
    actor_name text;
    event_body text;
begin
    if not exists (
        select 1 from public.conversations c
        where c.id = new.conversation_id and c.type = 'group'
    ) then
        return new;
    end if;

    select p.name into subject_name from public.profiles p where p.id = new.user_id;
    select p.name into actor_name from public.profiles p where p.id = actor;
    subject_name := coalesce(subject_name, 'A member');
    actor_name := coalesce(actor_name, 'A member');

    if tg_op = 'INSERT' and new.left_at is null then
        event_body := subject_name || ' joined the group';
    elsif tg_op = 'UPDATE' and old.left_at is not null and new.left_at is null then
        event_body := subject_name || ' joined the group';
    elsif tg_op = 'UPDATE' and old.left_at is null and new.left_at is not null then
        if actor = new.user_id then
            event_body := subject_name || ' left the group';
        else
            event_body := subject_name || ' was removed from the group';
        end if;
    elsif tg_op = 'UPDATE' and old.role is distinct from new.role and new.role = 'admin' then
        event_body := subject_name || ' is now an admin';
    else
        return new;
    end if;

    insert into public.messages (conversation_id, sender_id, body, is_system)
    values (new.conversation_id, actor, event_body, true);
    return new;
end;
$$;

drop trigger if exists conversation_members_log_group_changes on public.conversation_members;
create trigger conversation_members_log_group_changes
after insert or update of role, left_at on public.conversation_members
for each row execute function public.log_group_membership_change();

create or replace function public.log_group_rename()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    actor uuid := auth.uid();
    actor_name text;
begin
    if new.type <> 'group' or old.name is not distinct from new.name then
        return new;
    end if;
    select p.name into actor_name from public.profiles p where p.id = actor;
    insert into public.messages (conversation_id, sender_id, body, is_system)
    values (
        new.id,
        coalesce(actor, new.created_by),
        coalesce(actor_name, 'A member') || ' renamed the group to “' || new.name || '”',
        true
    );
    return new;
end;
$$;

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.is_system then
        return new;
    end if;
    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'new_message', new.sender_id, new.id
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id <> new.sender_id
       and cm.left_at is null;
    return new;
end;
$$;

drop trigger if exists conversations_log_group_rename on public.conversations;
create trigger conversations_log_group_rename
after update of name on public.conversations
for each row execute function public.log_group_rename();

create or replace function public.leave_group(conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    caller_role text;
    successor uuid;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    perform 1 from public.conversations
     where id = conversation and type = 'group'
     for update;
    select cm.role into caller_role
      from public.conversation_members cm
     where cm.conversation_id = conversation
       and cm.user_id = caller
       and cm.left_at is null
     for update;
    if not found then
        raise exception 'Active group membership not found' using errcode = 'P0002';
    end if;

    if caller_role = 'admin'
       and not exists (
           select 1 from public.conversation_members cm
           where cm.conversation_id = conversation
             and cm.user_id <> caller
             and cm.role = 'admin'
             and cm.left_at is null
       ) then
        select cm.user_id into successor
          from public.conversation_members cm
         where cm.conversation_id = conversation
           and cm.user_id <> caller
           and cm.left_at is null
         order by cm.joined_at, cm.user_id
         limit 1
         for update;
        if successor is not null then
            update public.conversation_members
               set role = 'admin'
             where conversation_id = conversation and user_id = successor;
        end if;
    end if;

    update public.conversation_members
       set left_at = now()
     where conversation_id = conversation and user_id = caller and left_at is null;
end;
$$;

create or replace function public.set_group_photo(conversation uuid, photo_url text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_conversation uuid := conversation;
    target_photo_url text := photo_url;
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    update public.conversations c
       set photo_url = target_photo_url
     where c.id = target_conversation
       and c.type = 'group'
       and exists (
           select 1 from public.conversation_members cm
           where cm.conversation_id = c.id
             and cm.user_id = auth.uid()
             and cm.role = 'admin'
             and cm.left_at is null
       );
    if not found then
        raise exception 'Group not found or active group admin permission required' using errcode = '42501';
    end if;
end;
$$;

revoke all on function public.log_group_membership_change() from public;
revoke all on function public.log_group_rename() from public;
revoke all on function public.notify_new_message() from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.set_group_photo(uuid, text) from public;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.set_group_photo(uuid, text) to authenticated;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = 'conversations'
    ) then
        alter publication supabase_realtime add table public.conversations;
    end if;
end;
$$;
