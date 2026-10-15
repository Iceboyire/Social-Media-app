create index plans_calendar_starts_at_idx on public.plans (starts_at, conversation_id)
where status = 'active';

create or replace function public.get_unanswered_upcoming_plan_count()
returns integer
language sql
stable
security definer
set search_path = public
as $$
    select count(*)::integer
      from public.plans p
      join public.conversation_members cm
        on cm.conversation_id = p.conversation_id
       and cm.user_id = auth.uid()
       and cm.left_at is null
     where auth.uid() is not null
       and p.status = 'active'
       and p.starts_at > now()
       and not public.is_blocked_between(auth.uid(), p.created_by)
       and public.can_act_in_plan_conversation(p.conversation_id)
       and not exists (
           select 1 from public.plan_responses r
            where r.plan_id = p.id and r.user_id = auth.uid()
       );
$$;

create or replace function public.get_actionable_plan_conversations(p_conversation_ids uuid[])
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
    select distinct candidates.conversation_id
      from unnest(coalesce(p_conversation_ids, '{}'::uuid[])) as candidates(conversation_id)
     where auth.uid() is not null
       and public.can_act_in_plan_conversation(candidates.conversation_id);
$$;

revoke all on function public.get_unanswered_upcoming_plan_count() from public;
revoke all on function public.get_actionable_plan_conversations(uuid[]) from public;
grant execute on function public.get_unanswered_upcoming_plan_count() to authenticated;
grant execute on function public.get_actionable_plan_conversations(uuid[]) to authenticated;
