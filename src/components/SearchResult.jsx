import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, LoaderCircle, UserPlus, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

async function fetchRelationship(userId, targetId) {
  const { data, error } = await supabase
    .from('friendships')
    .select('id, status, requester_id, addressee_id')
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function SearchResult({ profile, onNavigate }) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [working, setWorking] = useState(false);
  const actionLock = useRef(false);
  const relationshipKey = ['friendship', user?.id, profile.id];
  const relationship = useQuery({
    queryKey: relationshipKey,
    queryFn: () => fetchRelationship(user.id, profile.id),
    enabled: Boolean(user?.id && profile.id && profile.id !== user.id),
    retry: 1,
  });

  async function act(action) {
    if (actionLock.current) return;
    actionLock.current = true;
    setWorking(true);
    try {
      let result;
      if (action === 'send') {
        result = await supabase.rpc('send_friend_request', { target: profile.id });
      } else if (action === 'cancel') {
        result = await supabase.rpc('cancel_friend_request', { target: profile.id });
      } else if (action === 'accept' || action === 'decline') {
        result = await supabase.rpc('respond_friend_request', {
          requester: profile.id,
          accept: action === 'accept',
        });
      }
      if (result?.error) throw result.error;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: relationshipKey }),
        queryClient.invalidateQueries({ queryKey: ['friendships', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }),
      ]);
      if (action === 'send') toast('Friend request sent.', 'success');
      if (action === 'cancel') toast('Friend request canceled.', 'success');
      if (action === 'accept') toast(`You’re now friends with ${profile.name}.`, 'success');
      if (action === 'decline') toast('Friend request declined.', 'success');
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: relationshipKey });
      if (error.code === '23505' || error.message?.includes('friendship or pending request already exists')) {
        await queryClient.refetchQueries({ queryKey: relationshipKey });
        toast('A friendship or request already exists. The latest status has been refreshed.');
      } else {
        toast(error.message || 'Friend request could not be updated. The relationship may have changed.');
      }
    } finally {
      actionLock.current = false;
      setWorking(false);
    }
  }

  const row = relationship.data;
  const pendingSent = row?.status === 'pending' && row.requester_id === user?.id;
  const pendingReceived = row?.status === 'pending' && row.addressee_id === user?.id;
  const friends = row?.status === 'accepted';

  return (
    <div className="search-result">
      <Link
        className="search-result-person"
        to={`/profile/${profile.username}`}
        onClick={onNavigate}
      >
        <Avatar src={profile.photo_url} name={profile.name} size="sm" />
        <span className="search-result-copy">
          <strong>{profile.name}</strong>
          <small>@{profile.username}</small>
        </span>
      </Link>
      <div className="search-result-action">
        {relationship.isLoading
          ? <span className="search-status-loading"><LoaderCircle size={14} /> Checking</span>
          : relationship.isError
            ? <button className="search-status-retry" type="button" onClick={() => relationship.refetch()}>Retry</button>
            : friends
              ? <Button variant="secondary" size="sm" disabled><Check size={13} /> Friends</Button>
              : pendingReceived
                ? <div className="search-request-actions">
                    <Button size="sm" onClick={() => act('accept')} loading={working}>Accept</Button>
                    <button className="search-decline-button" type="button" onClick={() => act('decline')} disabled={working} aria-label={`Decline ${profile.name}'s request`}><X size={14} /></button>
                  </div>
                : <Button
                    variant={pendingSent ? 'secondary' : 'primary'}
                    size="sm"
                    onClick={() => act(pendingSent ? 'cancel' : 'send')}
                    loading={working}
                    aria-label={pendingSent ? `Cancel friend request to ${profile.name}` : `Add ${profile.name} as a friend`}
                  >
                    {pendingSent ? 'Pending' : <><UserPlus size={13} /> Add Friend</>}
                  </Button>}
      </div>
    </div>
  );
}
