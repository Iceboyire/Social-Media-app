create table public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    name text not null,
    username text not null,
    bio text,
    location text,
    photo_url text,
    role text not null default 'user' check (role in ('user', 'admin')),
    status text not null default 'active' check (status in ('active', 'suspended', 'banned')),
    last_seen timestamptz,
    created_at timestamptz not null default now()
);

create unique index profiles_username_lower_uidx on public.profiles (lower(username));

create table public.friendships (
    id uuid primary key default gen_random_uuid(),
    requester_id uuid not null references public.profiles (id) on delete cascade,
    addressee_id uuid not null references public.profiles (id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    constraint friendships_distinct_users check (requester_id <> addressee_id)
);

create unique index friendships_unordered_pair_uidx
    on public.friendships (least(requester_id, addressee_id), greatest(requester_id, addressee_id));
create index friendships_requester_id_idx on public.friendships (requester_id);
create index friendships_addressee_id_idx on public.friendships (addressee_id);

create table public.blocks (
    blocker_id uuid not null references public.profiles (id) on delete cascade,
    blocked_id uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id),
    constraint blocks_distinct_users check (blocker_id <> blocked_id)
);

create index blocks_blocked_id_idx on public.blocks (blocked_id);

create table public.conversations (
    id uuid primary key default gen_random_uuid(),
    type text not null check (type in ('direct', 'group')),
    name text,
    photo_url text,
    created_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint conversations_group_name check (
        (type = 'direct' and name is null) or
        (type = 'group' and name is not null and length(btrim(name)) > 0)
    )
);

create index conversations_created_by_idx on public.conversations (created_by);

create table public.conversation_members (
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    user_id uuid not null references public.profiles (id) on delete cascade,
    role text not null default 'member' check (role in ('member', 'admin')),
    joined_at timestamptz not null default now(),
    left_at timestamptz,
    last_read_at timestamptz,
    primary key (conversation_id, user_id)
);

create index conversation_members_user_id_idx on public.conversation_members (user_id);

create table public.messages (
    id uuid primary key default gen_random_uuid(),
    conversation_id uuid not null references public.conversations (id) on delete cascade,
    sender_id uuid not null references public.profiles (id) on delete cascade,
    body text,
    image_url text,
    created_at timestamptz not null default now(),
    constraint messages_have_content check (
        nullif(btrim(body), '') is not null or nullif(btrim(image_url), '') is not null
    )
);

create index messages_conversation_created_at_idx
    on public.messages (conversation_id, created_at desc);
create index messages_sender_id_idx on public.messages (sender_id);

create table public.notifications (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references public.profiles (id) on delete cascade,
    type text not null check (type in ('friend_request', 'request_accepted', 'new_message', 'group_invite')),
    actor_id uuid references public.profiles (id) on delete set null,
    reference_id uuid,
    is_read boolean not null default false,
    created_at timestamptz not null default now()
);

create index notifications_user_id_created_at_idx
    on public.notifications (user_id, created_at desc);
create index notifications_actor_id_idx on public.notifications (actor_id);

create table public.reports (
    id uuid primary key default gen_random_uuid(),
    reporter_id uuid not null references public.profiles (id) on delete cascade,
    reported_user_id uuid not null references public.profiles (id) on delete cascade,
    message_id uuid references public.messages (id) on delete set null,
    reason text not null,
    note text,
    status text not null default 'open' check (status in ('open', 'resolved')),
    resolved_by uuid references public.profiles (id) on delete set null,
    created_at timestamptz not null default now(),
    constraint reports_distinct_users check (reporter_id <> reported_user_id),
    constraint reports_reason_not_empty check (length(btrim(reason)) > 0)
);

create index reports_reporter_id_idx on public.reports (reporter_id);
create index reports_reported_user_id_idx on public.reports (reported_user_id);
create index reports_message_id_idx on public.reports (message_id);
create index reports_resolved_by_idx on public.reports (resolved_by);
create index reports_status_created_at_idx on public.reports (status, created_at desc);
