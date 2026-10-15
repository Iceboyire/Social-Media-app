create or replace function public.set_friendship_updated_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    new.updated_at := now();
    return new;
end;
$$;

create trigger friendships_set_updated_at
before update on public.friendships
for each row execute function public.set_friendship_updated_at();

create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
    requested_username text;
    profile_name text;
begin
    profile_name := coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'name'), ''),
        nullif(btrim(new.raw_user_meta_data ->> 'full_name'), ''),
        nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
        'New user'
    );
    requested_username := coalesce(
        nullif(btrim(new.raw_user_meta_data ->> 'username'), ''),
        'user_' || replace(new.id::text, '-', '')
    );
    insert into public.profiles (id, name, username)
    values (new.id, profile_name, requested_username);
    return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.notify_friendship_changes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.status = 'pending'
       and (tg_op = 'INSERT' or old.status is distinct from 'pending') then
        insert into public.notifications (user_id, type, actor_id, reference_id)
        values (new.addressee_id, 'friend_request', new.requester_id, new.id);
    elsif new.status = 'accepted'
       and tg_op = 'UPDATE'
       and old.status is distinct from 'accepted' then
        insert into public.notifications (user_id, type, actor_id, reference_id)
        values (new.requester_id, 'request_accepted', new.addressee_id, new.id);
    end if;
    return new;
end;
$$;

create trigger friendships_notify_changes
after insert or update of status on public.friendships
for each row execute function public.notify_friendship_changes();

create or replace function public.notify_new_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.notifications (user_id, type, actor_id, reference_id)
    select cm.user_id, 'new_message', new.sender_id, new.id
      from public.conversation_members cm
     where cm.conversation_id = new.conversation_id
       and cm.user_id <> new.sender_id
       and cm.left_at is null;
    return new;
end;
$$;

create trigger messages_notify_members
after insert on public.messages
for each row execute function public.notify_new_message();

create or replace function public.notify_group_member_added()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    if new.left_at is null
       and (tg_op = 'INSERT' or old.left_at is not null)
       and new.user_id is distinct from auth.uid()
       and exists (
           select 1 from public.conversations c
           where c.id = new.conversation_id and c.type = 'group'
       ) then
        insert into public.notifications (user_id, type, actor_id, reference_id)
        values (new.user_id, 'group_invite', auth.uid(), new.conversation_id);
    end if;
    return new;
end;
$$;

create trigger conversation_members_notify_added
after insert or update of left_at on public.conversation_members
for each row execute function public.notify_group_member_added();

alter table public.profiles enable row level security;
alter table public.friendships enable row level security;
alter table public.blocks enable row level security;
alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;
alter table public.notifications enable row level security;
alter table public.reports enable row level security;

create policy profiles_select_permitted
on public.profiles for select to authenticated
using (
    public.is_admin()
    or (
        status <> 'banned'
        and not public.is_blocked_between(auth.uid(), id)
    )
);

create policy profiles_update_own
on public.profiles for update to authenticated
using (id = auth.uid())
with check (id = auth.uid());

create policy friendships_select_participant
on public.friendships for select to authenticated
using (
    (requester_id = auth.uid() or addressee_id = auth.uid())
    and not public.is_blocked_between(requester_id, addressee_id)
);

create policy blocks_select_participant
on public.blocks for select to authenticated
using (blocker_id = auth.uid() or blocked_id = auth.uid());

create policy conversations_select_member
on public.conversations for select to authenticated
using (
    exists (
        select 1
        where public.is_conversation_member(conversations.id, false)
    )
);

create policy conversation_members_select_conversation
on public.conversation_members for select to authenticated
using (
    public.is_conversation_member(conversation_members.conversation_id, false)
);

create policy messages_select_member_history
on public.messages for select to authenticated
using (
    public.is_conversation_member(messages.conversation_id, false)
);

create policy messages_insert_active_member
on public.messages for insert to authenticated
with check (
    sender_id = auth.uid()
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
                   )
               )
           )
    )
);

create policy notifications_select_own
on public.notifications for select to authenticated
using (user_id = auth.uid());

create policy notifications_update_own
on public.notifications for update to authenticated
using (user_id = auth.uid())
with check (user_id = auth.uid());

