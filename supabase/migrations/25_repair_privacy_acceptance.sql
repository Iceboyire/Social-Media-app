alter table public.profiles
    add column if not exists terms_accepted_at timestamptz,
    add column if not exists privacy_policy_accepted_at timestamptz;

update public.profiles
   set privacy_policy_accepted_at = terms_accepted_at
 where privacy_policy_accepted_at is null
   and terms_accepted_at is not null;

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
    insert into public.profiles (id, name, username, privacy_policy_accepted_at)
    values (
        new.id,
        profile_name,
        requested_username,
        case
            when new.raw_user_meta_data ->> 'privacy_policy_accepted' = 'true' then now()
            else null
        end
    );
    return new;
end;
$$;
