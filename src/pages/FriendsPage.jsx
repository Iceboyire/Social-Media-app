import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AtSign, Ban, ChevronDown, MessageCircle, MoreHorizontal, Pencil, Plus, Search, Trash2, UserMinus, UserPlus, UsersRound, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { SearchResult } from '../components/SearchResult';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { invalidateFriendshipQueries, useFriendshipRealtime } from '../hooks/useFriendshipRealtime';
import { useAvailability } from '../hooks/useAvailability';
import { Modal } from '../components/ui/Modal';

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

function ProfileRow({ item, status, circles, circleIds, onToggleCircle, onAction, busy, menuOpen, onToggleMenu, onConfirm }) {
  const { profile } = item;
  const online = profile.last_seen && Date.now() - new Date(profile.last_seen).getTime() < 5 * 60_000;
  return (
    <div className="people-row">
      <Link className="people-row-person" to={`/profile/${profile.username}`}>
      <span className="friend-avatar-circle-wrap">
        <Avatar src={profile.photo_url} name={profile.name} size="md" online={Boolean(online)} />
        {circleIds.length > 0 && <span className="friend-avatar-circle-dots" aria-label={`In ${circleIds.length} of your circles`} title={circles.filter((circle) => circleIds.includes(circle.id)).map((circle) => circle.name).join(', ')}>{circles.filter((circle) => circleIds.includes(circle.id)).slice(0, 3).map((circle) => <i key={circle.id} style={{ background: circle.color }} />)}</span>}
      </span>
      <span className="people-row-copy">
        <strong>{profile.name}</strong>
        <small><AtSign size={12} />{profile.username}</small>
        {status && <small className={`friend-availability friend-availability-${status.state}`}>{status.state.replace('_', ' ')}{status.note ? ` · ${status.note}` : ''}</small>}
      </span>
      </Link>
      <span className="people-row-actions">
        <Button size="sm" variant="secondary" onClick={() => onAction(item, 'message')} loading={busy}><MessageCircle size={14} /> Message</Button>
        <div className="profile-actions-menu">
          <Button size="sm" variant="secondary" aria-label={`More actions for ${profile.name}`} aria-expanded={menuOpen} onClick={onToggleMenu}><MoreHorizontal size={17} /><ChevronDown size={13} /></Button>
          {menuOpen && <div className="profile-actions-popover">
            {circles.length > 0 && <div className="friend-circle-picker">
              <strong>Circles</strong>
              {circles.map((circle) => <label key={circle.id}><input type="checkbox" checked={circleIds.includes(circle.id)} disabled={busy} onChange={(event) => onToggleCircle(item, circle, event.target.checked)} /><i style={{ background: circle.color }} /><span>{circle.name}</span></label>)}
            </div>}
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
  const [discoveryOpen, setDiscoveryOpen] = useState(false);
  const [discoverySearch, setDiscoverySearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [menuTarget, setMenuTarget] = useState(null);
  const [confirmTarget, setConfirmTarget] = useState(null);
  const { friends: availability } = useAvailability();
  const [activeCircle, setActiveCircle] = useState('');
  const [circleDialog, setCircleDialog] = useState(null);
  const [circleName, setCircleName] = useState('');
  const [circleColor, setCircleColor] = useState('#5479d1');
  const [circleSaving, setCircleSaving] = useState(false);
  const [circleDeleteTarget, setCircleDeleteTarget] = useState(null);
  useFriendshipRealtime();
  const query = useQuery({
    queryKey: ['friends', user?.id],
    queryFn: () => fetchFriendships(user.id),
    enabled: Boolean(user?.id),
    retry: 1,
  });
  const discoveryQuery = useQuery({
    queryKey: ['user-search', user?.id, debouncedSearch],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('search_users', { query: debouncedSearch });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id && discoveryOpen && debouncedSearch.length >= 2),
    staleTime: 15_000,
    retry: false,
  });
  const circlesQuery = useQuery({
    queryKey: ['circles', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('circles').select('id, name, color, created_at').eq('owner_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id),
    retry: 1,
  });
  const circleMembersQuery = useQuery({
    queryKey: ['circle-members', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('circle_members').select('circle_id, friend_id');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id && circlesQuery.isSuccess),
    retry: 1,
  });

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(discoverySearch.trim());
    }, 300);
    return () => window.clearTimeout(timer);
  }, [discoverySearch]);

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

  async function saveCircle(event) {
    event.preventDefault();
    if (circleSaving) return;
    setCircleSaving(true);
    try {
      const { error } = circleDialog?.id
        ? await supabase.rpc('rename_circle', { p_circle_id: circleDialog.id, p_name: circleName.trim(), p_color: circleColor })
        : await supabase.rpc('create_circle', { p_name: circleName.trim(), p_color: circleColor });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['circles', user.id] });
      setCircleDialog(null);
      toast(circleDialog?.id ? 'Circle updated.' : 'Circle created.', 'success');
    } catch (error) {
      toast(error.message || 'The circle could not be saved.');
    } finally {
      setCircleSaving(false);
    }
  }

  async function deleteCircle() {
    if (!circleDeleteTarget || circleSaving) return;
    setCircleSaving(true);
    try {
      const { error } = await supabase.rpc('delete_circle', { p_circle_id: circleDeleteTarget.id });
      if (error) throw error;
      if (activeCircle === circleDeleteTarget.id) setActiveCircle('');
      setCircleDeleteTarget(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['circles', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['circle-members', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['availability'] }),
      ]);
      toast('Circle deleted.', 'success');
    } catch (error) {
      toast(error.message || 'The circle could not be deleted.');
    } finally {
      setCircleSaving(false);
    }
  }

  async function toggleCircleFriend(item, circle, add) {
    try {
      const { error } = await supabase.rpc(add ? 'add_to_circle' : 'remove_from_circle', {
        p_circle_id: circle.id,
        p_friend_id: item.profile.id,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['circle-members', user.id] });
    } catch (error) {
      toast(error.message || 'Circle membership could not be updated.');
    }
  }

  const filteredFriends = (query.data ?? []).filter(({ profile }) => (
    `${profile.name} ${profile.username}`.toLowerCase().includes(search.trim().toLowerCase())
    && (!activeCircle || circleMembersQuery.data?.some((membership) => membership.circle_id === activeCircle && membership.friend_id === profile.id))
  ));

  return (
    <div className="app-page-content">
      <AppPageHeader
        eyebrow="YOUR PEOPLE"
        title="Friends"
        description="People you’ve connected with."
        action={<span className="friends-header-actions"><Button variant="secondary" onClick={() => { setCircleName(''); setCircleColor('#5479d1'); setCircleDialog({}); }}><Plus size={15} /> New circle</Button><Link className="ui-button ui-button-secondary" to="/requests">Friend requests</Link></span>}
      />
      {availability.isError && <div className="inline-alert" role="alert">{availability.error.message || 'Friend statuses could not be loaded.'}</div>}
      {circlesQuery.isLoading && <p className="circle-query-loading" role="status">Loading circles…</p>}
      {circlesQuery.isError && <div className="inline-alert" role="alert"><span>{circlesQuery.error.message || 'Circles could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => circlesQuery.refetch()}>Try again</Button></div>}
      {circleMembersQuery.isLoading && circlesQuery.isSuccess && <p className="circle-query-loading" role="status">Loading circle assignments…</p>}
      {circleMembersQuery.isError && <div className="inline-alert" role="alert"><span>{circleMembersQuery.error.message || 'Circle memberships could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => circleMembersQuery.refetch()}>Try again</Button></div>}
      {circlesQuery.isSuccess && <div className="circle-filter-row" aria-label="Filter friends by circle">
        <button type="button" className={!activeCircle ? 'circle-filter-active' : ''} disabled={circleMembersQuery.isLoading || circleMembersQuery.isError} onClick={() => setActiveCircle('')}>All friends</button>
        {circlesQuery.data.map((circle) => <span className={`circle-filter${activeCircle === circle.id ? ' circle-filter-active' : ''}`} key={circle.id}>
          <button type="button" disabled={circleMembersQuery.isLoading || circleMembersQuery.isError} onClick={() => setActiveCircle(activeCircle === circle.id ? '' : circle.id)}><i style={{ background: circle.color }} />{circle.name}</button>
          <button type="button" aria-label={`Edit ${circle.name}`} onClick={() => { setCircleName(circle.name); setCircleColor(circle.color); setCircleDialog(circle); }}><Pencil size={12} /></button>
          <button type="button" aria-label={`Delete ${circle.name}`} onClick={() => setCircleDeleteTarget(circle)}><Trash2 size={12} /></button>
        </span>)}
      </div>}
      <div className="friends-toolbar">
        {discoveryOpen ? (
          <>
            <label className="app-search-wrap friends-search">
              <Search size={16} />
              <input
                type="search"
                value={discoverySearch}
                onChange={(event) => setDiscoverySearch(event.target.value)}
                placeholder="Search by name or username"
                aria-label="Find people by name or username"
                autoFocus
              />
            </label>
            <Button variant="secondary" onClick={() => {
              setDiscoveryOpen(false);
              setDiscoverySearch('');
            }}>Back to friends</Button>
          </>
        ) : (
          <>
            <label className="app-search-wrap friends-search">
              <Search size={16} />
              <input
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search your friends"
                aria-label="Search your friends"
              />
            </label>
            <Button onClick={() => setDiscoveryOpen(true)}><UserPlus size={15} /> Find people</Button>
          </>
        )}
      </div>
      {discoveryOpen ? (
        <Card className="people-card friends-discovery-card">
          {debouncedSearch.length < 2 && (
            <EmptyState icon={Search} title="Find your people" description="Search by name or username. Enter at least 2 characters to see people you can add." />
          )}
          {debouncedSearch.length >= 2 && discoveryQuery.isFetching && (
            <div className="list-skeleton">{[1, 2, 3].map((item) => <Skeleton className="people-skeleton" key={item} />)}</div>
          )}
          {debouncedSearch.length >= 2 && discoveryQuery.isError && (
            <EmptyState
              icon={UsersRound}
              title="People didn’t load"
              description={discoveryQuery.error.message || 'Check your connection and try again.'}
              action={<Button size="sm" variant="secondary" onClick={() => discoveryQuery.refetch()}>Try again</Button>}
            />
          )}
          {debouncedSearch.length >= 2 && discoveryQuery.isSuccess && discoveryQuery.data.length === 0 && (
            <EmptyState icon={Search} title="No people found" description="Try another name or username. People need an account before they can appear here." />
          )}
          {debouncedSearch.length >= 2 && discoveryQuery.data?.map((profile) => (
            <SearchResult key={profile.id} profile={profile} />
          ))}
        </Card>
      ) : (
        <Card className="people-card">
          {query.isLoading && <div className="list-skeleton">{[1, 2, 3].map((item) => <Skeleton className="people-skeleton" key={item} />)}</div>}
          {query.isError && <EmptyState icon={UsersRound} title="Friends didn’t load" description={query.error.message || 'Check your connection and try again.'} action={<Button size="sm" variant="secondary" onClick={() => query.refetch()}>Try again</Button>} />}
          {query.isSuccess && query.data.length === 0 && (
            <EmptyState
              icon={UserPlus}
              title="Your circle starts here"
              description="Find people by name or username and send them a friend request."
              action={<Button onClick={() => setDiscoveryOpen(true)}><Search size={15} /> Find people</Button>}
            />
          )}
          {query.data?.length > 0 && filteredFriends.length === 0 && (
            <EmptyState icon={Search} title="No friends found" description="Try searching for another name or username." />
          )}
          {filteredFriends.map((item) => (
            <ProfileRow
              item={item}
              status={availability.data?.find((friend) => friend.user_id === item.profile.id)}
              circles={circlesQuery.data ?? []}
              circleIds={(circleMembersQuery.data ?? []).filter((membership) => membership.friend_id === item.profile.id).map((membership) => membership.circle_id)}
              onToggleCircle={toggleCircleFriend}
              key={item.id}
              onAction={handleAction}
              busy={activeAction === item.id}
              menuOpen={menuTarget === item.id}
              onToggleMenu={() => setMenuTarget(menuTarget === item.id ? null : item.id)}
              onConfirm={(target, action) => setConfirmTarget({ item: target, action })}
            />
          ))}
        </Card>
      )}
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
      <Modal open={Boolean(circleDialog)} onClose={() => { if (!circleSaving) setCircleDialog(null); }} title={circleDialog?.id ? 'Edit circle' : 'Create a circle'}>
        <form className="circle-form" onSubmit={saveCircle}>
          <label className="chat-plan-field"><span>Circle name</span><input className="ui-input" value={circleName} maxLength={40} onChange={(event) => setCircleName(event.target.value)} required autoFocus /></label>
          <label className="circle-color-field"><span>Circle color</span><input type="color" value={circleColor} onChange={(event) => setCircleColor(event.target.value)} /></label>
          <div className="ui-modal-actions"><Button type="button" variant="secondary" disabled={circleSaving} onClick={() => setCircleDialog(null)}>Cancel</Button><Button type="submit" loading={circleSaving}>{circleDialog?.id ? 'Save changes' : 'Create circle'}</Button></div>
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(circleDeleteTarget)} onClose={() => setCircleDeleteTarget(null)} onConfirm={deleteCircle} title="Delete this circle?" message={circleDeleteTarget ? `“${circleDeleteTarget.name}” and its friend assignments will be deleted.` : ''} confirmLabel="Delete circle" destructive loading={circleSaving} />
    </div>
  );
}
