create or replace function public.get_profile_connections(target uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    result jsonb;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    if target is null or not exists (
        select 1 from public.profiles p
        where p.id = target and p.status = 'active'
    ) then
        raise exception 'Profile is unavailable' using errcode = '22023';
    end if;

    if public.is_blocked_between(caller, target) then
        return jsonb_build_object('friends_count', 0, 'mutual_friends', '[]'::jsonb);
    end if;

    select jsonb_build_object(
        'friends_count', count(*)::integer,
        'mutual_friends', coalesce(
            jsonb_agg(
                jsonb_build_object(
                    'id', friend.id,
                    'name', friend.name,
                    'username', friend.username,
                    'photo_url', friend.photo_url
                )
                order by friend.name, friend.username
            ) filter (where public.are_friends(caller, friend.id)),
            '[]'::jsonb
        )
    )
    into result
    from public.friendships f
    cross join lateral (
        select case when f.requester_id = target then f.addressee_id else f.requester_id end as friend_id
    ) connection
    join public.profiles friend on friend.id = connection.friend_id and friend.status = 'active'
    where f.status = 'accepted'
      and (f.requester_id = target or f.addressee_id = target)
      and not public.is_blocked_between(target, friend.id);

    return coalesce(result, jsonb_build_object('friends_count', 0, 'mutual_friends', '[]'::jsonb));
end;
$$;

revoke all on function public.get_profile_connections(uuid) from public;
grant execute on function public.get_profile_connections(uuid) to authenticated;
