create table public.plan_bring_items (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.plans (id) on delete cascade,
    item text not null check (length(btrim(item)) between 1 and 140),
    created_by uuid not null references public.profiles (id) on delete cascade,
    is_brought boolean not null default false,
    brought_by uuid references public.profiles (id) on delete set null,
    brought_at timestamptz,
    created_at timestamptz not null default now(),
    constraint plan_bring_items_brought_consistency check (
        (is_brought and brought_at is not null)
        or (not is_brought and brought_at is null)
    )
);

create index plan_bring_items_plan_created_idx on public.plan_bring_items (plan_id, created_at);

create table public.plan_costs (
    id uuid primary key default gen_random_uuid(),
    plan_id uuid not null references public.plans (id) on delete cascade,
    amount numeric(12, 2) not null check (amount > 0),
    currency text not null check (currency ~ '^[A-Z]{3}$'),
    note text check (note is null or length(note) <= 200),
    paid_by uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now()
);

create index plan_costs_plan_created_idx on public.plan_costs (plan_id, created_at);

alter table public.plan_bring_items enable row level security;
alter table public.plan_costs enable row level security;

revoke all on table public.plan_bring_items, public.plan_costs from public, anon, authenticated;
grant select on table public.plan_bring_items, public.plan_costs to authenticated;

create policy plan_bring_items_select_conversation_members
on public.plan_bring_items for select to authenticated
using (public.can_read_plan(plan_id));

create policy plan_costs_select_conversation_members
on public.plan_costs for select to authenticated
using (public.can_read_plan(plan_id));

