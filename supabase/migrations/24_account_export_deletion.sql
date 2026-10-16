create or replace function public.export_own_account_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    exported jsonb;
begin
    if caller is null or not exists (
        select 1 from public.profiles p where p.id = caller
    ) then
        raise exception 'Authentication required.' using errcode = '42501';
    end if;

    select jsonb_build_object(
        'exported_at', now(),
        'account', jsonb_build_object('email', u.email, 'created_at', u.created_at),
        'profile', (
            select to_jsonb(p) - 'role' - 'status' - 'last_seen'
              from public.profiles p where p.id = caller
        ),
        'friendships', coalesce((
            select jsonb_agg(to_jsonb(f) order by f.created_at)
              from public.friendships f
             where f.requester_id = caller or f.addressee_id = caller
        ), '[]'::jsonb),
        'blocks', coalesce((
            select jsonb_agg(to_jsonb(b) order by b.created_at)
              from public.blocks b where b.blocker_id = caller
        ), '[]'::jsonb),
        'conversation_memberships', coalesce((
            select jsonb_agg(jsonb_build_object(
                'conversation_id', cm.conversation_id,
                'role', cm.role,
                'joined_at', cm.joined_at,
                'left_at', cm.left_at,
                'last_read_at', cm.last_read_at,
                'conversation_type', c.type,
                'conversation_name', c.name,
                'conversation_photo_url', c.photo_url,
                'conversation_created_at', c.created_at
            ) order by cm.joined_at)
              from public.conversation_members cm
              join public.conversations c on c.id = cm.conversation_id
             where cm.user_id = caller
        ), '[]'::jsonb),
        'messages_sent', coalesce((
            select jsonb_agg(to_jsonb(m) order by m.created_at)
              from public.messages m where m.sender_id = caller
        ), '[]'::jsonb),
        'reactions', coalesce((
            select jsonb_agg(to_jsonb(r) order by r.created_at)
              from public.message_reactions r where r.user_id = caller
        ), '[]'::jsonb),
        'notifications', coalesce((
            select jsonb_agg(to_jsonb(n) order by n.created_at)
              from public.notifications n where n.user_id = caller
        ), '[]'::jsonb),
        'availability', (
            select to_jsonb(a) from public.availability a where a.user_id = caller
        ),
        'circles', coalesce((
            select jsonb_agg(jsonb_build_object(
                'circle', to_jsonb(c),
                'members', coalesce((
                    select jsonb_agg(cm.friend_id order by cm.friend_id)
                      from public.circle_members cm where cm.circle_id = c.id
                ), '[]'::jsonb)
            ) order by c.created_at)
              from public.circles c where c.owner_id = caller
        ), '[]'::jsonb),
        'circles_shared_with_me', coalesce((
            select jsonb_agg(jsonb_build_object(
                'circle', to_jsonb(c),
                'owner_name', p.name,
                'owner_username', p.username
            ) order by c.created_at)
              from public.circle_members cm
              join public.circles c on c.id = cm.circle_id
              join public.profiles p on p.id = c.owner_id
             where cm.friend_id = caller
        ), '[]'::jsonb),
        'plans', coalesce((
            select jsonb_agg(to_jsonb(p) order by p.created_at)
              from public.plans p
             where p.created_by = caller
                or exists (
                    select 1 from public.plan_responses r
                     where r.plan_id = p.id and r.user_id = caller
                )
                or exists (
                    select 1 from public.conversation_members cm
                     where cm.conversation_id = p.conversation_id and cm.user_id = caller
                )
        ), '[]'::jsonb),
        'plan_responses', coalesce((
            select jsonb_agg(to_jsonb(r) order by r.updated_at)
              from public.plan_responses r where r.user_id = caller
        ), '[]'::jsonb),
        'plan_bring_items', coalesce((
            select jsonb_agg(to_jsonb(item) order by item.created_at)
              from public.plan_bring_items item
              join public.plans p on p.id = item.plan_id
             where item.created_by = caller
                or item.brought_by = caller
                or exists (
                    select 1 from public.conversation_members cm
                     where cm.conversation_id = p.conversation_id and cm.user_id = caller
                )
        ), '[]'::jsonb),
        'plan_costs', coalesce((
            select jsonb_agg(to_jsonb(cost) order by cost.created_at)
              from public.plan_costs cost
              join public.plans p on p.id = cost.plan_id
             where cost.paid_by = caller
                or exists (
                    select 1 from public.conversation_members cm
                     where cm.conversation_id = p.conversation_id and cm.user_id = caller
                )
        ), '[]'::jsonb),
        'polls_created', coalesce((
            select jsonb_agg(to_jsonb(poll) order by poll.created_at)
              from public.time_polls poll where poll.created_by = caller
        ), '[]'::jsonb),
        'polls_in_conversations', coalesce((
            select jsonb_agg(to_jsonb(poll) order by poll.created_at)
              from public.time_polls poll
             where exists (
                 select 1 from public.conversation_members cm
                  where cm.conversation_id = poll.conversation_id
                    and cm.user_id = caller
             )
        ), '[]'::jsonb),
        'poll_options', coalesce((
            select jsonb_agg(to_jsonb(poll_option) order by poll_option.starts_at)
              from public.poll_options poll_option
             where exists (
                 select 1 from public.time_polls poll
                  where poll.id = poll_option.poll_id
                    and (
                        poll.created_by = caller
                        or exists (
                            select 1 from public.conversation_members cm
                             where cm.conversation_id = poll.conversation_id and cm.user_id = caller
                        )
                    )
             )
        ), '[]'::jsonb),
        'poll_votes', coalesce((
            select jsonb_agg(to_jsonb(vote) order by vote.updated_at)
              from public.poll_votes vote where vote.user_id = caller
        ), '[]'::jsonb),
        'saved_memories', coalesce((
            select jsonb_agg(to_jsonb(memory) order by memory.created_at)
              from public.chat_memories memory where memory.user_id = caller
        ), '[]'::jsonb),
        'live_locations_shared', coalesce((
            select jsonb_agg(to_jsonb(location) order by location.updated_at)
              from public.live_locations location where location.user_id = caller
        ), '[]'::jsonb),
        'storage_objects_owned', coalesce((
            select jsonb_agg(jsonb_build_object(
                'bucket_id', o.bucket_id,
                'name', o.name
            ) order by o.bucket_id, o.name)
              from storage.objects o
             where o.bucket_id in ('avatars', 'group-photos', 'chat-images', 'chat-voice-notes')
               and split_part(o.name, '/', 1) = caller::text
        ), '[]'::jsonb),
        'conversation_messages', coalesce((
            select jsonb_agg(to_jsonb(m) order by m.created_at)
              from public.messages m
             where exists (
                 select 1 from public.conversation_members cm
                  where cm.conversation_id = m.conversation_id
                    and cm.user_id = caller
             )
        ), '[]'::jsonb),
        'reports_submitted', coalesce((
            select jsonb_agg(to_jsonb(report) order by report.created_at)
              from public.reports report where report.reporter_id = caller
        ), '[]'::jsonb)
    )
      into exported
      from auth.users u
     where u.id = caller;

    if exported is null then
        raise exception 'Account data could not be exported.' using errcode = 'P0002';
    end if;
    return exported;
