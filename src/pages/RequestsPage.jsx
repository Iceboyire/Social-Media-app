import { useEffect, useState } from 'react';
import { AtSign, Check, Inbox, Send, UsersRound, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Tabs } from '../components/ui/Tabs';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { invalidateFriendshipQueries, useFriendshipRealtime } from '../hooks/useFriendshipRealtime';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

async function fetchRequests(userId) {
  const { data, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  if (error) throw error;
  const otherIds = [...new Set((data ?? []).map((row) => row.requester_id === userId ? row.addressee_id : row.requester_id))];
  if (!otherIds.length) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, username, photo_url, last_seen')
    .in('id', otherIds);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return (data ?? []).map((row) => ({
    ...row,
    incoming: row.addressee_id === userId,
    profile: byId.get(row.requester_id === userId ? row.addressee_id : row.requester_id),
  })).filter((row) => row.profile);
}

export function RequestsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('received');
  const [busyId, setBusyId] = useState('');
  useFriendshipRealtime();
  const query = useQuery({
    queryKey: ['friend-requests', user?.id],
    queryFn: () => fetchRequests(user.id),
    enabled: Boolean(user?.id),
    retry: 1,
  });

  useEffect(() => {
    if (query.isError) toast(query.error.message || 'Friend requests could not be loaded.');
  }, [query.isError, query.error, toast]);

  const rows = query.data ?? [];
  const received = rows.filter((row) => row.incoming);
  const sent = rows.filter((row) => !row.incoming);
  const visible = tab === 'received' ? received : sent;

  async function act(row, action) {
    if (busyId) return;
    setBusyId(row.id);
    try {
      const result = action === 'cancel'
        ? await supabase.rpc('cancel_friend_request', { target: row.profile.id })
        : await supabase.rpc('respond_friend_request', { requester: row.profile.id, accept: action === 'accept' });
      if (result.error) throw result.error;
      toast(action === 'accept' ? `You’re now friends with ${row.profile.name}.` : action === 'decline' ? 'Friend request declined.' : 'Friend request canceled.', 'success');
      await invalidateFriendshipQueries(queryClient, user.id);
    } catch (error) {
      toast(error.message || 'The friend request could not be updated.');
      await invalidateFriendshipQueries(queryClient, user.id);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="app-page-content">
      <AppPageHeader eyebrow="YOUR PEOPLE" title="Friend requests" description="Keep up with invitations to connect." />
      <Tabs
        className="request-tabs"
        label="Friend requests"
        value={tab}
        onChange={setTab}
        items={[
          { value: 'received', label: 'Received', icon: Inbox, badge: <Badge variant="blue">{received.length}</Badge> },
          { value: 'sent', label: 'Sent', icon: Send, badge: <Badge>{sent.length}</Badge> },
        ]}
      />
      <Card className="people-card request-list-card">
        {query.isLoading && <div className="list-skeleton">{[1, 2].map((item) => <Skeleton className="people-skeleton" key={item} />)}</div>}
        {query.isError && <EmptyState icon={UsersRound} title="Requests didn’t load" description={query.error.message || 'Check your connection and try again.'} action={<Button size="sm" variant="secondary" onClick={() => query.refetch()}>Try again</Button>} />}
        {query.isSuccess && visible.length === 0 && <EmptyState icon={tab === 'received' ? Inbox : Send} title={tab === 'received' ? 'No new requests' : 'No sent requests'} description={tab === 'received' ? 'New friend requests will appear here.' : 'Requests you send will appear here.'} />}
        {visible.map((row) => {
          const online = row.profile.last_seen && Date.now() - new Date(row.profile.last_seen).getTime() < 5 * 60_000;
          return (
            <div className="people-row" key={row.id}>
              <Link className="people-row-person" to={`/profile/${row.profile.username}`}>
                <Avatar src={row.profile.photo_url} name={row.profile.name} size="md" online={Boolean(online)} />
                <span className="people-row-copy"><strong>{row.profile.name}</strong><small><AtSign size={12} />{row.profile.username}</small></span>
              </Link>
              <span className="people-row-actions">
                {row.incoming
                  ? <><Button size="sm" onClick={() => act(row, 'accept')} loading={busyId === row.id}><Check size={14} /> Accept</Button><Button size="sm" variant="secondary" onClick={() => act(row, 'decline')} disabled={Boolean(busyId)}><X size={14} /> Decline</Button></>
                  : <><Badge>Pending</Badge><Button size="sm" variant="secondary" onClick={() => act(row, 'cancel')} loading={busyId === row.id}>Cancel</Button></>}
              </span>
            </div>
          );
        })}
      </Card>
    </div>
  );
}
