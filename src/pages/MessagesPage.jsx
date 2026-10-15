import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { MessageCircle, Plus, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { useFriendshipRealtime } from '../hooks/useFriendshipRealtime';
import { NewGroupModal } from '../components/GroupChatControls';
import { Button } from '../components/ui/Button';

async function fetchConversations(userId) {
  const { data: memberships, error: membershipError } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', userId)
    .is('left_at', null);
  if (membershipError) throw membershipError;
  if (!memberships?.length) return [];

  const conversationIds = memberships.map((item) => item.conversation_id);
  const [{ data: conversations, error: conversationError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from('conversations').select('id, type, name, photo_url, created_at').in('id', conversationIds),
    supabase.from('conversation_members').select('conversation_id, user_id').in('conversation_id', conversationIds).neq('user_id', userId).is('left_at', null),
  ]);
  for (const result of [{ error: conversationError }, { error: membersError }]) {
    if (result.error) throw result.error;
  }

  const otherIds = [...new Set((members ?? []).map((item) => item.user_id))];
  const profilesResponse = otherIds.length
    ? await supabase.from('profiles').select('id, name, username, photo_url, last_seen').in('id', otherIds)
    : { data: [], error: null };
  if (profilesResponse.error) throw profilesResponse.error;
  const byId = new Map((profilesResponse.data ?? []).map((profile) => [profile.id, profile]));
  const lastReadById = new Map(memberships.map((item) => [item.conversation_id, item.last_read_at]));
  const conversationById = new Map((conversations ?? []).map((item) => [item.id, item]));
  const otherByConversation = new Map();
  for (const member of members ?? []) {
    if (!otherByConversation.has(member.conversation_id)) otherByConversation.set(member.conversation_id, []);
    otherByConversation.get(member.conversation_id).push(byId.get(member.user_id));
  }
  const latestAndUnread = await Promise.all(memberships.map(async (membership) => {
    const latestQuery = supabase.from('messages')
      .select('id, conversation_id, sender_id, body, image_url, created_at')
      .eq('conversation_id', membership.conversation_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    let unreadQuery = supabase.from('messages')
      .select('id', { count: 'exact', head: true })
      .eq('conversation_id', membership.conversation_id)
      .neq('sender_id', userId);
    if (membership.last_read_at) unreadQuery = unreadQuery.gt('created_at', membership.last_read_at);
    const [{ data: latest, error: latestError }, { count, error: unreadError }] = await Promise.all([latestQuery, unreadQuery]);
    if (latestError) throw latestError;
    if (unreadError) throw unreadError;
    return { conversationId: membership.conversation_id, latest, unreadCount: count ?? 0 };
  }));
  const latestByConversation = new Map(latestAndUnread.map(({ conversationId, latest }) => [conversationId, latest]));
  const unreadByConversation = new Map(latestAndUnread.map(({ conversationId, unreadCount }) => [conversationId, unreadCount]));

  return conversationIds.map((id) => ({
    ...conversationById.get(id),
    otherProfiles: (otherByConversation.get(id) ?? []).filter(Boolean),
    latestMessage: latestByConversation.get(id),
    lastReadAt: lastReadById.get(id),
    unreadCount: unreadByConversation.get(id) ?? 0,
  })).filter((item) => item.id).sort((a, b) => (
    new Date(b.latestMessage?.created_at ?? b.created_at) - new Date(a.latestMessage?.created_at ?? a.created_at)
  ));
}

function conversationName(conversation) {
  if (conversation.type === 'group') return conversation.name;
  return conversation.otherProfiles.map((person) => person.name).join(', ') || 'Direct conversation';
}

export function MessagesPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  useFriendshipRealtime();
  const query = useQuery({
    queryKey: ['conversations', user?.id],
    queryFn: () => fetchConversations(user.id),
    enabled: Boolean(user?.id),
    retry: 1,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    if (query.isError) toast(query.error.message || 'Messages could not be loaded.');
  }, [query.isError, query.error, toast]);

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    const channel = supabase.channel(`conversation-list-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'messages' }, () => queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'conversation_members' }, () => queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'conversations' }, () => queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Live conversation updates are temporarily unavailable.');
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient, toast]);

  const visibleConversations = (query.data ?? []).filter((conversation) => {
    const name = conversationName(conversation);
    return `${name} ${conversation.otherProfiles.map((person) => person.username).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase());
  });

  return (
    <div className="app-page-content">
      <AppPageHeader eyebrow="YOUR CONVERSATIONS" title="Messages" description="Conversations with people you care about." action={<Button onClick={() => setNewGroupOpen(true)}><Plus size={15} /> New group</Button>} />
      <label className="app-search-wrap messages-search"><MessageCircle size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search conversations" aria-label="Search conversations" /></label>
      <Card className="people-card">
        {query.isLoading && <div className="list-skeleton">{[1, 2, 3].map((item) => <Skeleton className="people-skeleton" key={item} />)}</div>}
        {query.isError && <EmptyState icon={MessageCircle} title="Messages didn’t load" description={query.error.message || 'Check your connection and try again.'} />}
        {query.isSuccess && query.data.length === 0 && (
          <EmptyState icon={MessageCircle} title="Your conversations start here" description="Once you’re connected with a friend, your chats will be ready here." />
        )}
        {query.isSuccess && query.data.length > 0 && visibleConversations.length === 0 && <EmptyState icon={MessageCircle} title="No conversations found" description="Try another name or username." />}
        {visibleConversations.map((conversation) => {
          const latest = conversation.latestMessage;
          const leadProfile = conversation.otherProfiles[0];
          const online = leadProfile?.last_seen && Date.now() - new Date(leadProfile.last_seen).getTime() < 5 * 60_000;
          return (
            <Link className="people-row message-row" to={`/messages/${conversation.id}`} key={conversation.id}>
              {conversation.type === 'group'
                ? <Avatar src={conversation.photo_url} name={conversation.name} size="md" />
                : <Avatar src={leadProfile?.photo_url} name={leadProfile?.name || 'Member'} size="md" online={Boolean(online)} />}
              <span className="people-row-copy">
                <strong>{conversationName(conversation)}</strong>
                <small>{latest?.body || (latest?.image_url ? 'Photo' : 'No messages yet')}</small>
              </span>
              <span className="message-row-meta">
                <small>{latest && new Date(latest.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</small>
                {conversation.unreadCount > 0 && <span className="conversation-unread-count">{conversation.unreadCount > 99 ? '99+' : conversation.unreadCount}</span>}
              </span>
            </Link>
          );
        })}
      </Card>
      <NewGroupModal open={newGroupOpen} onClose={() => setNewGroupOpen(false)} />
    </div>
  );
}
