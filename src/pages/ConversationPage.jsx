import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, Check, CheckCheck, ImagePlus, LoaderCircle, MoreHorizontal, Send, Smile, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { GroupInfoPanel } from '../components/GroupChatControls';
import { Modal } from '../components/ui/Modal';

const PAGE_SIZE = 30;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

async function fetchConversation(conversationId, userId) {
  const { data: membership, error: membershipError } = await supabase
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .is('left_at', null)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw new Error('This conversation is not available to your account.');

  const [{ data: conversation, error: conversationError }, { data: members, error: membersError }] = await Promise.all([
    supabase.from('conversations').select('id, type, name, photo_url').eq('id', conversationId).single(),
    supabase.from('conversation_members').select('user_id, role, joined_at, left_at, last_read_at').eq('conversation_id', conversationId).is('left_at', null),
  ]);
  for (const result of [{ error: conversationError }, { error: membersError }]) {
    if (result.error) throw result.error;
  }
  const otherIds = [...new Set((members ?? []).map((member) => member.user_id).filter((id) => id !== userId))];
  const profileIds = [...new Set((members ?? []).map((member) => member.user_id))];
  const profilesResponse = profileIds.length
    ? await supabase.from('profiles').select('id, name, username, photo_url, last_seen').in('id', profileIds)
    : { data: [], error: null };
  if (profilesResponse.error) throw profilesResponse.error;

  let canMessage = conversation.type !== 'direct';
  let isBlocked = false;
  if (conversation.type === 'direct' && otherIds[0]) {
    const otherId = otherIds[0];
    const [{ data: friendship, error: friendshipError }, { data: blocks, error: blocksError }] = await Promise.all([
      supabase.from('friendships').select('status').or(`and(requester_id.eq.${userId},addressee_id.eq.${otherId}),and(requester_id.eq.${otherId},addressee_id.eq.${userId})`).maybeSingle(),
      supabase.from('blocks').select('blocker_id').or(`and(blocker_id.eq.${userId},blocked_id.eq.${otherId}),and(blocker_id.eq.${otherId},blocked_id.eq.${userId})`),
    ]);
    if (friendshipError) throw friendshipError;
    if (blocksError) throw blocksError;
    isBlocked = Boolean(blocks?.length);
    canMessage = friendship?.status === 'accepted' && !isBlocked;
  } else if (conversation.type === 'direct') {
    canMessage = false;
  }

  return {
    conversation,
    members: members ?? [],
    profiles: Object.fromEntries((profilesResponse.data ?? []).map((profile) => [profile.id, profile])),
    canMessage,
    isBlocked,
  };
}

async function fetchMessagePage(conversationId, cursor) {
  let request = supabase
    .from('messages')
    .select('id, sender_id, body, image_url, is_system, created_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE);
  if (cursor) request = request.lt('created_at', cursor);
  const { data, error } = await request;
  if (error) throw error;
  const descending = data ?? [];
  return {
    messages: descending.reverse(),
    nextCursor: descending.length === PAGE_SIZE ? descending[0].created_at : undefined,
  };
}

function ChatImage({ path, alt, onImageClick }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!path) return undefined;
    supabase.storage.from('chat-images').createSignedUrl(path, 60 * 60)
      .then(({ data, error: signedUrlError }) => {
        if (!active) return;
        if (signedUrlError) setError(signedUrlError.message);
        else setUrl(data.signedUrl);
      }).catch((signedUrlError) => {
        if (active) setError(signedUrlError.message || 'Image unavailable');
      });
    return () => { active = false; };
  }, [path]);
  if (error) return <span className="chat-image-error">Image unavailable</span>;
  return url
    ? <button className="chat-image-open" type="button" onClick={() => onImageClick(url)} aria-label="Open image">
        <img className="chat-image" src={url} alt={alt} loading="lazy" />
      </button>
    : <span className="chat-image-loading"><LoaderCircle size={16} /></span>;
}

function dayLabel(value) {
  const date = new Date(value);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return new Intl.DateTimeFormat(undefined, { month: 'long', day: 'numeric', year: 'numeric' }).format(date);
}

