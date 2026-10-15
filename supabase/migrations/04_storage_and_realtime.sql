insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
    ('avatars', 'avatars', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('group-photos', 'group-photos', true, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif']),
    ('chat-images', 'chat-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do update
set public = excluded.public,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create policy avatars_public_read
on storage.objects for select
using (bucket_id = 'avatars');

create policy avatars_upload_own_folder
on storage.objects for insert to authenticated
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_update_own_folder
on storage.objects for update to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy avatars_delete_own_folder
on storage.objects for delete to authenticated
using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy group_photos_public_read
on storage.objects for select
using (bucket_id = 'group-photos');

create policy group_photos_upload_own_folder
on storage.objects for insert to authenticated
with check (
    bucket_id = 'group-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy group_photos_update_own_folder
on storage.objects for update to authenticated
using (
    bucket_id = 'group-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
)
with check (
    bucket_id = 'group-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy group_photos_delete_own_folder
on storage.objects for delete to authenticated
using (
    bucket_id = 'group-photos'
    and (storage.foldername(name))[1] = auth.uid()::text
);

create policy chat_images_member_read
on storage.objects for select to authenticated
using (
    bucket_id = 'chat-images'
    and public.can_access_chat_image(name)
);

create policy chat_images_upload_own_folder
on storage.objects for insert to authenticated
with check (
    bucket_id = 'chat-images'
    and public.can_upload_chat_image(name)
);

create policy chat_images_update_own_folder
on storage.objects for update to authenticated
using (
    bucket_id = 'chat-images'
    and public.can_upload_chat_image(name)
)
with check (
    bucket_id = 'chat-images'
    and public.can_upload_chat_image(name)
);

create policy chat_images_delete_own_folder
on storage.objects for delete to authenticated
using (
    bucket_id = 'chat-images'
    and split_part(name, '/', 1) = auth.uid()::text
);

do $$
declare
    table_name text;
begin
    foreach table_name in array array[
        'public.messages',
        'public.notifications',
        'public.friendships',
        'public.conversation_members'
    ] loop
        if not exists (
            select 1
            from pg_publication_tables
            where pubname = 'supabase_realtime'
              and schemaname = 'public'
              and tablename = split_part(table_name, '.', 2)
        ) then
            execute format('alter publication supabase_realtime add table %s', table_name);
        end if;
    end loop;
end;
$$;