end;
$$;

create or replace function public.list_own_storage_objects()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    objects jsonb;
begin
    if caller is null then
        raise exception 'Authentication required.' using errcode = '42501';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
        'bucket_id', o.bucket_id,
        'name', o.name
    ) order by o.bucket_id, o.name), '[]'::jsonb)
      into objects
      from storage.objects o
     where o.bucket_id in ('avatars', 'group-photos', 'chat-images', 'chat-voice-notes')
       and split_part(o.name, '/', 1) = caller::text;
    return objects;
end;
$$;

create or replace function public.delete_own_account()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
begin
    if caller is null then
        raise exception 'Authentication required.' using errcode = '42501';
    end if;
    if exists (
        select 1
          from storage.objects o
         where o.bucket_id in ('avatars', 'group-photos', 'chat-images', 'chat-voice-notes')
           and split_part(o.name, '/', 1) = caller::text
    ) then
        raise exception 'Remove account-owned storage files before deleting the account.' using errcode = '55000';
    end if;
    delete from auth.users where id = caller;
    if not found then
        raise exception 'Account not found.' using errcode = 'P0002';
    end if;
end;
$$;

revoke all on function public.export_own_account_data() from public, anon;
revoke all on function public.list_own_storage_objects() from public, anon;
revoke all on function public.delete_own_account() from public, anon;
grant execute on function public.export_own_account_data() to authenticated;
grant execute on function public.list_own_storage_objects() to authenticated;
grant execute on function public.delete_own_account() to authenticated;
