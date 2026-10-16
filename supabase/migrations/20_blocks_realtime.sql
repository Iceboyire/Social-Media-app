do $$
begin
    if not exists (
        select 1
          from pg_publication_tables
         where pubname = 'supabase_realtime'
           and schemaname = 'public'
           and tablename = 'blocks'
    ) then
        alter publication supabase_realtime add table public.blocks;
    end if;
end;
$$;

drop policy if exists messages_insert_active_member on public.messages;
create policy messages_insert_active_member
on public.messages for insert to authenticated
with check (
    sender_id = auth.uid()
    and message_type in ('text', 'image')
    and plan_id is null
    and poll_id is null
    and exists (
        select 1 from public.profiles p
        where p.id = auth.uid() and p.status = 'active'
    )
    and exists (
        select 1
          from public.conversations c
          join public.conversation_members own
            on own.conversation_id = c.id
           and own.user_id = auth.uid()
           and own.left_at is null
         where c.id = messages.conversation_id
           and (
               (
                   c.type = 'direct'
                   and exists (
                       select 1 from public.conversation_members other
                       where other.conversation_id = c.id
                         and other.user_id <> auth.uid()
                         and other.left_at is null
                         and public.are_friends(auth.uid(), other.user_id)
                         and not public.is_blocked_between(auth.uid(), other.user_id)
                   )
               )
               or (
                   c.type = 'group'
                   and not exists (
                       select 1 from public.conversation_members other
                       where other.conversation_id = c.id
                         and other.user_id <> auth.uid()
                         and other.left_at is null
                         and public.is_blocked_between(auth.uid(), other.user_id)
                   )
               )
           )
    )
);