create policy reports_insert_own
on public.reports for insert to authenticated
with check (
    reporter_id = auth.uid()
    and reported_user_id <> auth.uid()
    and status = 'open'
    and resolved_by is null
    and (
        message_id is null
        or exists (
            select 1 from public.messages m
            where m.id = reports.message_id
              and m.sender_id = reports.reported_user_id
        )
    )
);

create policy reports_select_admin
on public.reports for select to authenticated
using (public.is_admin());

create policy reports_update_admin
on public.reports for update to authenticated
using (public.is_admin())
with check (public.is_admin());

revoke all on table public.profiles, public.friendships, public.blocks,
    public.conversations, public.conversation_members, public.messages,
    public.notifications, public.reports from public, anon, authenticated;

grant select on public.profiles, public.friendships, public.blocks,
    public.conversations, public.conversation_members, public.messages,
    public.notifications to authenticated;
grant update (name, username, bio, location, photo_url, last_seen)
    on public.profiles to authenticated;
grant insert (conversation_id, sender_id, body, image_url)
    on public.messages to authenticated;
grant update (is_read) on public.notifications to authenticated;
grant insert (reporter_id, reported_user_id, message_id, reason, note)
    on public.reports to authenticated;
grant select on public.reports to authenticated;
grant update (status, resolved_by) on public.reports to authenticated;

revoke all on function public.is_admin() from public;
revoke all on function public.are_friends(uuid, uuid) from public;
revoke all on function public.is_blocked_between(uuid, uuid) from public;
revoke all on function public.is_conversation_member(uuid, boolean) from public;
revoke all on function public.send_friend_request(uuid) from public;
revoke all on function public.cancel_friend_request(uuid) from public;
revoke all on function public.respond_friend_request(uuid, boolean) from public;
revoke all on function public.unfriend(uuid) from public;
revoke all on function public.block_user(uuid) from public;
revoke all on function public.unblock_user(uuid) from public;
revoke all on function public.get_or_create_direct_conversation(uuid) from public;
revoke all on function public.create_group(text, text, uuid[]) from public;
revoke all on function public.add_group_member(uuid, uuid) from public;
revoke all on function public.remove_group_member(uuid, uuid) from public;
revoke all on function public.rename_group(uuid, text) from public;
revoke all on function public.make_group_admin(uuid, uuid) from public;
revoke all on function public.leave_group(uuid) from public;
revoke all on function public.search_users(text) from public;
revoke all on function public.mark_conversation_read(uuid) from public;
revoke all on function public.admin_set_user_status(uuid, text) from public;
revoke all on function public.admin_dashboard_stats() from public;
revoke all on function public.admin_signups_by_day(integer) from public;
revoke all on function public.can_access_chat_image(text) from public;
revoke all on function public.can_upload_chat_image(text) from public;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.are_friends(uuid, uuid) to authenticated;
grant execute on function public.is_blocked_between(uuid, uuid) to authenticated;
grant execute on function public.is_conversation_member(uuid, boolean) to authenticated;
grant execute on function public.send_friend_request(uuid) to authenticated;
grant execute on function public.cancel_friend_request(uuid) to authenticated;
grant execute on function public.respond_friend_request(uuid, boolean) to authenticated;
grant execute on function public.unfriend(uuid) to authenticated;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;
grant execute on function public.get_or_create_direct_conversation(uuid) to authenticated;
grant execute on function public.create_group(text, text, uuid[]) to authenticated;
grant execute on function public.add_group_member(uuid, uuid) to authenticated;
grant execute on function public.remove_group_member(uuid, uuid) to authenticated;
grant execute on function public.rename_group(uuid, text) to authenticated;
grant execute on function public.make_group_admin(uuid, uuid) to authenticated;
grant execute on function public.leave_group(uuid) to authenticated;
grant execute on function public.search_users(text) to authenticated;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_signups_by_day(integer) to authenticated;
grant execute on function public.can_access_chat_image(text) to authenticated;
grant execute on function public.can_upload_chat_image(text) to authenticated;

revoke all on function public.set_friendship_updated_at() from public;
revoke all on function public.create_profile_for_new_user() from public;
revoke all on function public.notify_friendship_changes() from public;
revoke all on function public.notify_new_message() from public;
revoke all on function public.notify_group_member_added() from public;
