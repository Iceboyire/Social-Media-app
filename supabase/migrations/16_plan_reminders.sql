create table public.plan_reminders_sent (
    plan_id uuid not null references public.plans (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    kind text not null check (kind in ('24h', '1h', 'start', 'nudge')),
    sent_at timestamptz not null default now(),
    primary key (plan_id, user_id, kind)
);

alter table public.plan_reminders_sent enable row level security;
revoke all on table public.plan_reminders_sent from public, anon, authenticated;

alter table public.notifications
    drop constraint if exists notifications_type_check;
alter table public.notifications
    add constraint notifications_type_check
    check (type in (
        'friend_request', 'request_accepted', 'new_message', 'group_invite', 'admin_warning',
        'plan_created', 'plan_updated', 'plan_cancelled', 'plan_response',
        'poll_created', 'poll_closed', 'poll_vote', 'plan_reminder', 'plan_nudge'
    ));

create or replace function public.send_plan_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    reminder_count integer := 0;
    inserted_count integer := 0;
begin
    with eligible as (
        select p.id as plan_id, cm.user_id,
               case
                   when p.starts_at <= now() + interval '5 minutes' then 'start'
                   when p.starts_at <= now() + interval '1 hour' then '1h'
                   else '24h'
               end as kind
          from public.plans p
          join public.conversation_members cm
            on cm.conversation_id = p.conversation_id and cm.left_at is null
          join public.profiles pr on pr.id = cm.user_id and pr.status = 'active'
          join public.plan_responses response
            on response.plan_id = p.id and response.user_id = cm.user_id
           and response.response in ('going', 'maybe')
         where p.status = 'active'
           and p.starts_at > now()
           and p.starts_at <= now() + interval '24 hours'
           and not public.is_blocked_between(p.created_by, cm.user_id)
    ), inserted as (
        insert into public.plan_reminders_sent (plan_id, user_id, kind)
        select plan_id, user_id, kind from eligible
        on conflict (plan_id, user_id, kind) do nothing
        returning plan_id, user_id, kind
    )
    insert into public.notifications (user_id, type, actor_id, reference_id)
    select inserted.user_id, 'plan_reminder', p.created_by, inserted.plan_id
      from inserted
      join public.plans p on p.id = inserted.plan_id;
    get diagnostics inserted_count = row_count;
    reminder_count := reminder_count + inserted_count;

    with eligible as (
        select p.id as plan_id, cm.user_id
          from public.plans p
          join public.conversation_members cm
            on cm.conversation_id = p.conversation_id and cm.left_at is null
          join public.profiles pr on pr.id = cm.user_id and pr.status = 'active'
         where p.status = 'active'
           and p.starts_at > now()
           and p.starts_at <= now() + interval '24 hours'
           and cm.user_id <> p.created_by
           and not public.is_blocked_between(p.created_by, cm.user_id)
           and not exists (
               select 1 from public.plan_responses r
                where r.plan_id = p.id and r.user_id = cm.user_id
           )
    ), inserted as (
        insert into public.plan_reminders_sent (plan_id, user_id, kind)
        select plan_id, user_id, 'nudge' from eligible
        on conflict (plan_id, user_id, kind)
        do update set sent_at = now()
         where public.plan_reminders_sent.sent_at <= now() - interval '24 hours'
        returning plan_id, user_id
    )
    insert into public.notifications (user_id, type, actor_id, reference_id)
    select inserted.user_id, 'plan_nudge', p.created_by, inserted.plan_id
      from inserted
      join public.plans p on p.id = inserted.plan_id;
    get diagnostics inserted_count = row_count;
    reminder_count := reminder_count + inserted_count;

    return reminder_count;
end;
$$;

create or replace function public.nudge_unconfirmed(p_plan_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    target public.plans%rowtype;
    nudged_count integer := 0;
begin
    if caller is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;
    select * into target from public.plans where id = p_plan_id for update;
    if not found then
        raise exception 'Plan not found' using errcode = 'P0002';
    end if;
    if target.created_by <> caller
       or target.status <> 'active'
       or target.starts_at <= now()
       or not public.can_act_in_plan_conversation(target.conversation_id) then
        raise exception 'Only the creator of an upcoming active plan can nudge members' using errcode = '42501';
    end if;

    with recipients as (
        select cm.user_id
          from public.conversation_members cm
          join public.profiles p on p.id = cm.user_id and p.status = 'active'
         where cm.conversation_id = target.conversation_id
           and cm.left_at is null
           and cm.user_id <> caller
           and not public.is_blocked_between(caller, cm.user_id)
           and not exists (
               select 1 from public.plan_responses r
                where r.plan_id = p_plan_id and r.user_id = cm.user_id
           )
    ), allowed as (
        insert into public.plan_reminders_sent (plan_id, user_id, kind)
        select p_plan_id, user_id, 'nudge' from recipients
        on conflict (plan_id, user_id, kind)
        do update set sent_at = now()
         where public.plan_reminders_sent.sent_at <= now() - interval '24 hours'
        returning user_id
    ), notified as (
        insert into public.notifications (user_id, type, actor_id, reference_id)
        select user_id, 'plan_nudge', caller, p_plan_id from allowed
        returning user_id
    )
    select count(*)::integer into nudged_count from notified;

    if nudged_count = 0 then
        raise exception 'There are no unconfirmed members to nudge, or they were nudged within the last 24 hours' using errcode = '22023';
    end if;
    return nudged_count;
end;
$$;

create or replace function public.run_gather_planning_automation()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    perform public.send_plan_reminders();
    perform public.close_expired_time_polls();
end;
$$;

revoke all on function public.send_plan_reminders() from public, anon, authenticated;
revoke all on function public.nudge_unconfirmed(uuid) from public;
revoke all on function public.run_gather_planning_automation() from public, anon, authenticated;
grant execute on function public.nudge_unconfirmed(uuid) to authenticated;
grant execute on function public.send_plan_reminders() to service_role;
grant execute on function public.run_gather_planning_automation() to service_role;

create extension if not exists pg_cron with schema pg_catalog;

do $$
begin
    if not exists (
        select 1 from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'plan_reminders_sent'
    ) then
        alter publication supabase_realtime add table public.plan_reminders_sent;
    end if;
end;
$$;

do $$
begin
    if exists (select 1 from pg_extension where extname = 'pg_cron')
       and to_regclass('cron.job') is not null then
        perform cron.unschedule(jobid) from cron.job where jobname = 'gather-planning-automation';
        perform cron.schedule(
            'gather-planning-automation',
            '*/5 * * * *',
            'select public.run_gather_planning_automation();'
        );
    else
        raise notice 'pg_cron is unavailable; enable the pg_cron extension and schedule public.run_gather_planning_automation() every 5 minutes.';
    end if;
end;
$$;