export function ConversationPage() {
  const { conversationId } = useParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState('');
  const [optimistic, setOptimistic] = useState([]);
  const [pendingImage, setPendingImage] = useState(null);
  const [sending, setSending] = useState(false);
  const [emojiOpen, setEmojiOpen] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [typing, setTyping] = useState(false);
  const [chatVisible, setChatVisible] = useState(document.visibilityState === 'visible');
  const [readError, setReadError] = useState('');
  const [typingError, setTypingError] = useState('');
  const [groupInfoOpen, setGroupInfoOpen] = useState(false);
  const [headerMenuOpen, setHeaderMenuOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState('');
  const headerMenuRef = useRef(null);
  const listRef = useRef(null);
  const bottomRef = useRef(null);
  const channelRef = useRef(null);
  const typingTimerRef = useRef(null);
  const incomingTypingTimerRef = useRef(null);
  const wasAtBottomRef = useRef(true);
  const preserveScrollRef = useRef(null);
  const pageCountRef = useRef(0);
  const imageInputRef = useRef(null);
  const selectedImageUrlRef = useRef(null);
  const chatKey = useMemo(() => ['conversation-messages', conversationId, user?.id], [conversationId, user?.id]);

  const conversationQuery = useQuery({
    queryKey: ['conversation-details', conversationId, user?.id],
    queryFn: () => fetchConversation(conversationId, user.id),
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const messageQuery = useInfiniteQuery({
    queryKey: chatKey,
    queryFn: ({ pageParam }) => fetchMessagePage(conversationId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });

  const serverMessages = useMemo(
    () => [...(messageQuery.data?.pages ?? [])].reverse().flatMap((page) => page.messages),
    [messageQuery.data],
  );
  const messages = useMemo(() => {
    const byId = new Map(serverMessages.map((message) => [message.id, message]));
    optimistic.forEach((message) => byId.set(message.id, message));
    return [...byId.values()].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  }, [serverMessages, optimistic]);
  const otherMembers = conversationQuery.data?.members.filter((member) => member.user_id !== user?.id) ?? [];
  const otherMember = otherMembers[0];
  const otherProfile = otherMember && conversationQuery.data?.profiles[otherMember.user_id];
  const otherOnline = Boolean(otherProfile?.last_seen && Date.now() - new Date(otherProfile.last_seen).getTime() < 5 * 60_000);
  const displayName = conversationQuery.data?.conversation.type === 'group'
    ? conversationQuery.data.conversation.name
    : otherProfile?.name || 'Conversation';

  useEffect(() => {
    if (conversationQuery.isError) toast(conversationQuery.error.message || 'Conversation could not be loaded.');
  }, [conversationQuery.isError, conversationQuery.error, toast]);
  useEffect(() => {
    if (messageQuery.isError) toast(messageQuery.error.message || 'Messages could not be loaded.');
  }, [messageQuery.isError, messageQuery.error, toast]);
  useEffect(() => () => {
    if (selectedImageUrlRef.current) URL.revokeObjectURL(selectedImageUrlRef.current);
    window.clearTimeout(typingTimerRef.current);
    window.clearTimeout(incomingTypingTimerRef.current);
  }, []);

  useEffect(() => {
    function dismissHeaderMenu(event) {
      if (!headerMenuRef.current?.contains(event.target)) setHeaderMenuOpen(false);
    }
    function closeHeaderMenuOnEscape(event) {
      if (event.key === 'Escape') {
        setHeaderMenuOpen(false);
        setLightboxUrl('');
      }
    }
    document.addEventListener('mousedown', dismissHeaderMenu);
    document.addEventListener('keydown', closeHeaderMenuOnEscape);
    return () => {
      document.removeEventListener('mousedown', dismissHeaderMenu);
      document.removeEventListener('keydown', closeHeaderMenuOnEscape);
    };
  }, []);

  const markRead = useCallback(async () => {
    if (!conversationId || !user?.id || document.visibilityState !== 'visible') return;
    const { error } = await supabase.rpc('mark_conversation_read', { conversation: conversationId });
    if (error) {
      setReadError(error.message || 'Messages could not be marked as read.');
      toast(error.message || 'Read status could not be updated.');
      return;
    }
    setReadError('');
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['app-counts', user.id] }),
      queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
    ]);
  }, [conversationId, user?.id, queryClient, toast]);

  useEffect(() => {
    function onVisibility() {
      const visible = document.visibilityState === 'visible';
      setChatVisible(visible);
      if (visible) markRead();
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [markRead]);

  useEffect(() => {
    if (!conversationId || !user?.id || !supabase) return undefined;
    let active = true;
    const channel = supabase.channel(`conversation-${conversationId}`, {
      config: { broadcast: { self: false } },
    });
    channelRef.current = channel;
    channel
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, (payload) => {
        const message = payload.new;
        queryClient.setQueryData(chatKey, (current) => {
          if (!current?.pages?.length) return current;
          if (current.pages.some((page) => page.messages.some((item) => item.id === message.id))) return current;
          return {
            ...current,
            pages: current.pages.map((page, index) => index === 0
              ? { ...page, messages: [...page.messages, message].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }
              : page),
          };
        });
        if (message.sender_id !== user.id && document.visibilityState === 'visible') markRead();
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] });
        if (wasAtBottomRef.current) window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
      })
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversation_members',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-details', conversationId, user.id] }))
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'conversations',
        filter: `id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-details', conversationId, user.id] }))
      .on('broadcast', { event: 'typing' }, ({ payload }) => {
        if (payload?.userId === user.id) return;
        setTyping(Boolean(payload?.typing));
        window.clearTimeout(incomingTypingTimerRef.current);
        if (payload?.typing) incomingTypingTimerRef.current = window.setTimeout(() => setTyping(false), 3000);
      })
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          if (active) setTypingError('Live chat updates are temporarily unavailable.');
        } else if (status === 'SUBSCRIBED') {
          setTypingError('');
        }
      });
    return () => {
      active = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [conversationId, user?.id, queryClient, chatKey, markRead]);

  useEffect(() => {
    if (!conversationId || !user?.id || !chatVisible || !messageQuery.data) return;
    markRead();
  }, [conversationId, user?.id, chatVisible, messageQuery.dataUpdatedAt, markRead]);

  useEffect(() => {
    const pagesCount = messageQuery.data?.pages.length ?? 0;
    if (pagesCount > pageCountRef.current && preserveScrollRef.current !== null && listRef.current) {
      const scroller = listRef.current;
      scroller.scrollTop = scroller.scrollHeight - preserveScrollRef.current;
      preserveScrollRef.current = null;
    } else if (pagesCount > 0 && pageCountRef.current === 0) {
      bottomRef.current?.scrollIntoView({ block: 'end' });
    } else if (wasAtBottomRef.current) {
      bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
    }
    pageCountRef.current = pagesCount;
  }, [messageQuery.data?.pages.length, messages.length]);

  async function loadOlderMessages() {
    const scroller = listRef.current;
    if (!scroller || messageQuery.isFetchingNextPage || !messageQuery.hasNextPage) return;
    preserveScrollRef.current = scroller.scrollHeight;
    await messageQuery.fetchNextPage();
  }

  function handleScroll() {
    const scroller = listRef.current;
    if (!scroller) return;
    wasAtBottomRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 100;
    setShowScrollBottom(!wasAtBottomRef.current);
    if (scroller.scrollTop < 60) loadOlderMessages();
  }

  async function broadcastTyping(isTyping) {
    const channel = channelRef.current;
    if (!channel) return;
    const status = await channel.send({
      type: 'broadcast',
      event: 'typing',
      payload: { userId: user.id, typing: isTyping },
    });
    if (status !== 'ok') {
      setTypingError('Your typing status could not be shared.');
      toast('Your typing status could not be shared.');
    }
  }

  function changeBody(value) {
    setBody(value);
    if (value.trim()) {
      broadcastTyping(true);
      window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => broadcastTyping(false), 3000);
    } else {
      broadcastTyping(false);
    }
  }

  function selectImage(file) {
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      toast('Choose a JPG, PNG, WebP, or GIF image.');
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      toast('Images must be 5 MB or smaller.');
      return;
    }
    if (selectedImageUrlRef.current) URL.revokeObjectURL(selectedImageUrlRef.current);
    const previewUrl = URL.createObjectURL(file);
    selectedImageUrlRef.current = previewUrl;
    setPendingImage({ file, previewUrl, path: '' });
  }

  async function sendMessage(event, retryMessage = null) {
    event?.preventDefault();
    const text = retryMessage?.body ?? body.trim();
    const image = retryMessage?.file ? pendingImage : pendingImage;
    if ((!text && !image) || sending || !conversationQuery.data?.canMessage) return;
    const optimisticId = retryMessage?.id ?? `pending-${crypto.randomUUID()}`;
    const timestamp = retryMessage?.created_at ?? new Date().toISOString();
    const item = retryMessage ?? {
      id: optimisticId,
      sender_id: user.id,
      body: text || null,
      image_url: image?.previewUrl ?? null,
      created_at: timestamp,
      optimistic: true,
      file: image?.file,
      path: image?.path,
    };
    setOptimistic((current) => current.some((message) => message.id === optimisticId)
      ? current.map((message) => message.id === optimisticId ? { ...item, failed: false } : message)
      : [...current, { ...item, failed: false }]);
    setSending(true);
    try {
      let imagePath = item.path || '';
      if (image?.file && !imagePath) {
        const safeName = image.file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
        imagePath = `${user.id}/${conversationId}/${crypto.randomUUID()}-${safeName}`;
        const { error: uploadError } = await supabase.storage.from('chat-images').upload(imagePath, image.file, {
          contentType: image.file.type,
          upsert: false,
        });
        if (uploadError) throw uploadError;
        item.path = imagePath;
        setPendingImage((current) => current ? { ...current, path: imagePath } : current);
      }
      const { data, error } = await supabase.from('messages').insert({
        conversation_id: conversationId,
        sender_id: user.id,
        body: text || null,
        image_url: imagePath || null,
      }).select('id, sender_id, body, image_url, is_system, created_at').single();
      if (error) throw error;
      setOptimistic((current) => current.filter((message) => message.id !== optimisticId));
      queryClient.setQueryData(chatKey, (current) => {
        if (!current?.pages?.length || current.pages.some((page) => page.messages.some((message) => message.id === data.id))) return current;
        return {
          ...current,
          pages: current.pages.map((page, index) => index === 0
            ? { ...page, messages: [...page.messages, data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }
            : page),
        };
      });
      if (!retryMessage) {
        setBody('');
        if (selectedImageUrlRef.current) URL.revokeObjectURL(selectedImageUrlRef.current);
        selectedImageUrlRef.current = null;
        setPendingImage(null);
      } else {
        if (retryMessage.file && selectedImageUrlRef.current === retryMessage.image_url) {
          URL.revokeObjectURL(retryMessage.image_url);
          selectedImageUrlRef.current = null;
          setPendingImage(null);
        }
        if (body.trim() === retryMessage.body) setBody('');
      }
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
        markRead(),
      ]);
      window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } catch (error) {
      if (error.code === '42501' || error.message?.toLowerCase().includes('friend')) {
        await queryClient.invalidateQueries({ queryKey: ['conversation-details', conversationId, user.id] });
        toast('You can no longer message this person.');
      } else {
        toast(error.message || 'Your message could not be sent. You can retry it below.');
      }
      setOptimistic((current) => current.map((message) => message.id === optimisticId ? { ...item, failed: true } : message));
    } finally {
      setSending(false);
    }
  }

  const messageState = conversationQuery.data;

  return (
    <div className="app-page-content conversation-page">
      <header className="chat-header">
        <Link to="/messages" className="chat-back-link" aria-label="Back to messages"><ArrowLeft size={19} /></Link>
        {messageState?.conversation.type === 'group'
          ? <Avatar src={messageState.conversation.photo_url} name={displayName} size="sm" />
          : <Avatar src={otherProfile?.photo_url} name={displayName} size="sm" online={otherOnline} />}
        <span className="chat-header-copy">
          <strong>{displayName}</strong>
          {otherProfile && <small className={typing ? 'chat-header-typing' : otherOnline ? 'chat-header-online' : ''}>
            {typing ? <><span className="chat-status-dot" />Typing…</> : otherOnline ? <><span className="chat-status-dot" />Online</> : `Last seen ${otherProfile.last_seen ? new Date(otherProfile.last_seen).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'a while ago'}`}
          </small>}
          {messageState?.conversation.type === 'group' && <small>{messageState.members.length} members</small>}
        </span>
        <div className="chat-header-menu" ref={headerMenuRef}>
          <Button className="chat-header-more" variant="secondary" size="sm" aria-label="Conversation menu" aria-expanded={headerMenuOpen} onClick={() => setHeaderMenuOpen((open) => !open)}><MoreHorizontal size={19} /></Button>
          {headerMenuOpen && <div className="chat-header-popover">
            {otherProfile?.username && <Link to={`/profile/${otherProfile.username}`} onClick={() => setHeaderMenuOpen(false)}>View profile</Link>}
            {messageState?.conversation.type === 'group' && <button type="button" onClick={() => { setHeaderMenuOpen(false); setGroupInfoOpen(true); }}><UsersRound size={15} /> Group info</button>}
          </div>}
        </div>
      </header>
      {messageQuery.isError && <EmptyState title="Messages unavailable" description={messageQuery.error.message || 'Messages could not be loaded.'} action={<Button size="sm" variant="secondary" onClick={() => messageQuery.refetch()}>Try again</Button>} />}
      {messageState && !messageState.canMessage && <div className="chat-disabled-banner" role="status">{messageState.isBlocked ? 'Messaging is unavailable for this conversation.' : 'You can message this person once they accept your friend request.'}</div>}
      {typingError && <p className="chat-live-warning" role="status">{typingError}</p>}
      {readError && <p className="chat-live-warning" role="status">{readError}</p>}
      <Card className="conversation-card">
        {!messageQuery.data && messageQuery.isLoading && <div className="conversation-loading">Loading conversation…</div>}
        {messageQuery.data && (
          <>
            <div className="conversation-message-list" ref={listRef} onScroll={handleScroll}>
              {messageQuery.hasNextPage && <button type="button" className="load-older-button" onClick={loadOlderMessages} disabled={messageQuery.isFetchingNextPage}>{messageQuery.isFetchingNextPage ? 'Loading earlier messages…' : 'Load earlier messages'}</button>}
              {messages.length === 0 && <EmptyState title="A fresh conversation" description="Say hello and start the conversation." />}
              {messages.map((message, index) => {
                if (message.is_system) {
                  const previous = messages[index - 1];
                  const newDay = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
                  return <div key={message.id}>{newDay && <div className="chat-day-separator"><span>{dayLabel(message.created_at)}</span></div>}<div className="chat-system-message"><span>{message.body}</span><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</time></div></div>;
                }
                const own = message.sender_id === user.id;
                const sender = own ? null : messageState.profiles[message.sender_id];
                const previous = messages[index - 1];
                const next = messages[index + 1];
                const newDay = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
                const groupStart = !previous || previous.is_system || previous.sender_id !== message.sender_id
                  || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
                const groupEnd = !next || next.is_system || next.sender_id !== message.sender_id
                  || new Date(next.created_at).toDateString() !== new Date(message.created_at).toDateString();
                const seen = own && otherMember?.last_read_at && new Date(otherMember.last_read_at) >= new Date(message.created_at);
                return (
                  <div className="chat-message-item" key={message.id}>
                    {newDay && <div className="chat-day-separator"><span>{dayLabel(message.created_at)}</span></div>}
                    <div className={`chat-message${own ? ' chat-message-own' : ''}${groupStart ? ' chat-message-group-start' : ' chat-message-group-continuation'}${groupEnd ? ' chat-message-group-end' : ''}`}>
                      {!own && <Avatar src={sender?.photo_url} name={sender?.name || 'Member'} size="xs" className={!groupStart ? 'chat-group-avatar-hidden' : ''} />}
                      <div className={`chat-message-content${message.failed ? ' chat-message-failed' : ''}`}>
                        {!own && groupStart && <span className="chat-message-sender">{sender?.name || 'Member'}</span>}
                        {message.image_url?.startsWith('blob:')
                          ? <button className="chat-image-open" type="button" onClick={() => setLightboxUrl(message.image_url)} aria-label="Open image"><img className="chat-image" src={message.image_url} alt="Image to send" /></button>
                          : message.image_url && <ChatImage path={message.image_url} alt="Shared image" onImageClick={setLightboxUrl} />}
                        {message.body && <p>{message.body}</p>}
                        <time dateTime={message.created_at}>{new Date(message.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{own && !message.failed && (seen ? <CheckCheck className="chat-receipt-seen" size={15} aria-label="Seen" /> : <Check className="chat-receipt-sent" size={15} aria-label="Sent" />)}</time>
                        {message.failed && <button type="button" className="chat-retry-button" onClick={() => sendMessage(null, message)}>Failed · Retry</button>}
                      </div>
                    </div>
                  </div>
                );
              })}
              {typing && <div className="chat-typing-indicator"><span>{otherProfile?.name || 'Someone'} is typing</span><i /><i /><i /></div>}
              <span ref={bottomRef} />
            </div>
            {showScrollBottom && <button type="button" className="chat-scroll-bottom" aria-label="Scroll to latest message" onClick={() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })}><ArrowDown size={18} /></button>}
            <form className="conversation-compose" onSubmit={sendMessage}>
              {pendingImage && <div className="chat-image-preview"><img src={pendingImage.previewUrl} alt="Selected to send" /><button type="button" aria-label="Remove selected image" onClick={() => { URL.revokeObjectURL(pendingImage.previewUrl); selectedImageUrlRef.current = null; setPendingImage(null); }}><X size={14} /></button></div>}
              <div className="chat-compose-tools">
                <button type="button" className="chat-compose-tool" aria-label="Add image" disabled={!messageState?.canMessage || sending} onClick={() => imageInputRef.current?.click()}><ImagePlus size={18} /></button>
                <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => { selectImage(event.target.files?.[0]); event.target.value = ''; }} />
                <div className="chat-emoji-wrap">
                  <button type="button" className="chat-compose-tool" aria-label="Choose emoji" aria-expanded={emojiOpen} disabled={!messageState?.canMessage} onClick={() => setEmojiOpen((open) => !open)}><Smile size={18} /></button>
                  {emojiOpen && <div className="chat-emoji-popover"><EmojiPicker onEmojiClick={(emoji) => { changeBody(`${body}${emoji.emoji}`); setEmojiOpen(false); }} theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'} height={350} width={300} /></div>}
                </div>
              </div>
              <input aria-label="Write a message" placeholder={messageState?.canMessage ? 'Write a message…' : 'Messaging unavailable'} maxLength={5000} value={body} onChange={(event) => changeBody(event.target.value)} disabled={!messageState?.canMessage || sending} />
              <Button className={`chat-send-button${body.trim() || pendingImage ? ' chat-send-button-visible' : ''}`} type="submit" loading={sending} disabled={(!body.trim() && !pendingImage) || !messageState?.canMessage} aria-label="Send message"><Send size={17} /></Button>
            </form>
          </>
        )}
      </Card>
      {messageState?.conversation.type === 'group' && <GroupInfoPanel
        open={groupInfoOpen}
        onClose={(leftGroup) => {
          setGroupInfoOpen(false);
          if (leftGroup) navigate('/messages', { replace: true });
        }}
        conversation={messageState.conversation}
        members={messageState.members}
        profiles={messageState.profiles}
        userId={user.id}
      />}
      <Modal open={Boolean(lightboxUrl)} onClose={() => setLightboxUrl('')} title="Shared photo" size="lg">
        {lightboxUrl && <div className="chat-lightbox"><img src={lightboxUrl} alt="Shared in conversation" /></div>}
      </Modal>
    </div>
  );
}