create or replace function public.can_manage_plan_extras(target_plan uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
    target_conversation uuid;
begin
    if auth.uid() is null then
        return false;
    end if;

    select p.conversation_id into target_conversation
      from public.plans p
     where p.id = target_plan
       and p.status = 'active';
    return found
       and public.can_read_plan(target_plan)
       and public.can_write_chat_conversation(target_conversation);
end;
$$;

create or replace function public.add_plan_bring_item(p_plan_id uuid, p_item text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    item_id uuid;
    cleaned_item text := nullif(btrim(p_item), '');
begin
    if not public.can_manage_plan_extras(p_plan_id) then
        raise exception 'You cannot update the bring list for this plan.' using errcode = '42501';
    end if;
    if cleaned_item is null or length(cleaned_item) > 140 then
        raise exception 'Bring-list items must contain 1 to 140 characters.' using errcode = '22023';
    end if;

    insert into public.plan_bring_items (plan_id, item, created_by)
    values (p_plan_id, cleaned_item, caller)
    returning id into item_id;
    return item_id;
end;
$$;

create or replace function public.set_plan_bring_item(p_item_id uuid, p_is_brought boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_plan uuid;
    caller uuid := auth.uid();
begin
    select item.plan_id into target_plan
      from public.plan_bring_items item
     where item.id = p_item_id
     for update;
    if not found or p_is_brought is null or not public.can_manage_plan_extras(target_plan) then
        raise exception 'This bring-list item cannot be updated.' using errcode = '42501';
    end if;

    update public.plan_bring_items
       set is_brought = p_is_brought,
           brought_by = case when p_is_brought then caller else null end,
           brought_at = case when p_is_brought then now() else null end
     where id = p_item_id;
end;
$$;

create or replace function public.delete_plan_bring_item(p_item_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_plan uuid;
    target_conversation uuid;
    item_creator uuid;
    plan_creator uuid;
    caller uuid := auth.uid();
    caller_role text;
    group_conversation boolean;
begin
    select item.plan_id, item.created_by, plan.created_by, plan.conversation_id
      into target_plan, item_creator, plan_creator, target_conversation
      from public.plan_bring_items item
      join public.plans plan on plan.id = item.plan_id
     where item.id = p_item_id
       and plan.status = 'active'
     for update of item;
    if not found or not public.can_manage_plan_extras(target_plan) then
        raise exception 'This bring-list item cannot be removed.' using errcode = '42501';
    end if;

    select c.type = 'group' into group_conversation
      from public.conversations c
     where c.id = target_conversation;
    select member.role into caller_role
      from public.conversation_members member
     where member.conversation_id = target_conversation
       and member.user_id = caller
       and member.left_at is null;
    if caller <> item_creator and caller <> plan_creator
       and not (group_conversation and caller_role = 'admin') then
        raise exception 'Only the person who added this item, the plan creator, or a group admin can remove it.' using errcode = '42501';
    end if;

    delete from public.plan_bring_items where id = p_item_id;
end;
$$;

create or replace function public.add_plan_cost(
    p_plan_id uuid,
    p_amount numeric,
    p_currency text,
    p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    caller uuid := auth.uid();
    cost_id uuid;
    cleaned_note text := nullif(btrim(p_note), '');
    cleaned_currency text := upper(btrim(p_currency));
begin
    if not public.can_manage_plan_extras(p_plan_id) then
        raise exception 'You cannot add a cost to this plan.' using errcode = '42501';
    end if;
    if p_amount is null or p_amount <= 0 or p_amount > 9999999999.99
       or p_amount <> round(p_amount, 2)
       or cleaned_currency !~ '^[A-Z]{3}$'
       or (cleaned_note is not null and length(cleaned_note) > 200) then
        raise exception 'Enter a positive amount, three-letter currency code, and note no longer than 200 characters.' using errcode = '22023';
    end if;

    insert into public.plan_costs (plan_id, amount, currency, note, paid_by)
    values (p_plan_id, p_amount, cleaned_currency, cleaned_note, caller)
    returning id into cost_id;
    return cost_id;
end;
$$;

create or replace function public.delete_plan_cost(p_cost_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_plan uuid;
    target_conversation uuid;
    cost_payer uuid;
    plan_creator uuid;
    caller uuid := auth.uid();
    caller_role text;
    group_conversation boolean;
begin
    select cost.plan_id, cost.paid_by, plan.created_by, plan.conversation_id
      into target_plan, cost_payer, plan_creator, target_conversation
      from public.plan_costs cost
      join public.plans plan on plan.id = cost.plan_id
     where cost.id = p_cost_id
       and plan.status = 'active'
     for update of cost;
    if not found or not public.can_manage_plan_extras(target_plan) then
        raise exception 'This plan cost cannot be removed.' using errcode = '42501';
    end if;

    select c.type = 'group' into group_conversation
      from public.conversations c
     where c.id = target_conversation;
    select member.role into caller_role
      from public.conversation_members member
     where member.conversation_id = target_conversation
       and member.user_id = caller
       and member.left_at is null;
    if caller <> cost_payer and caller <> plan_creator
       and not (group_conversation and caller_role = 'admin') then
        raise exception 'Only the person who recorded this cost, the plan creator, or a group admin can remove it.' using errcode = '42501';
    end if;

    delete from public.plan_costs where id = p_cost_id;
end;
$$;

revoke all on function public.can_manage_plan_extras(uuid) from public;
revoke all on function public.add_plan_bring_item(uuid, text) from public;
revoke all on function public.set_plan_bring_item(uuid, boolean) from public;
revoke all on function public.delete_plan_bring_item(uuid) from public;
revoke all on function public.add_plan_cost(uuid, numeric, text, text) from public;
revoke all on function public.delete_plan_cost(uuid) from public;

grant execute on function public.can_manage_plan_extras(uuid) to authenticated;
grant execute on function public.add_plan_bring_item(uuid, text) to authenticated;
grant execute on function public.set_plan_bring_item(uuid, boolean) to authenticated;
grant execute on function public.delete_plan_bring_item(uuid) to authenticated;
grant execute on function public.add_plan_cost(uuid, numeric, text, text) to authenticated;
grant execute on function public.delete_plan_cost(uuid) to authenticated;

do $$
declare
    table_name text;
begin
    foreach table_name in array array['plan_bring_items', 'plan_costs'] loop
        if not exists (
            select 1
              from pg_publication_tables
             where pubname = 'supabase_realtime'
               and schemaname = 'public'
               and tablename = table_name
        ) then
            execute format('alter publication supabase_realtime add table public.%I', table_name);
        end if;
    end loop;
end;
$$;
