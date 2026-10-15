import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AtSign, Ban, CalendarDays, Check, Flag, MapPin, MessageCircle, Pencil,
  MoreHorizontal, UserMinus, UserPlus, UsersRound, X,
} from 'lucide-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

function ProfileActionsMenu({ open, menuRef, onToggle, onUnfriend, onCancelRequest, onBlock, onReport, showUnfriend = false, showCancelRequest = false }) {
  return (
    <div className="profile-actions-menu" ref={menuRef}>
      <Button variant="secondary" className="profile-more-button" aria-label="More profile actions" aria-expanded={open} onClick={onToggle}>
        <MoreHorizontal size={19} />
      </Button>
      {open && <div className="profile-actions-popover">
        {showUnfriend && <button type="button" onClick={onUnfriend}><UserMinus size={15} /> Unfriend</button>}
        {showCancelRequest && <button type="button" onClick={onCancelRequest}><X size={15} /> Cancel request</button>}
        <button type="button" onClick={onBlock}><Ban size={15} /> Block</button>
        <button type="button" onClick={onReport}><Flag size={15} /> Report</button>
      </div>}
    </div>
  );
}

async function fetchRelationship(userId, targetId) {
  const { data, error } = await supabase
    .from('friendships')
    .select('status, requester_id, addressee_id')
    .or(`and(requester_id.eq.${userId},addressee_id.eq.${targetId}),and(requester_id.eq.${targetId},addressee_id.eq.${userId})`)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export function UserProfilePage() {
  const { username } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const actionsMenuRef = useRef(null);
  const actionLock = useRef(false);
  const [working, setWorking] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAction, setConfirmAction] = useState(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const [reportNote, setReportNote] = useState('');
  const [reportError, setReportError] = useState('');
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [activeTab, setActiveTab] = useState('about');
  const profileQuery = useQuery({
    queryKey: ['public-profile', username?.toLowerCase()],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('id, name, username, bio, location, photo_url, last_seen, created_at')
        .ilike('username', username.toLowerCase())
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(username),
    retry: 1,
  });
  const person = profileQuery.data;
  const connectionsQuery = useQuery({
    queryKey: ['profile-connections', user?.id, person?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('get_profile_connections', { target: person.id });
      if (error) throw error;
      return data;
    },
    enabled: Boolean(user?.id && person?.id),
    retry: 1,
  });
  const relationshipKey = ['friendship', user?.id, person?.id];
  const relationshipQuery = useQuery({
    queryKey: relationshipKey,
    queryFn: () => fetchRelationship(user.id, person.id),
    enabled: Boolean(user?.id && person?.id && person.id !== user.id),
    retry: false,
  });

  useEffect(() => {
    if (profileQuery.isError) toast(profileQuery.error.message || 'The profile could not be loaded.');
  }, [profileQuery.isError, profileQuery.error, toast]);
  useEffect(() => {
    if (relationshipQuery.isError) toast(relationshipQuery.error.message || 'Friendship status could not be loaded.');
  }, [relationshipQuery.isError, relationshipQuery.error, toast]);
  useEffect(() => {
    if (connectionsQuery.isError) toast(connectionsQuery.error.message || 'Profile connections could not be loaded.');
  }, [connectionsQuery.isError, connectionsQuery.error, toast]);
  useEffect(() => {
    function dismissActionsMenu(event) {
      if (!actionsMenuRef.current?.contains(event.target)) setMenuOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setMenuOpen(false);
    }
    document.addEventListener('mousedown', dismissActionsMenu);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', dismissActionsMenu);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function refreshRelationship() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: relationshipKey }),
      queryClient.invalidateQueries({ queryKey: ['friendships', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['user-search', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['friends', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['profile-connections', user.id] }),
    ]);
  }

  async function runRelationshipAction(action) {
    if (!person || actionLock.current) return;
    actionLock.current = true;
    setWorking(action);
    try {
      let result;
      if (action === 'send') result = await supabase.rpc('send_friend_request', { target: person.id });
      if (action === 'cancel') result = await supabase.rpc('cancel_friend_request', { target: person.id });
      if (action === 'accept' || action === 'decline') {
        result = await supabase.rpc('respond_friend_request', {
          requester: person.id,
          accept: action === 'accept',
        });
      }
      if (action === 'unfriend') result = await supabase.rpc('unfriend', { target: person.id });
      if (action === 'block') result = await supabase.rpc('block_user', { target: person.id });
      if (result?.error) throw result.error;
      await refreshRelationship();
      setConfirmAction(null);
      setMenuOpen(false);
      if (action === 'send') toast('Friend request sent.', 'success');
      if (action === 'cancel') toast('Friend request canceled.', 'success');
      if (action === 'accept') toast(`You’re now friends with ${person.name}.`, 'success');
      if (action === 'decline') toast('Friend request declined.', 'success');
      if (action === 'unfriend') toast(`You and ${person.name} are no longer friends.`, 'success');
      if (action === 'block') {
        toast(`${person.name} has been blocked.`, 'success');
        navigate('/friends', { replace: true });
      }
    } catch (error) {
      await queryClient.invalidateQueries({ queryKey: relationshipKey });
      if (error.code === '23505' || error.message?.includes('friendship or pending request already exists')) {
        await queryClient.refetchQueries({ queryKey: relationshipKey });
        toast('A friendship or request already exists. The latest status has been refreshed.');
      } else {
        toast(error.message || 'The relationship could not be updated.');
      }
    } finally {
      actionLock.current = false;
      setWorking('');
    }
  }

  async function startConversation() {
    if (!person || working) return;
    setWorking('message');
    try {
      const { data, error } = await supabase.rpc('get_or_create_direct_conversation', { friend: person.id });
      if (error) throw error;
      if (!data) throw new Error('The conversation could not be opened.');
      await queryClient.invalidateQueries({ queryKey: ['conversations', user.id] });
      navigate(`/messages/${data}`);
    } catch (error) {
      toast(error.message || 'The conversation could not be opened.');
      await queryClient.invalidateQueries({ queryKey: relationshipKey });
    } finally {
      setWorking('');
    }
  }

  async function submitReport(event) {
    event.preventDefault();
    if (!person || !reportReason || reportSubmitting) return;
    setReportSubmitting(true);
    setReportError('');
    try {
      const { error } = await supabase.from('reports').insert({
        reporter_id: user.id,
        reported_user_id: person.id,
        reason: reportReason,
        note: reportNote.trim() || null,
      });
      if (error) throw error;
      setReportOpen(false);
      setReportReason('');
      setReportNote('');
      toast('Thank you. Your report has been submitted.', 'success');
    } catch (error) {
      const message = error.message || 'Your report could not be submitted.';
      setReportError(message);
      toast(message);
    } finally {
      setReportSubmitting(false);
    }
  }

  const relation = relationshipQuery.data;
  const isOwnProfile = person?.id === user?.id;
  const isFriend = relation?.status === 'accepted';
  const outgoingRequest = relation?.status === 'pending' && relation.requester_id === user?.id;
  const incomingRequest = relation?.status === 'pending' && relation.addressee_id === user?.id;
  const joinedDate = person?.created_at
    ? new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(new Date(person.created_at))
    : null;
  const mutualFriends = connectionsQuery.data?.mutual_friends ?? [];
  const friendCount = connectionsQuery.data?.friends_count;
  const confirmDetails = {
    unfriend: {
      title: 'Unfriend this person?',
      message: `You and ${person?.name} will no longer be friends. Your existing conversation history will remain available.`,
      confirmLabel: 'Unfriend',
    },
    block: {
      title: 'Block this person?',
      message: `${person?.name} will no longer be able to find your profile or interact with you.`,
      confirmLabel: 'Block user',
    },
  }[confirmAction];

  return (
    <div className="app-page-content">
      <Card className="my-profile-card public-profile-card">
        {profileQuery.isLoading && <div className="profile-loading"><Skeleton circle className="profile-large-skeleton" /><Skeleton className="profile-line-skeleton" /><Skeleton className="profile-line-skeleton short" /></div>}
        {profileQuery.isError && <EmptyState icon={UsersRound} title="Profile didn’t load" description={profileQuery.error.message || 'Check your connection and try again.'} action={<Button size="sm" variant="secondary" onClick={() => profileQuery.refetch()}>Try again</Button>} />}
        {profileQuery.isSuccess && !person && <EmptyState icon={UsersRound} title="We couldn’t find that profile" description="It may have changed, or it may not be visible to your account." />}
        {person && (
          <>
            <div className="public-profile-cover" aria-hidden="true"><span /></div>
            <div className="public-profile-content">
              <div className="public-profile-heading-row">
                <div className="public-profile-identity">
                  <Avatar
                    src={person.photo_url}
                    name={person.name}
                    size="xl"
                    online={Boolean(person.last_seen && Date.now() - new Date(person.last_seen).getTime() < 5 * 60_000)}
                    className="public-profile-avatar"
                  />
                  <div className="public-profile-names">
                    <h1>{person.name}</h1>
                    <p className="my-profile-username"><AtSign size={15} />{person.username}</p>
                  </div>
                </div>
                {isOwnProfile
                  ? <div className="public-profile-actions"><Link className="ui-button ui-button-primary" to="/profile/edit"><Pencil size={16} /> Edit profile</Link></div>
                  : <div className="public-profile-actions">
                    {relationshipQuery.isLoading
                      ? <Button variant="secondary" disabled>Checking relationship…</Button>
                      : relationshipQuery.isError
                        ? <Button variant="secondary" onClick={() => relationshipQuery.refetch()}>Retry relationship status</Button>
                        : isFriend
                          ? <>
                              <Button onClick={startConversation} loading={working === 'message'}><MessageCircle size={16} /> Message</Button>
                              <ProfileActionsMenu
                                open={menuOpen}
                                menuRef={actionsMenuRef}
                                onToggle={() => setMenuOpen((open) => !open)}
                                onUnfriend={() => { setConfirmAction('unfriend'); setMenuOpen(false); }}
                                onBlock={() => { setConfirmAction('block'); setMenuOpen(false); }}
                                onReport={() => { setReportOpen(true); setMenuOpen(false); }}
                                showUnfriend
                              />
                            </>
                          : incomingRequest
                            ? <>
                                <Button onClick={() => runRelationshipAction('accept')} loading={working === 'accept'}><Check size={16} /> Accept request</Button>
                                <Button variant="secondary" onClick={() => runRelationshipAction('decline')} disabled={Boolean(working)}><X size={16} /> Decline</Button>
                              <ProfileActionsMenu
                                open={menuOpen}
                                menuRef={actionsMenuRef}
                                onToggle={() => setMenuOpen((open) => !open)}
                                onUnfriend={() => { setConfirmAction('unfriend'); setMenuOpen(false); }}
                                onBlock={() => { setConfirmAction('block'); setMenuOpen(false); }}
                                onReport={() => { setReportOpen(true); setMenuOpen(false); }}
                              />
                            </>
                          : outgoingRequest
                            ? <>
                                <Button variant="secondary" disabled><UserPlus size={16} /> Pending</Button>
                                <ProfileActionsMenu
                                  open={menuOpen}
                                  menuRef={actionsMenuRef}
                                  onToggle={() => setMenuOpen((open) => !open)}
                                  onUnfriend={() => { setConfirmAction('unfriend'); setMenuOpen(false); }}
                                  onCancelRequest={() => runRelationshipAction('cancel')}
                                  onBlock={() => { setConfirmAction('block'); setMenuOpen(false); }}
                                  onReport={() => { setReportOpen(true); setMenuOpen(false); }}
                                  showCancelRequest
                                />
                              </>
                            : <>
                                <Button onClick={() => runRelationshipAction('send')} loading={working === 'send'}><UserPlus size={16} /> Add friend</Button>
                                <ProfileActionsMenu
                                  open={menuOpen}
                                  menuRef={actionsMenuRef}
                                  onToggle={() => setMenuOpen((open) => !open)}
                                  onUnfriend={() => { setConfirmAction('unfriend'); setMenuOpen(false); }}
                                  onBlock={() => { setConfirmAction('block'); setMenuOpen(false); }}
                                  onReport={() => { setReportOpen(true); setMenuOpen(false); }}
                                />
                              </>}
                  </div>}
              </div>
              {!isOwnProfile && !isFriend && <div className="profile-message-note">
                <span
                  className="profile-message-locked"
                  title="You can message this person once they accept your request."
                  tabIndex="0"
                  aria-label="Message locked. You can message this person once they accept your request."
                >
                  <Button variant="secondary" disabled><MessageCircle size={16} /> Message</Button>
                  <span className="profile-message-tooltip" role="tooltip">You can message this person once they accept your request.</span>
                </span>
                <span>You can message this person once they accept your request.</span>
              </div>}
              <div className="public-profile-summary">
                {person.bio && <p className="my-profile-bio">{person.bio}</p>}
                <div className="public-profile-meta">
                  {person.location && <span className="profile-info-chip"><MapPin size={15} />{person.location}</span>}
                  {joinedDate && <span className="profile-info-chip"><CalendarDays size={15} />Joined {joinedDate}</span>}
                </div>
              </div>
              <div className="public-profile-stats" aria-label="Profile statistics">
                <span className="profile-stat">
                  <strong>{connectionsQuery.isLoading ? '—' : friendCount ?? '—'}</strong>
                  <span>Friends</span>
                </span>
              </div>
              <div className="public-profile-details">
                <div className="public-profile-tabs" role="tablist" aria-label="Profile details">
                  <button className={activeTab === 'about' ? 'profile-tab profile-tab-active' : 'profile-tab'} type="button" role="tab" aria-selected={activeTab === 'about'} onClick={() => setActiveTab('about')}>About</button>
                  <button className={activeTab === 'mutual' ? 'profile-tab profile-tab-active' : 'profile-tab'} type="button" role="tab" aria-selected={activeTab === 'mutual'} onClick={() => setActiveTab('mutual')}>
                    {isOwnProfile ? 'Friends' : 'Mutual friends'}
                    {!connectionsQuery.isLoading && <span className="profile-tab-count">{mutualFriends.length}</span>}
                  </button>
                </div>
                {activeTab === 'about'
                  ? <div className="profile-tab-panel" role="tabpanel">
                      <h2>About {isOwnProfile ? 'you' : person.name}</h2>
                      <p className="profile-about-bio">{person.bio || 'No introduction yet.'}</p>
                      <div className="profile-about-meta">
                        {person.location && <span><MapPin size={17} /> Lives in <strong>{person.location}</strong></span>}
                        {joinedDate && <span><CalendarDays size={17} /> Joined <strong>{joinedDate}</strong></span>}
                      </div>
                    </div>
                  : <div className="profile-tab-panel" role="tabpanel">
                      {connectionsQuery.isLoading
                        ? <div className="mutual-friends-loading"><Skeleton circle /><Skeleton circle /><Skeleton circle /></div>
                        : connectionsQuery.isError
                          ? <div className="profile-connections-error" role="alert">
                            <span>{connectionsQuery.error.message || 'Friends could not be loaded.'}</span>
                            <Button size="sm" variant="secondary" onClick={() => connectionsQuery.refetch()}>Try again</Button>
                          </div>
                          : mutualFriends.length
                          ? <div className="mutual-friends-grid">
                              {mutualFriends.map((friend) => (
                                <Link className="mutual-friend" key={friend.id} to={`/profile/${friend.username}`}>
                                  <Avatar src={friend.photo_url} name={friend.name} size="md" />
                                  <span><strong>{friend.name}</strong><small>@{friend.username}</small></span>
                                </Link>
                              ))}
                            </div>
                          : <div className="profile-no-mutuals"><UsersRound size={21} /><span>{isOwnProfile ? 'Your friends will appear here.' : 'No mutual friends yet.'}</span></div>}
                    </div>}
              </div>
            </div>
          </>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(confirmAction)}
        onClose={() => setConfirmAction(null)}
        onConfirm={() => runRelationshipAction(confirmAction)}
        title={confirmDetails?.title}
        message={confirmDetails?.message}
        confirmLabel={confirmDetails?.confirmLabel}
        loading={Boolean(working)}
        destructive
      />

      <Modal
        open={reportOpen}
        onClose={reportSubmitting ? undefined : () => { setReportOpen(false); setReportError(''); }}
        title={`Report ${person?.name ?? 'user'}`}
        size="sm"
      >
        <form className="report-form" onSubmit={submitReport}>
          <p className="settings-card-intro">Tell us why this profile should be reviewed.</p>
          <div className="ui-input-field">
            <label className="ui-input-label" htmlFor="report-reason">Reason</label>
            <select className="ui-input report-select" id="report-reason" required value={reportReason} onChange={(event) => setReportReason(event.target.value)}>
              <option value="" disabled>Select a reason</option>
              <option value="spam">Spam</option>
              <option value="harassment">Harassment or bullying</option>
              <option value="inappropriate_content">Inappropriate content</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div className="ui-input-field">
            <label className="ui-input-label" htmlFor="report-note">Additional details (optional)</label>
            <textarea className="ui-input settings-textarea" id="report-note" maxLength={1000} rows={4} value={reportNote} onChange={(event) => setReportNote(event.target.value)} />
          </div>
          {reportError && <div className="inline-alert" role="alert">{reportError}</div>}
          <footer className="ui-modal-actions">
            <Button type="button" variant="secondary" onClick={() => setReportOpen(false)} disabled={reportSubmitting}>Cancel</Button>
            <Button type="submit" loading={reportSubmitting} disabled={!reportReason}><Flag size={15} /> Submit report</Button>
          </footer>
        </form>
      </Modal>
    </div>
  );
}
