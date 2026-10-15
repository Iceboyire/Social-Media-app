alter table public.notifications
    drop constraint if exists notifications_type_check;

alter table public.notifications
    add constraint notifications_type_check
    check (type in ('friend_request', 'request_accepted', 'new_message', 'group_invite', 'admin_warning'));

drop function if exists public.admin_dashboard_stats();
create function public.admin_dashboard_stats()
returns table (
    total_users bigint,
    active_users bigint,
    suspended_users bigint,
    banned_users bigint,
    total_messages bigint,
    total_groups bigint,
    open_reports bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    return query
    select count(*)::bigint,
           count(*) filter (
               where p.status = 'active'
                 and p.last_seen >= now() - interval '30 days'
           )::bigint,
           count(*) filter (where p.status = 'suspended')::bigint,
           count(*) filter (where p.status = 'banned')::bigint,
           (select count(*)::bigint from public.messages where not is_system),
           (select count(*)::bigint from public.conversations where type = 'group'),
           (select count(*)::bigint from public.reports where status = 'open')
      from public.profiles p;
end;
$$;

drop function if exists public.admin_signups_by_day(integer);
create function public.admin_signups_by_day(days integer)
returns table (
    signup_day date,
    signups bigint,
    messages_sent bigint,
    groups_created bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    if days is null or days < 1 or days > 365 then
        raise exception 'Days must be between 1 and 365' using errcode = '22023';
    end if;
    return query
    select calendar.day::date,
           (select count(*)::bigint from public.profiles p
             where p.created_at >= calendar.day
               and p.created_at < calendar.day + interval '1 day'),
           (select count(*)::bigint from public.messages m
             where not m.is_system
               and m.created_at >= calendar.day
               and m.created_at < calendar.day + interval '1 day'),
           (select count(*)::bigint from public.conversations c
             where c.type = 'group'
               and c.created_at >= calendar.day
               and c.created_at < calendar.day + interval '1 day')
      from generate_series(current_date - (days - 1), current_date, interval '1 day') calendar(day)
     order by calendar.day;
end;
$$;

create or replace function public.admin_set_user_status("user" uuid, status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_user uuid := "user";
    target_status text := status;
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    if target_status is null or target_status not in ('active', 'suspended', 'banned') then
        raise exception 'Invalid account status' using errcode = '22023';
    end if;
    if target_user = auth.uid() and target_status <> 'active' then
        raise exception 'You cannot suspend or ban your own admin account' using errcode = '42501';
    end if;
    update public.profiles set status = target_status where id = target_user;
    if not found then
        raise exception 'Profile not found' using errcode = 'P0002';
    end if;
end;
$$;

create or replace function public.admin_resolve_report(report_id uuid, resolution_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_report public.reports%rowtype;
    action_name text := resolution_action;
begin
    if not public.is_admin() then
        raise exception 'Admin permission required' using errcode = '42501';
    end if;
    if action_name is null or action_name not in ('dismiss', 'warn', 'suspend', 'ban') then
        raise exception 'Invalid report action' using errcode = '22023';
    end if;

    select r.* into target_report
      from public.reports r
     where r.id = report_id
       and r.status = 'open'
     for update;
    if not found then
        raise exception 'Open report not found' using errcode = 'P0002';
    end if;

    if action_name = 'warn' then
        insert into public.notifications (user_id, type, actor_id, reference_id)
        values (target_report.reported_user_id, 'admin_warning', auth.uid(), target_report.id);
    elsif action_name = 'suspend' then
        perform public.admin_set_user_status(target_report.reported_user_id, 'suspended');
    elsif action_name = 'ban' then
        perform public.admin_set_user_status(target_report.reported_user_id, 'banned');
    end if;

    update public.reports
       set status = 'resolved',
           resolved_by = auth.uid()
     where id = target_report.id;
end;
$$;

create policy messages_select_admin
on public.messages for select to authenticated
using (public.is_admin());

revoke all on function public.admin_set_user_status(uuid, text) from public;
revoke all on function public.admin_dashboard_stats() from public;
revoke all on function public.admin_signups_by_day(integer) from public;
revoke all on function public.admin_resolve_report(uuid, text) from public;

grant execute on function public.admin_set_user_status(uuid, text) to authenticated;
grant execute on function public.admin_dashboard_stats() to authenticated;
grant execute on function public.admin_signups_by_day(integer) to authenticated;
grant execute on function public.admin_resolve_report(uuid, text) to authenticated;
