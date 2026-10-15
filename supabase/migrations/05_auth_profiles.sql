alter table public.profiles
    add column if not exists onboarding_completed boolean not null default false;

do $$
begin
    if not exists (
        select 1
        from pg_constraint
        where conrelid = 'public.profiles'::regclass
          and conname = 'profiles_username_format'
    ) then
        alter table public.profiles
            add constraint profiles_username_format
            check (username ~ '^[a-z0-9_]{3,24}$');
    end if;
end;
$$;

grant update (onboarding_completed) on public.profiles to authenticated;

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
        nullif(lower(btrim(new.raw_user_meta_data ->> 'username')), ''),
        'u_' || substr(replace(new.id::text, '-', ''), 1, 22)
    );
    insert into public.profiles (id, name, username)
    values (new.id, profile_name, requested_username);
    return new;
end;
$$;

create or replace function public.username_available(p_username text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
    select p_username is not null
       and p_username = lower(btrim(p_username))
       and p_username ~ '^[a-z0-9_]{3,24}$'
       and not exists (
           select 1
           from public.profiles p
           where lower(p.username) = p_username
       );
$$;

revoke all on function public.username_available(text) from public;
grant execute on function public.username_available(text) to anon, authenticated;
