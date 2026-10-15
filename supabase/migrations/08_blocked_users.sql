create or replace function public.list_blocked_users()
returns table (
    id uuid,
    name text,
    username text,
    photo_url text
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

    return query
    select p.id, p.name, p.username, p.photo_url
      from public.blocks b
      join public.profiles p on p.id = b.blocked_id
     where b.blocker_id = auth.uid()
     order by p.name, p.username;
end;
$$;

revoke all on function public.list_blocked_users() from public;
grant execute on function public.list_blocked_users() to authenticated;
