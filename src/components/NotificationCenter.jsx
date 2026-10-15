import { useEffect, useMemo, useState } from 'react';
import { Bell, Check, CheckCheck, MessageCircle, ShieldAlert, UserPlus, UsersRound } from 'lucide-react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { invalidateFriendshipQueries } from '../hooks/useFriendshipRealtime';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { AppPageHeader } from './AppPageHeader';
import { Avatar } from './ui/Avatar';
import { Button } from './ui/Button';
import { CountBadge } from './ui/Badge';
import { EmptyState } from './ui/EmptyState';
import { Skeleton } from './ui/Skeleton';

const notificationCopy = {
  friend_request: 'sent you a friend request',
  request_accepted: 'accepted your friend request',
  new_message: 'sent you a message',
  group_invite: 'added you to a group',
  admin_warning: 'issued you an account warning',
};

const notificationIcon = {
  friend_request: UserPlus,
  request_accepted: Check,
  new_message: MessageCircle,
  group_invite: UsersRound,
  admin_warning: ShieldAlert,
};

function getTimeGroup(timestamp) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const date = new Date(timestamp);
  const notificationDay = new Date(date);
  notificationDay.setHours(0, 0, 0, 0);
  if (notificationDay.getTime() === today.getTime()) return 'Today';
  if (notificationDay.getTime() === yesterday.getTime()) return 'Yesterday';
  if (today.getTime() - notificationDay.getTime() < 7 * 24 * 60 * 60 * 1000) return 'This week';
  return 'Earlier';
}

function relativeTime(timestamp) {
  const seconds = Math.round((new Date(timestamp).getTime() - Date.now()) / 1000);
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['week', 604_800],
    ['day', 86_400],
    ['hour', 3_600],
    ['minute', 60],
  ];
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, duration] of units) {
    if (Math.abs(seconds) >= duration) return formatter.format(Math.round(seconds / duration), unit);
  }
  return formatter.format(0, 'second');
}

async function fetchNotifications(userId) {
  if (!supabase) throw new Error('Supabase is not configured.');
  const { data, error } = await supabase
    .from('notifications')
    .select('id, type, actor_id, reference_id, is_read, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;

  const notifications = data ?? [];
  const actorIds = [...new Set(notifications.map((item) => item.actor_id).filter(Boolean))];
  const messageIds = [...new Set(notifications.filter((item) => item.type === 'new_message').map((item) => item.reference_id).filter(Boolean))];
  const invitedConversationIds = [...new Set(notifications.filter((item) => item.type === 'group_invite').map((item) => item.reference_id).filter(Boolean))];

  const [profilesResult, messagesResult] = await Promise.all([
    actorIds.length
      ? supabase.from('profiles').select('id, name, username, photo_url').in('id', actorIds)
      : Promise.resolve({ data: [], error: null }),
    messageIds.length
      ? supabase.from('messages').select('id, conversation_id').in('id', messageIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [profilesResult, messagesResult]) {
    if (result.error) throw result.error;
  }

  const messageConversationIds = (messagesResult.data ?? []).map((message) => message.conversation_id);
  const conversationIds = [...new Set([...messageConversationIds, ...invitedConversationIds])];
  const conversationsResult = conversationIds.length
    ? await supabase.from('conversations').select('id, name, type').in('id', conversationIds)
    : { data: [], error: null };
  if (conversationsResult.error) throw conversationsResult.error;

  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const messageConversations = new Map((messagesResult.data ?? []).map((message) => [message.id, message.conversation_id]));
  const conversations = new Map((conversationsResult.data ?? []).map((conversation) => [conversation.id, conversation]));

  return notifications.map((item) => {
    const conversationId = item.type === 'new_message'
      ? messageConversations.get(item.reference_id)
      : item.type === 'group_invite' ? item.reference_id : null;
    return {
      ...item,
      actor: profiles.get(item.actor_id),
      conversationId,
      conversation: conversationId ? conversations.get(conversationId) : undefined,
    };
  });
}

export function useNotificationsQuery() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ['notifications', user?.id],
    queryFn: () => fetchNotifications(user.id),
    enabled: Boolean(user?.id),
    retry: 1,
  });
}

