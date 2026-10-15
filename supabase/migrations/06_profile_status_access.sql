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
          and p.status = 'active'
    );
$$;

drop policy profiles_select_permitted on public.profiles;

create policy profiles_select_permitted
on public.profiles for select to authenticated
using (
    id = auth.uid()
    or public.is_admin()
    or (
        status <> 'banned'
        and not public.is_blocked_between(auth.uid(), id)
    )
);
