create or replace function public.mark_conversation_read(conversation uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    target_conversation uuid := conversation;
begin
    if auth.uid() is null then
        raise exception 'Authentication required' using errcode = '42501';
    end if;

    update public.conversation_members
       set last_read_at = now()
     where conversation_id = target_conversation
       and user_id = auth.uid()
       and left_at is null;
    if not found then
        raise exception 'Active conversation membership not found' using errcode = 'P0002';
    end if;

    update public.notifications n
       set is_read = true
      from public.messages m
     where n.user_id = auth.uid()
       and n.type = 'new_message'
       and n.reference_id = m.id
       and m.conversation_id = target_conversation
       and not n.is_read;
end;
$$;

revoke all on function public.mark_conversation_read(uuid) from public;
grant execute on function public.mark_conversation_read(uuid) to authenticated;