function NotificationFeed({ notifications, loading, error, compact = false, onNavigate, onMarkRead, onRequestAction, busyId }) {
  const groups = useMemo(() => {
    const grouped = new Map();
    for (const notification of notifications) {
      const label = getTimeGroup(notification.created_at);
      if (!grouped.has(label)) grouped.set(label, []);
      grouped.get(label).push(notification);
    }
    return [...grouped.entries()];
  }, [notifications]);

  if (loading) {
    return <div className="notification-skeletons">{[1, 2, 3].map((item) => <Skeleton className="people-skeleton" key={item} />)}</div>;
  }
  if (error) {
    return <EmptyState icon={Bell} title="Notifications didn’t load" description={error.message || 'Check your connection and try again.'} />;
  }
  if (!notifications.length) {
    return <EmptyState icon={Bell} title="Nothing new, and that’s okay" description="When something happens with your friends, you’ll find it here." />;
  }

  return groups.map(([group, items]) => (
    <section className="notification-group" key={group}>
      {!compact && <h2 className="notification-group-title">{group}</h2>}
      {items.map((notification) => {
        const Icon = notificationIcon[notification.type] ?? Bell;
        const target = notification.type === 'admin_warning'
          ? '/settings'
          : notification.type === 'friend_request'
          ? '/requests'
          : notification.type === 'request_accepted'
            ? notification.actor?.username ? `/profile/${notification.actor.username}` : '/friends'
            : notification.conversationId ? `/messages/${notification.conversationId}` : '/messages';
        const copy = notification.type === 'group_invite'
          ? `added you to ${notification.conversation?.name || 'a group'}`
          : notificationCopy[notification.type] || 'interacted with you';
        return (
          <article className={`notification-row${notification.is_read ? '' : ' notification-unread'}`} key={notification.id}>
            <Link
              className="notification-row-link"
              to={target}
              onClick={() => {
                onMarkRead(notification.id);
                onNavigate?.();
              }}
            >
              <span className="notification-avatar">
                <Avatar src={notification.actor?.photo_url} name={notification.actor?.name || 'Gather'} size="md" />
                <span className="notification-kind"><Icon size={13} /></span>
              </span>
              <span className="people-row-copy notification-copy">
                <strong>{notification.actor?.name || 'Someone'} {copy}</strong>
                {notification.type === 'new_message' && notification.conversation?.type === 'group' && (
                  <small className="notification-context">{notification.conversation.name}</small>
                )}
                <small>{relativeTime(notification.created_at)}</small>
              </span>
            </Link>
            {notification.type === 'friend_request' && (
              <span className="notification-request-actions">
                <Button size="sm" onClick={() => onRequestAction(notification, true)} loading={busyId === notification.id} aria-label="Accept friend request"><Check size={14} />Accept</Button>
                <Button size="sm" variant="secondary" disabled={Boolean(busyId)} onClick={() => onRequestAction(notification, false)} aria-label="Decline friend request">Decline</Button>
              </span>
            )}
            {!notification.is_read && <i className="unread-dot" aria-label="Unread notification" />}
          </article>
        );
      })}
    </section>
  ));
}

