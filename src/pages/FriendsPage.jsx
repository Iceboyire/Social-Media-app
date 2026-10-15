import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Ban, Check, ChevronDown, MessageCircle, MoreHorizontal, Search, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { invalidateFriendshipQueries, useFriendshipRealtime } from '../hooks/useFriendshipRealtime';

async function fetchFriendships(userId) {
  const { data: friendships, error } = await supabase
    .from('friendships')
    .select('id, requester_id, addressee_id, status, created_at')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .eq('status', 'accepted')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  const otherIds = [...new Set((friendships ?? []).map((item) => (
    item.requester_id === userId ? item.addressee_id : item.requester_id
  )))];
  if (!otherIds.length) return [];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, username, photo_url, bio, last_seen')
    .in('id', otherIds);
  if (profilesError) throw profilesError;
  const byId = new Map((profiles ?? []).map((profile) => [profile.id, profile]));
  return (friendships ?? []).map((item) => ({
    ...item,
    incoming: item.addressee_id === userId && item.status === 'pending',
    profile: byId.get(item.requester_id === userId ? item.addressee_id : item.requester_id),
  })).filter((item) => item.profile);
}

function ProfileRow({ item, onAction, busy, menuOpen, onToggleMenu, onConfirm }) {
  const { profile } = item;
  const online = profile.last_seen && Date.now() - new Date(profile.last_seen).getTime() < 5 * 60_000;
  return (
    <div className="people-row">
      <Link className="people-row-person" to={`/profile/${profile.username}`}>
      <Avatar src={profile.photo_url} name={profile.name} size="md" online={Boolean(online)} />
      <span className="people-row-copy">
        <strong>{profile.name}</strong>
        <small><AtSign size={12} />{profile.username}</small>
      </span>
      </Link>
      <span className="people-row-actions">
        <Button size="sm" variant="secondary" onClick={() => onAction(item, 'message')} loading={busy}><MessageCircle size={14} /> Message</Button>
        <div className="profile-actions-menu">
          <Button size="sm" variant="secondary" aria-label={`More actions for ${profile.name}`} aria-expanded={menuOpen} onClick={onToggleMenu}><MoreHorizontal size={17} /><ChevronDown size={13} /></Button>
          {menuOpen && <div className="profile-actions-popover">
            <button type="button" onClick={() => onConfirm(item, 'unfriend')}><UserMinus size={15} /> Unfriend</button>
            <button type="button" onClick={() => onConfirm(item, 'block')}><Ban size={15} /> Block</button>
          </div>}
        </div>
      </span>
    </div>
  );
}

export function FriendsPage() {
  const { user } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [activeAction, setActiveAction] = useState(null);
  const [search, setSearch] = useState('');
  const [menuTarget, setMenuTarget] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  useFriendshipRealtime();
  const query = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriendships(user.id),
    enabled: Boolean(user?.id),
    retry: 1,
  });

  useEffect(() => {
    if (query.isError) toast(query.error.message || 'Friends could not be loaded.');
  }, [query.isError, query.error, toast]);

  async function handleAction(item, action) {
    if (action === 'unfriend' || action === 'block') {
      setConfirmTarget({ item, action });
      return;
    }
    if (activeAction) return;
    setActiveAction(item.id);
    try {
      const { data: conversationId, error } = await supabase.rpc('get_or_create_direct_conversation', { friend: item.profile.id });
      if (error) throw error;
      if (!conversationId) throw new Error('The conversation could not be opened.');
      await queryClient.invalidateQueries({ queryKey: ['conversations', user.id] });
      navigate(`/messages/${conversationId}`);
    } catch (actionError) {
      toast(actionError.message || 'That action could not be completed.');
      await invalidateFriendshipQueries(queryClient, user.id);
    } finally {
      setActiveAction(null);
    }
  }

  async function confirmFriendAction() {
    if (!confirmTarget || activeAction) return;
    const { item, action } = confirmTarget;
    setActiveAction(item.id);
    try {
      const { error } = await supabase.rpc(action === 'block' ? 'block_user' : 'unfriend', { target: item.profile.id });
      if (error) throw error;
      toast(action === 'block' ? `${item.profile.name} has been blocked.` : `You and ${item.profile.name} are no longer friends.`, 'success');
      setConfirmTarget(null);
      setMenuTarget(null);
      await invalidateFriendshipQueries(queryClient, user.id);
    } catch (actionError) {
      toast(actionError.message || 'The action could not be completed.');
    } finally {
      setActiveAction(null);
    }
  }

  return (
    <div className="app-page-content">
      <AppPageHeader eyebrow="YOUR PEOPLE" title="Friends" description="People you’ve connected with." />
      <div className="friends-toolbar">
        <label className="app-search-wrap friends-search"><Search size={16} /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search friends" aria-label="Search friends" /></label>
        <Link className="ui-button ui-button-secondary" to="/requests">Friend requests</Link>
      </div>
      <Card className="people-card">
        {query.isLoading && <div className="list-skeleton">{[1, 2, 3].map((item) => <Skeleton className="people-skeleton" key={item} />)}</div>}
        {query.isError && <EmptyState icon={UsersRound} title="Friends didn’t load" description={query.error.message || 'Check your connection and try again.'} />}
        {query.isSuccess && query.data.length === 0 && <EmptyState icon={UserPlus} title="Your people will find you here" description="Search for someone by name or username to start building your circle." />}
        {query.data?.length > 0 && query.data.filter(({ profile }) => `${profile.name} ${profile.username}`.toLowerCase().includes(search.trim().toLowerCase())).length === 0 && <EmptyState icon={Search} title="No friends found" description="Try searching for another name or username." />}
        {query.data?.filter(({ profile }) => `${profile.name} ${profile.username}`.toLowerCase().includes(search.trim().toLowerCase())).map((item) => <ProfileRow item={item} key={item.id} onAction={handleAction} busy={activeAction === item.id} menuOpen={menuTarget === item.id} onToggleMenu={() => setMenuTarget(menuTarget === item.id ? null : item.id)} onConfirm={(target, action) => setConfirmTarget({ item: target, action })} />)}
      </Card>
      <ConfirmDialog
        open={Boolean(confirmTarget)}
        onClose={() => setConfirmTarget(null)}
        onConfirm={confirmFriendAction}
        title={confirmTarget?.action === 'block' ? 'Block this person?' : 'Unfriend this person?'}
        message={confirmTarget ? (confirmTarget.action === 'block' ? `${confirmTarget.item.profile.name} will no longer be able to find or interact with you.` : `You and ${confirmTarget.item.profile.name} will no longer be friends.`) : ''}
        confirmLabel={confirmTarget?.action === 'block' ? 'Block user' : 'Unfriend'}
        destructive
        loading={Boolean(activeAction)}
      />
    </div>
  );
}