export function NotificationBell({ count = 0 }) {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const [busyId, setBusyId] = useState('');
  const [permission, setPermission] = useState(() => (
    typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
  ));
  const query = useNotificationsQuery();

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    const channel = supabase
      .channel(`notifications-${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'notifications',
        filter: `user_id=eq.${user.id}`,
      }, (payload) => {
        queryClient.invalidateQueries({ queryKey: ['notifications', user.id] });
        queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] });
        if (
          payload.eventType === 'INSERT'
          && payload.new?.type === 'new_message'
          && document.visibilityState === 'hidden'
          && typeof window !== 'undefined'
          && 'Notification' in window
          && window.Notification.permission === 'granted'
        ) {
          const browserNotification = new window.Notification('New message', { body: 'You received a new message.' });
          browserNotification.onclick = async () => {
            window.focus();
            const { data, error } = await supabase
              .from('messages')
              .select('conversation_id')
              .eq('id', payload.new.reference_id)
              .maybeSingle();
            if (error) {
              toast(error.message || 'The conversation could not be opened.');
              return;
            }
            if (data?.conversation_id) navigate(`/messages/${data.conversation_id}`);
            else navigate('/messages');
            browserNotification.close();
          };
        }
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          toast('Live notifications are temporarily unavailable. Refresh to see the latest updates.');
        }
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient, toast, navigate]);

  useEffect(() => {
    function closeOnOutsideClick(event) {
      if (!event.target.closest?.('.notification-menu')) setOpen(false);
    }
    function closeOnEscape(event) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', closeOnOutsideClick);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutsideClick);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, []);

  async function markRead(notificationId) {
    const key = ['notifications', user.id];
    queryClient.setQueryData(key, (current) => current?.map((item) => item.id === notificationId ? { ...item, is_read: true } : item));
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId).eq('user_id', user.id);
    if (error) {
      toast(error.message || 'The notification could not be marked as read.');
      await queryClient.invalidateQueries({ queryKey: key });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] });
  }

  async function markAllRead() {
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    if (error) {
      toast(error.message || 'Notifications could not be marked as read.');
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }),
    ]);
    toast('You’re all caught up.', 'success');
  }

  async function respondToRequest(notification, accept) {
    if (busyId || !notification.actor_id) return;
    setBusyId(notification.id);
    try {
      const { error } = await supabase.rpc('respond_friend_request', {
        requester: notification.actor_id,
        accept,
      });
      if (error) throw error;
      await markRead(notification.id);
      await invalidateFriendshipQueries(queryClient, user.id);
      toast(accept ? `You’re now friends with ${notification.actor?.name || 'this person'}.` : 'Friend request declined.', 'success');
    } catch (error) {
      toast(error.message || 'The friend request could not be updated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications', user.id] }),
        invalidateFriendshipQueries(queryClient, user.id),
      ]);
    } finally {
      setBusyId('');
    }
  }

  async function enableBrowserNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    try {
      const result = await window.Notification.requestPermission();
      setPermission(result);
      if (result === 'granted') toast('Desktop message alerts are enabled.', 'success');
      else toast('Desktop notification permission was not granted.');
    } catch (error) {
      toast(error.message || 'Desktop notifications could not be enabled.');
    }
  }

  const unread = query.data?.filter((notification) => !notification.is_read).length ?? 0;
  return (
    <div className="notification-menu">
      <button
        type="button"
        className={`navbar-icon-link${open || location.pathname === '/notifications' ? ' navbar-icon-active' : ''}`}
        aria-label={`Notifications${count ? `, ${count} unread` : ''}`}
        aria-expanded={open}
        title="Notifications"
        onClick={() => setOpen((current) => !current)}
      >
        <Bell size={19} strokeWidth={1.8} />
        <CountBadge count={count} />
      </button>
      {open && (
        <div className="notification-popover" role="dialog" aria-label="Notifications">
          <div className="notification-popover-header">
            <strong>Notifications</strong>
            {unread > 0 && <button type="button" onClick={markAllRead}><CheckCheck size={14} /> Mark all as read</button>}
          </div>
          {permission === 'default' && (
            <button className="notification-permission" type="button" onClick={enableBrowserNotifications}>Enable desktop message alerts</button>
          )}
          <div className="notification-popover-list">
            <NotificationFeed
              notifications={query.data ?? []}
              loading={query.isLoading}
              error={query.error}
              compact
              onNavigate={() => setOpen(false)}
              onMarkRead={markRead}
              onRequestAction={respondToRequest}
              busyId={busyId}
            />
          </div>
          <Link className="notification-see-all" to="/notifications" onClick={() => setOpen(false)}>See all notifications</Link>
        </div>
      )}
    </div>
  );
}

export function NotificationsPageContent() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState('');
  const query = useNotificationsQuery();
  const notifications = query.data ?? [];
  const unread = notifications.filter((notification) => !notification.is_read);

  async function markRead(notificationId) {
    const key = ['notifications', user.id];
    queryClient.setQueryData(key, (current) => current?.map((item) => item.id === notificationId ? { ...item, is_read: true } : item));
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', notificationId).eq('user_id', user.id);
    if (error) {
      toast(error.message || 'The notification could not be marked as read.');
      await queryClient.invalidateQueries({ queryKey: key });
      return;
    }
    await queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] });
  }

  async function markAllRead() {
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false);
    if (error) {
      toast(error.message || 'Notifications could not be marked as read.');
      return;
    }
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['notifications', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }),
    ]);
    toast('You’re all caught up.', 'success');
  }

  async function respondToRequest(notification, accept) {
    if (busyId || !notification.actor_id) return;
    setBusyId(notification.id);
    try {
      const { error } = await supabase.rpc('respond_friend_request', { requester: notification.actor_id, accept });
      if (error) throw error;
      await markRead(notification.id);
      await invalidateFriendshipQueries(queryClient, user.id);
      toast(accept ? `You’re now friends with ${notification.actor?.name || 'this person'}.` : 'Friend request declined.', 'success');
    } catch (error) {
      toast(error.message || 'The friend request could not be updated.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['notifications', user.id] }),
        invalidateFriendshipQueries(queryClient, user.id),
      ]);
    } finally {
      setBusyId('');
    }
  }

  return (
    <div className="app-page-content">
      <AppPageHeader
        eyebrow="STAY IN THE LOOP"
        title="Notifications"
        description="The little things happening with your people."
        action={unread.length > 0 && <Button variant="secondary" size="sm" onClick={markAllRead}><CheckCheck size={16} /> Mark all as read</Button>}
      />
      <div className="notifications-page-card">
        <NotificationFeed
          notifications={notifications}
          loading={query.isLoading}
          error={query.error}
          onMarkRead={markRead}
          onRequestAction={respondToRequest}
          busyId={busyId}
        />
      </div>
    </div>
  );
}
