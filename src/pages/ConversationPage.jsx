import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, CalendarDays, CalendarPlus, Check, CheckCheck, Clock3, ImagePlus, LoaderCircle, MapPin, MoreHorizontal, Plus, Send, Smile, UsersRound, X } from 'lucide-react';
import EmojiPicker from 'emoji-picker-react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { GroupInfoPanel } from '../components/GroupChatControls';
import { Modal } from '../components/ui/Modal';
import { useAvailability } from '../hooks/useAvailability';

const PAGE_SIZE = 30;
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const PLAN_RESPONSES = [
  { value: 'going', label: 'Going', shortLabel: 'Going' },
  { value: 'maybe', label: 'Maybe', shortLabel: 'Maybe' },
  { value: 'declined', label: "Can't", shortLabel: "Can't" },
];

async function fetchConversationPlans(conversationId) {
  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('id, conversation_id, created_by, title, description, starts_at, ends_at, location_text, status, created_at')
    .eq('conversation_id', conversationId)
    .order('starts_at', { ascending: true });
  if (plansError) throw plansError;
  const planIds = (plans ?? []).map((plan) => plan.id);
  if (!planIds.length) return { plans: [], responses: [], profiles: {} };

  const { data: responses, error: responsesError } = await supabase
    .from('plan_responses')
    .select('plan_id, user_id, response, updated_at')
    .in('plan_id', planIds);
  if (responsesError) throw responsesError;

  const profileIds = [...new Set([
    ...(plans ?? []).map((plan) => plan.created_by),
    ...(responses ?? []).map((response) => response.user_id),
  ])];
  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('id, name, photo_url, username')
    .in('id', profileIds);
  if (profilesError) throw profilesError;

  return {
    plans: plans ?? [],
    responses: responses ?? [],
    profiles: Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile])),
  };
}

async function fetchConversationPolls(conversationId) {
  const { data: polls, error: pollsError } = await supabase
    .from('time_polls')
    .select('id, conversation_id, created_by, title, location_text, status, closes_at, created_at, plan_id, winning_option_id')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: true });
  if (pollsError) throw pollsError;
  const pollIds = (polls ?? []).map((poll) => poll.id);
  if (!pollIds.length) return { polls: [], options: [], votes: [], profiles: {} };
  const { data: options, error: optionsError } = await supabase
    .from('poll_options').select('id, poll_id, starts_at').in('poll_id', pollIds).order('starts_at');
  if (optionsError) throw optionsError;
  const optionIds = (options ?? []).map((option) => option.id);
  const { data: votes, error: votesError } = optionIds.length
    ? await supabase.from('poll_votes').select('option_id, user_id, vote, updated_at').in('option_id', optionIds)
    : { data: [], error: null };
  if (votesError) throw votesError;
  const profileIds = [...new Set([...(polls ?? []).map((poll) => poll.created_by), ...(votes ?? []).map((vote) => vote.user_id)])];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from('profiles').select('id, name, photo_url, username').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;
  return {
    polls: polls ?? [],
    options: options ?? [],
    votes: votes ?? [],
    profiles: Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile])),
  };
}

function localDateTimeValue(value) {
  if (!value) return '';
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function formatPlanDate(value) {
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatCountdown(value, now) {
  const minutes = Math.max(0, Math.floor((new Date(value).getTime() - now) / 60_000));
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);
  const remainder = minutes % 60;
  if (days) return `in ${days}d ${hours}h`;
  if (hours) return `in ${hours}h ${remainder}m`;
  return `in ${remainder}m`;
}

function icsEscape(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/\r?\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function downloadPlanCalendarFile(plan) {
  const toUtc = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Gather//Plans//EN',
    'BEGIN:VEVENT',
    `UID:${plan.id}@gather`,
    `DTSTAMP:${toUtc(new Date().toISOString())}`,
    `DTSTART:${toUtc(plan.starts_at)}`,
    ...(plan.ends_at ? [`DTEND:${toUtc(plan.ends_at)}`] : []),
    `SUMMARY:${icsEscape(plan.title)}`,
    ...(plan.description ? [`DESCRIPTION:${icsEscape(plan.description)}`] : []),
    ...(plan.location_text ? [`LOCATION:${icsEscape(plan.location_text)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  const file = new Blob([`${lines.join('\r\n')}\r\n`], { type: 'text/calendar;charset=utf-8' });
  const fileUrl = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = `${plan.title.trim().replace(/[^a-z0-9_-]+/gi, '-') || 'gather-plan'}.ics`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(fileUrl);
}

function PlanMessageCard({ plan, responses, profiles, currentUserId, canRespond, responseBusy, onOpen, onRespond }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  const going = responses.filter((response) => response.response === 'going');
  const maybe = responses.filter((response) => response.response === 'maybe');
  const currentResponse = responses.find((response) => response.user_id === currentUserId)?.response;
  const attendees = going.slice(0, 5).map((response) => profiles[response.user_id]).filter(Boolean);

  return (
    <article className={`chat-plan-card${plan.status === 'cancelled' ? ' chat-plan-card-cancelled' : ''}`}>
      <button type="button" className="chat-plan-open" onClick={onOpen} aria-label={`Open plan: ${plan.title}`}>
        <span className="chat-plan-card-heading">
          <span className="chat-plan-icon"><CalendarPlus size={18} /></span>
          <span><strong>{plan.title}</strong><small>{plan.status === 'cancelled' ? 'Cancelled' : `${formatPlanDate(plan.starts_at)} · ${formatCountdown(plan.starts_at, now)}`}</small></span>
          {plan.status === 'cancelled' && <span className="chat-plan-cancelled-badge">Cancelled</span>}
        </span>
        {plan.location_text && <span className="chat-plan-meta"><MapPin size={14} />{plan.location_text}</span>}
        {!plan.location_text && <span className="chat-plan-meta"><Clock3 size={14} />{plan.ends_at ? `Ends ${new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(plan.ends_at))}` : 'Open-ended plan'}</span>}
        <span className="chat-plan-attendee-line">
          <span className="chat-plan-avatar-stack" aria-label={`${going.length} going`}>
            {attendees.map((profile) => <Avatar key={profile.id} src={profile.photo_url} name={profile.name} size="xs" />)}
          </span>
          <span>{going.length} going · {maybe.length} maybe</span>
        </span>
      </button>
      {plan.status === 'active' && (
        <div className="chat-plan-responses" aria-label="Respond to plan">
          {PLAN_RESPONSES.map(({ value, shortLabel }) => (
            <button
              type="button"
              key={value}
              className={`chat-plan-response${currentResponse === value ? ' chat-plan-response-selected' : ''}`}
              onClick={() => onRespond(value)}
              disabled={!canRespond || responseBusy}
              aria-pressed={currentResponse === value}
            >{shortLabel}</button>
          ))}
        </div>
      )}
    </article>
  );
}

function PollMessageCard({ poll, options, votes, profiles, currentUserId, canManage, canAct, busy, onVote, onClose, onOpenPlan }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const pollOpen = poll.status === 'open' && (!poll.closes_at || new Date(poll.closes_at).getTime() > now);
  const maxYes = Math.max(0, ...options.map((option) => votes.filter((vote) => vote.option_id === option.id && vote.vote === 'yes').length));
  const leadingOptionId = poll.winning_option_id ?? [...options].sort((first, second) => {
    const yesDifference = votes.filter((vote) => vote.option_id === second.id && vote.vote === 'yes').length
      - votes.filter((vote) => vote.option_id === first.id && vote.vote === 'yes').length;
    return yesDifference || new Date(first.starts_at) - new Date(second.starts_at);
  })[0]?.id;
  return (
    <article className={`chat-poll-card${poll.status === 'closed' ? ' chat-poll-card-closed' : ''}`}>
      <div className="chat-poll-heading"><span className="chat-plan-icon"><CalendarDays size={17} /></span><span><strong>{poll.title}</strong><small>{poll.status === 'closed' ? 'Poll closed' : pollOpen && poll.closes_at ? `Closes ${formatPlanDate(poll.closes_at)}` : pollOpen ? 'Choose a time' : 'Closing automatically…'}</small></span></div>
      {poll.location_text && <p className="chat-plan-meta"><MapPin size={14} />{poll.location_text}</p>}
      <div className="chat-poll-options">
        {options.map((option) => {
          const optionVotes = votes.filter((vote) => vote.option_id === option.id);
          const yesCount = optionVotes.filter((vote) => vote.vote === 'yes').length;
          const maybeCount = optionVotes.filter((vote) => vote.vote === 'maybe').length;
          const mine = optionVotes.find((vote) => vote.user_id === currentUserId);
          const voters = optionVotes.map((vote) => profiles[vote.user_id]).filter(Boolean).slice(0, 4);
          return (
            <div className={`chat-poll-option${option.id === leadingOptionId ? ' chat-poll-option-leading' : ''}`} key={option.id}>
              <div className="chat-poll-option-top"><strong>{formatPlanDate(option.starts_at)}</strong><span>{yesCount} yes · {maybeCount} maybe</span></div>
              {option.id === poll.winning_option_id && <small className="chat-poll-winning-label">Selected time</small>}
              <div className="chat-poll-vote-track"><span style={{ width: `${maxYes ? Math.min(100, (yesCount / maxYes) * 100) : 0}%` }} /></div>
              <div className="chat-poll-option-bottom">
                <span className="chat-plan-avatar-stack">{voters.map((profile) => <Avatar key={profile.id} src={profile.photo_url} name={profile.name} size="xs" />)}</span>
                {pollOpen && canAct && new Date(option.starts_at).getTime() > now && <span className="chat-poll-vote-actions">
                  <button type="button" aria-pressed={mine?.vote === 'yes'} disabled={busy} onClick={() => onVote(option.id, mine?.vote === 'yes' ? null : 'yes')}>Yes</button>
                  <button type="button" aria-pressed={mine?.vote === 'maybe'} disabled={busy} onClick={() => onVote(option.id, mine?.vote === 'maybe' ? null : 'maybe')}>Maybe</button>
                </span>}
              </div>
            </div>
          );
        })}
      </div>
      {poll.status === 'closed' && poll.winning_option_id && <small className="chat-poll-closed-note">Winning time: {formatPlanDate(options.find((option) => option.id === poll.winning_option_id)?.starts_at)}</small>}
      {poll.status === 'closed' && (poll.plan_id
        ? <button className="chat-poll-plan-link" type="button" onClick={() => onOpenPlan(poll.plan_id)}>View the plan</button>
        : <small className="chat-poll-closed-note">No upcoming time remained; no plan was created.</small>)}
      {poll.status === 'open' && canManage && canAct && <Button size="sm" variant="secondary" disabled={busy} onClick={() => onClose(poll.id)}>Close and create plan</Button>}
    </article>
  );
}

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
    .select('id, sender_id, body, image_url, is_system, message_type, plan_id, created_at')
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
  const location = useLocation();
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
  const [planMenuOpen, setPlanMenuOpen] = useState(false);
  const [createPlanOpen, setCreatePlanOpen] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [editingPlan, setEditingPlan] = useState(false);
  const [planSaving, setPlanSaving] = useState(false);
  const [planActionError, setPlanActionError] = useState('');
  const [planResponseBusy, setPlanResponseBusy] = useState('');
  const [planTitle, setPlanTitle] = useState('');
  const [planDescription, setPlanDescription] = useState('');
  const [planLocation, setPlanLocation] = useState('');
  const [planStart, setPlanStart] = useState('');
  const [planEnd, setPlanEnd] = useState('');
  const [createPollOpen, setCreatePollOpen] = useState(false);
  const [gatherOffer, setGatherOffer] = useState(false);
  const [pollTitle, setPollTitle] = useState('');
  const [pollLocation, setPollLocation] = useState('');
  const [pollClosesAt, setPollClosesAt] = useState('');
  const [pollOptions, setPollOptions] = useState([]);
  const [pollError, setPollError] = useState('');
  const [pollBusy, setPollBusy] = useState('');
  const [inviteCircleId, setInviteCircleId] = useState('');
  const [nudgeBusy, setNudgeBusy] = useState(false);
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
  useEffect(() => {
    if (!location.state?.draftMessage || !conversationQuery.data?.canMessage) return;
    setBody(location.state.draftMessage);
    setGatherOffer(Boolean(location.state.offerPlan));
    navigate(location.pathname, { replace: true, state: null });
  }, [location.state, location.pathname, conversationQuery.data?.canMessage, navigate]);
  const messageQuery = useInfiniteQuery({
    queryKey: chatKey,
    queryFn: ({ pageParam }) => fetchMessagePage(conversationId, pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const plansQuery = useQuery({
    queryKey: ['conversation-plans', conversationId, user?.id],
    queryFn: () => fetchConversationPlans(conversationId),
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const pollsQuery = useQuery({
    queryKey: ['conversation-polls', conversationId, user?.id],
    queryFn: () => fetchConversationPolls(conversationId),
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const circlesQuery = useQuery({
    queryKey: ['circles', user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.from('circles').select('id, name').eq('owner_id', user.id).order('created_at');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id),
    retry: 1,
  });
  const planActionQuery = useQuery({
    queryKey: ['plan-actionable', conversationId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase.rpc('can_act_in_plan_conversation', { target_conversation: conversationId });
      if (error) throw error;
      return Boolean(data);
    },
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const { friends: availabilityFriends } = useAvailability();

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
  const otherAvailability = availabilityFriends.data?.find((friend) => friend.user_id === otherMember?.user_id);
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
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'plans',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'plan_responses',
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'time_polls',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-polls', conversationId, user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'poll_options',
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-polls', conversationId, user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'poll_votes',
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-polls', conversationId, user.id] }))
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
      }).select('id, sender_id, body, image_url, is_system, message_type, plan_id, created_at').single();
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

  function resetPlanForm() {
    setPlanTitle('');
    setPlanDescription('');
    setPlanLocation('');
    setPlanStart('');
    setPlanEnd('');
    setInviteCircleId('');
    setPlanActionError('');
  }

  async function submitPlan(event) {
    event.preventDefault();
    if (planSaving) return;
    const startsAt = new Date(planStart);
    const endsAt = planEnd ? new Date(planEnd) : null;
    if (!planTitle.trim()) {
      setPlanActionError('Add a title for this plan.');
      return;
    }
    if (!planStart || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setPlanActionError('Choose a start time in the future.');
      return;
    }
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) {
      setPlanActionError('The end time must be after the start time.');
      return;
    }

    setPlanSaving(true);
    setPlanActionError('');
    try {
      let targetConversationId = conversationId;
      if (inviteCircleId) {
        const { data, error } = await supabase.rpc('create_circle_plan', {
          p_circle_id: inviteCircleId,
          p_title: planTitle.trim(),
          p_description: planDescription.trim() || null,
          p_starts_at: startsAt.toISOString(),
          p_ends_at: endsAt?.toISOString() ?? null,
          p_location_text: planLocation.trim() || null,
        });
        if (error) throw error;
        if (!data) throw new Error('The circle conversation could not be created.');
        targetConversationId = data;
      } else {
        const { error } = await supabase.rpc('create_plan', {
          p_conversation_id: conversationId,
          p_title: planTitle.trim(),
          p_description: planDescription.trim() || null,
          p_starts_at: startsAt.toISOString(),
          p_ends_at: endsAt?.toISOString() ?? null,
          p_location_text: planLocation.trim() || null,
        });
        if (error) throw error;
      }
      setCreatePlanOpen(false);
      resetPlanForm();
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] }),
        queryClient.invalidateQueries({ queryKey: chatKey }),
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
      ]);
      if (targetConversationId !== conversationId) navigate(`/messages/${targetConversationId}`);
      toast('Plan created.', 'success');
    } catch (error) {
      const message = error.message || 'The plan could not be created.';
      setPlanActionError(message);
      toast(message);
    } finally {
      setPlanSaving(false);
    }
  }

  async function respondToPlan(planId, response) {
    if (planResponseBusy) return;
    setPlanResponseBusy(planId);
    setPlanActionError('');
    try {
      const { error } = await supabase.rpc('respond_to_plan', {
        p_plan_id: planId,
        p_response: response,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] });
    } catch (error) {
      const message = error.message || 'Your response could not be saved.';
      setPlanActionError(message);
      toast(message);
    } finally {
      setPlanResponseBusy('');
    }
  }

  function resetPollForm() {
    setPollTitle('');
    setPollLocation('');
    setPollClosesAt('');
    setPollOptions([
      localDateTimeValue(new Date(Date.now() + 60 * 60_000).toISOString()),
      localDateTimeValue(new Date(Date.now() + 2 * 60 * 60_000).toISOString()),
    ]);
    setPollError('');
  }

  async function submitPoll(event) {
    event.preventDefault();
    if (pollBusy) return;
    const optionTimes = pollOptions.map((value) => new Date(value));
    if (!pollTitle.trim() || pollOptions.length < 2 || pollOptions.length > 6
      || optionTimes.some((date) => Number.isNaN(date.getTime()) || date.getTime() <= Date.now())
      || new Set(optionTimes.map((date) => date.getTime())).size !== optionTimes.length) {
      setPollError('Add a title and choose 2–6 unique times in the future.');
      return;
    }
    const closesAt = pollClosesAt ? new Date(pollClosesAt) : null;
    if (closesAt && (Number.isNaN(closesAt.getTime()) || closesAt.getTime() <= Date.now())) {
      setPollError('The closing time must be in the future.');
      return;
    }
    setPollBusy('create');
    setPollError('');
    try {
      const { error } = await supabase.rpc('create_time_poll', {
        p_conversation_id: conversationId,
        p_title: pollTitle.trim(),
        p_location_text: pollLocation.trim() || null,
        p_options: optionTimes.map((date) => date.toISOString()),
        p_closes_at: closesAt?.toISOString() ?? null,
      });
      if (error) throw error;
      setCreatePollOpen(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversation-polls', conversationId, user.id] }),
        queryClient.invalidateQueries({ queryKey: chatKey }),
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
      ]);
      toast('Availability poll created.', 'success');
    } catch (error) {
      setPollError(error.message || 'The poll could not be created.');
      toast(error.message || 'The poll could not be created.');
    } finally {
      setPollBusy('');
    }
  }

  async function voteOnPollOption(optionId, vote) {
    if (pollBusy) return;
    setPollBusy(optionId);
    try {
      const { error } = await supabase.rpc('vote_on_option', { p_option_id: optionId, p_vote: vote });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['conversation-polls', conversationId, user.id] });
    } catch (error) {
      toast(error.message || 'Your vote could not be saved.');
    } finally {
      setPollBusy('');
    }
  }

  async function closeTimePoll(pollId) {
    if (pollBusy) return;
    setPollBusy(pollId);
    try {
      const { data: createdPlanId, error } = await supabase.rpc('close_poll', { p_poll_id: pollId });
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversation-polls', conversationId, user.id] }),
        queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] }),
        queryClient.invalidateQueries({ queryKey: chatKey }),
      ]);
      toast(createdPlanId ? 'Poll closed and plan created.' : 'Poll closed; no upcoming time remained to plan.', 'success');
    } catch (error) {
      toast(error.message || 'The poll could not be closed.');
    } finally {
      setPollBusy('');
    }
  }

  function beginPlanEdit(plan) {
    setPlanTitle(plan.title);
    setPlanDescription(plan.description ?? '');
    setPlanLocation(plan.location_text ?? '');
    setPlanStart(localDateTimeValue(plan.starts_at));
    setPlanEnd(localDateTimeValue(plan.ends_at));
    setPlanActionError('');
    setEditingPlan(true);
  }

  async function savePlanEdit(event) {
    event.preventDefault();
    if (!selectedPlan || planSaving) return;
    const startsAt = new Date(planStart);
    const endsAt = planEnd ? new Date(planEnd) : null;
    if (!planTitle.trim() || !planStart || Number.isNaN(startsAt.getTime()) || startsAt.getTime() <= Date.now()) {
      setPlanActionError('Add a title and choose a start time in the future.');
      return;
    }
    if (endsAt && (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt)) {
      setPlanActionError('The end time must be after the start time.');
      return;
    }
    setPlanSaving(true);
    setPlanActionError('');
    try {
      const { error } = await supabase.rpc('update_plan', {
        p_plan_id: selectedPlan.id,
        p_title: planTitle.trim(),
        p_description: planDescription.trim() || null,
        p_starts_at: startsAt.toISOString(),
        p_ends_at: endsAt?.toISOString() ?? null,
        p_location_text: planLocation.trim() || null,
      });
      if (error) throw error;
      setEditingPlan(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] }),
        queryClient.invalidateQueries({ queryKey: chatKey }),
      ]);
      toast('Plan updated.', 'success');
    } catch (error) {
      const message = error.message || 'The plan could not be updated.';
      setPlanActionError(message);
      toast(message);
    } finally {
      setPlanSaving(false);
    }
  }

  async function cancelSelectedPlan() {
    if (!selectedPlan || planSaving || !window.confirm(`Cancel "${selectedPlan.title}"?`)) return;
    setPlanSaving(true);
    setPlanActionError('');
    try {
      const { error } = await supabase.rpc('cancel_plan', { p_plan_id: selectedPlan.id });
      if (error) throw error;
      setEditingPlan(false);
      await queryClient.invalidateQueries({ queryKey: ['conversation-plans', conversationId, user.id] });
      toast('Plan cancelled.', 'success');
    } catch (error) {
      const message = error.message || 'The plan could not be cancelled.';
      setPlanActionError(message);
      toast(message);
    } finally {
      setPlanSaving(false);
    }

    async function nudgeUnconfirmed() {
      if (!selectedPlan || nudgeBusy) return;
      setNudgeBusy(true);
      try {
        const { data, error } = await supabase.rpc('nudge_unconfirmed', { p_plan_id: selectedPlan.id });
        if (error) throw error;
        toast(`Nudge sent to ${data} ${data === 1 ? 'person' : 'people'}.`, 'success');
      } catch (error) {
        toast(error.message || 'Unconfirmed members could not be nudged.');
      } finally {
        setNudgeBusy(false);
      }
    }
  }

  const messageState = conversationQuery.data;
  const planData = plansQuery.data;
  const pollData = pollsQuery.data;
  const selectedPlan = planData?.plans.find((plan) => plan.id === selectedPlanId);
  const currentMemberRole = messageState?.members.find((member) => member.user_id === user?.id)?.role;
  const canManageSelectedPlan = Boolean(selectedPlan && (
    planActionQuery.data && (selectedPlan.created_by === user?.id
    || (messageState?.conversation.type === 'group' && currentMemberRole === 'admin')
    )
  ));

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
            {typing ? <><span className="chat-status-dot" />Typing…</> : otherAvailability ? `${otherAvailability.state.replace('_', ' ')}${otherAvailability.note ? ` · ${otherAvailability.note}` : ''}` : otherOnline ? <><span className="chat-status-dot" />Online</> : `Last seen ${otherProfile.last_seen ? new Date(otherProfile.last_seen).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : 'a while ago'}`}
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
      {plansQuery.isError && <div className="chat-plan-live-warning" role="alert"><span>{plansQuery.error.message || 'Plans could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => plansQuery.refetch()}>Try again</Button></div>}
      {plansQuery.isLoading && <p className="chat-plan-loading" role="status">Loading plans…</p>}
      {pollsQuery.isError && <div className="chat-plan-live-warning" role="alert"><span>{pollsQuery.error.message || 'Polls could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => pollsQuery.refetch()}>Try again</Button></div>}
      {planActionError && !createPlanOpen && !selectedPlanId && <p className="chat-plan-live-warning" role="alert">{planActionError}</p>}
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
                if (message.message_type === 'poll' && message.poll_id) {
                  const poll = pollData?.polls.find((item) => item.id === message.poll_id);
                  if (!poll && pollsQuery.isLoading) return <div className="chat-plan-loading" key={message.id} role="status">Loading poll…</div>;
                  if (!poll) return <div className="chat-plan-unavailable" key={message.id} role="status">This poll is unavailable.</div>;
                  const options = pollData.options.filter((option) => option.poll_id === poll.id);
                  const optionIds = options.map((option) => option.id);
                  const votes = pollData.votes.filter((vote) => optionIds.includes(vote.option_id));
                  const canManagePoll = poll.created_by === user.id || (messageState?.conversation.type === 'group' && currentMemberRole === 'admin');
                  const newDay = !messages[index - 1] || new Date(messages[index - 1].created_at).toDateString() !== new Date(message.created_at).toDateString();
                  return (
                    <div className="chat-message-item" key={message.id}>
                      {newDay && <div className="chat-day-separator"><span>{dayLabel(message.created_at)}</span></div>}
                      <PollMessageCard
                        poll={poll}
                        options={options}
                        votes={votes}
                        profiles={pollData.profiles}
                        currentUserId={user.id}
                        canManage={canManagePoll && Boolean(planActionQuery.data)}
                        canAct={Boolean(planActionQuery.data)}
                        busy={Boolean(pollBusy)}
                        onVote={voteOnPollOption}
                        onClose={closeTimePoll}
                        onOpenPlan={(planId) => { setSelectedPlanId(planId); setEditingPlan(false); }}
                      />
                    </div>
                  );
                }
                if (message.message_type === 'plan' && message.plan_id) {
                  const plan = planData?.plans.find((item) => item.id === message.plan_id);
                  const planResponses = planData?.responses.filter((item) => item.plan_id === message.plan_id) ?? [];
                  const newDay = !messages[index - 1] || new Date(messages[index - 1].created_at).toDateString() !== new Date(message.created_at).toDateString();
                  if (!plan && plansQuery.isLoading) {
                    return <div className="chat-plan-loading" key={message.id} role="status">Loading plan…</div>;
                  }
                  if (!plan) {
                    return <div className="chat-plan-unavailable" key={message.id} role="status">This plan is unavailable.</div>;
                  }
                  return (
                    <div className="chat-message-item" key={message.id}>
                      {newDay && <div className="chat-day-separator"><span>{dayLabel(message.created_at)}</span></div>}
                      <PlanMessageCard
                        plan={plan}
                        responses={planResponses}
                        profiles={planData.profiles}
                        currentUserId={user.id}
                        canRespond={Boolean(messageState?.canMessage && planActionQuery.data && plan.status === 'active' && new Date(plan.starts_at) > new Date())}
                        responseBusy={planResponseBusy === plan.id}
                        onOpen={() => {
                          setSelectedPlanId(plan.id);
                          setEditingPlan(false);
                          setPlanActionError('');
                        }}
                        onRespond={(response) => respondToPlan(plan.id, response)}
                      />
                    </div>
                  );
                }
                const own = message.sender_id === user.id;
                const sender = own ? null : messageState.profiles[message.sender_id];
                const previous = messages[index - 1];
                const next = messages[index + 1];
                const newDay = !previous || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
                const groupStart = !previous || previous.is_system || previous.sender_id !== message.sender_id
                  || previous.message_type === 'plan'
                  || new Date(previous.created_at).toDateString() !== new Date(message.created_at).toDateString();
                const groupEnd = !next || next.is_system || next.sender_id !== message.sender_id
                  || next.message_type === 'plan'
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
            {gatherOffer && <div className="chat-gather-offer"><span>Want to make it a plan?</span><Button size="sm" onClick={() => { resetPlanForm(); setCreatePlanOpen(true); setGatherOffer(false); }}>Create a plan</Button><button type="button" aria-label="Dismiss plan suggestion" onClick={() => setGatherOffer(false)}><X size={14} /></button></div>}
            <form className="conversation-compose" onSubmit={sendMessage}>
              {pendingImage && <div className="chat-image-preview"><img src={pendingImage.previewUrl} alt="Selected to send" /><button type="button" aria-label="Remove selected image" onClick={() => { URL.revokeObjectURL(pendingImage.previewUrl); selectedImageUrlRef.current = null; setPendingImage(null); }}><X size={14} /></button></div>}
              <div className="chat-compose-tools">
                <div className="chat-plan-menu-wrap">
                  <button type="button" className="chat-compose-tool" aria-label="More message options" aria-expanded={planMenuOpen} disabled={!messageState?.canMessage || !planActionQuery.data || sending} onClick={() => setPlanMenuOpen((open) => !open)}><Plus size={19} /></button>
                  {planMenuOpen && <div className="chat-plan-menu">
                    <button type="button" onClick={() => { setPlanMenuOpen(false); resetPlanForm(); setCreatePlanOpen(true); }}><CalendarPlus size={16} />Create plan</button>
                    <button type="button" onClick={() => { setPlanMenuOpen(false); resetPollForm(); setCreatePollOpen(true); }}><CalendarDays size={16} />Create availability poll</button>
                  </div>}
                </div>
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
      <Modal open={createPlanOpen} onClose={() => { if (!planSaving) { setCreatePlanOpen(false); setPlanActionError(''); } }} title="Create a plan">
        <form className="chat-plan-form" onSubmit={submitPlan}>
          <label className="chat-plan-field"><span>Title</span><input className="ui-input" value={planTitle} maxLength={120} onChange={(event) => setPlanTitle(event.target.value)} required autoFocus /></label>
          {circlesQuery.isError && <p className="chat-plan-form-error" role="alert">{circlesQuery.error.message || 'Circles could not be loaded.'}</p>}
          {circlesQuery.data?.length > 0 && <label className="chat-plan-field"><span>Invite a circle <small>Optional</small></span><select className="ui-input" value={inviteCircleId} onChange={(event) => setInviteCircleId(event.target.value)}><option value="">Keep this plan in the current chat</option>{circlesQuery.data.map((circle) => <option value={circle.id} key={circle.id}>{circle.name}</option>)}</select></label>}
          <label className="chat-plan-field"><span>Start</span><input className="ui-input" type="datetime-local" value={planStart} min={localDateTimeValue(new Date(Date.now() + 60_000).toISOString())} onChange={(event) => setPlanStart(event.target.value)} required /></label>
          <label className="chat-plan-field"><span>End time <small>Optional</small></span><input className="ui-input" type="datetime-local" value={planEnd} min={planStart || undefined} onChange={(event) => setPlanEnd(event.target.value)} /></label>
          <label className="chat-plan-field"><span>Place <small>Optional</small></span><input className="ui-input" value={planLocation} maxLength={300} onChange={(event) => setPlanLocation(event.target.value)} /></label>
          <label className="chat-plan-field"><span>Note <small>Optional</small></span><textarea className="ui-input" rows={3} value={planDescription} maxLength={2000} onChange={(event) => setPlanDescription(event.target.value)} /></label>
          {planActionError && <p className="chat-plan-form-error" role="alert">{planActionError}</p>}
          <div className="ui-modal-actions">
            <Button variant="secondary" type="button" onClick={() => setCreatePlanOpen(false)} disabled={planSaving}>Cancel</Button>
            <Button type="submit" loading={planSaving}>Create plan</Button>
          </div>
        </form>
      </Modal>
      <Modal open={createPollOpen} onClose={() => { if (!pollBusy) { setCreatePollOpen(false); setPollError(''); } }} title="Create availability poll">
        <form className="chat-plan-form" onSubmit={submitPoll}>
          <label className="chat-plan-field"><span>Title</span><input className="ui-input" value={pollTitle} maxLength={120} onChange={(event) => setPollTitle(event.target.value)} required autoFocus /></label>
          <label className="chat-plan-field"><span>Place <small>Optional</small></span><input className="ui-input" value={pollLocation} maxLength={300} onChange={(event) => setPollLocation(event.target.value)} /></label>
          <fieldset className="poll-option-editor"><legend>Possible times (2–6)</legend>
            {pollOptions.map((value, index) => <div className="poll-option-editor-row" key={index}>
              <label className="chat-plan-field"><span>Option {index + 1}</span><input className="ui-input" type="datetime-local" min={localDateTimeValue(new Date(Date.now() + 60_000).toISOString())} value={value} onChange={(event) => setPollOptions((current) => current.map((item, itemIndex) => itemIndex === index ? event.target.value : item))} required /></label>
              {pollOptions.length > 2 && <button className="poll-remove-option" type="button" aria-label={`Remove option ${index + 1}`} onClick={() => setPollOptions((current) => current.filter((_, itemIndex) => itemIndex !== index))}><X size={15} /></button>}
            </div>)}
            {pollOptions.length < 6 && <Button type="button" size="sm" variant="secondary" onClick={() => setPollOptions((current) => [...current, localDateTimeValue(new Date(Date.now() + (current.length + 1) * 60 * 60_000).toISOString())])}><Plus size={14} /> Add a time</Button>}
          </fieldset>
          <label className="chat-plan-field"><span>Poll closes <small>Optional</small></span><input className="ui-input" type="datetime-local" min={localDateTimeValue(new Date(Date.now() + 60_000).toISOString())} value={pollClosesAt} onChange={(event) => setPollClosesAt(event.target.value)} /></label>
          {pollError && <p className="chat-plan-form-error" role="alert">{pollError}</p>}
          <div className="ui-modal-actions">
            <Button variant="secondary" type="button" onClick={() => setCreatePollOpen(false)} disabled={Boolean(pollBusy)}>Cancel</Button>
            <Button type="submit" loading={pollBusy === 'create'}>Create poll</Button>
          </div>
        </form>
      </Modal>
      <Modal
        open={Boolean(selectedPlanId)}
        onClose={() => { if (!planSaving) { setSelectedPlanId(''); setEditingPlan(false); setPlanActionError(''); } }}
        title={editingPlan ? 'Edit plan' : selectedPlan?.title || 'Plan details'}
        size="md"
        className="chat-plan-drawer"
        backdropClassName="chat-plan-drawer-backdrop"
      >
        {plansQuery.isLoading && <div className="conversation-loading">Loading plan details…</div>}
        {plansQuery.isError && <div className="chat-plan-detail-error" role="alert"><p>{plansQuery.error.message || 'Plan details could not be loaded.'}</p><Button size="sm" variant="secondary" onClick={() => plansQuery.refetch()}>Try again</Button></div>}
        {!plansQuery.isLoading && !plansQuery.isError && !selectedPlan && <p className="chat-plan-detail-empty">This plan is no longer available.</p>}
        {selectedPlan && editingPlan && (
          <form className="chat-plan-form" onSubmit={savePlanEdit}>
            <label className="chat-plan-field"><span>Title</span><input className="ui-input" value={planTitle} maxLength={120} onChange={(event) => setPlanTitle(event.target.value)} required /></label>
            <label className="chat-plan-field"><span>Start</span><input className="ui-input" type="datetime-local" value={planStart} min={localDateTimeValue(new Date(Date.now() + 60_000).toISOString())} onChange={(event) => setPlanStart(event.target.value)} required /></label>
            <label className="chat-plan-field"><span>End time <small>Optional</small></span><input className="ui-input" type="datetime-local" value={planEnd} min={planStart || undefined} onChange={(event) => setPlanEnd(event.target.value)} /></label>
            <label className="chat-plan-field"><span>Place <small>Optional</small></span><input className="ui-input" value={planLocation} maxLength={300} onChange={(event) => setPlanLocation(event.target.value)} /></label>
            <label className="chat-plan-field"><span>Note <small>Optional</small></span><textarea className="ui-input" rows={3} value={planDescription} maxLength={2000} onChange={(event) => setPlanDescription(event.target.value)} /></label>
            {planActionError && <p className="chat-plan-form-error" role="alert">{planActionError}</p>}
            <div className="ui-modal-actions">
              <Button variant="secondary" type="button" onClick={() => setEditingPlan(false)} disabled={planSaving}>Back</Button>
              <Button type="submit" loading={planSaving}>Save changes</Button>
            </div>
          </form>
        )}
        {selectedPlan && !editingPlan && (
          <div className="chat-plan-details">
            <p className={`chat-plan-detail-status${selectedPlan.status === 'cancelled' ? ' is-cancelled' : ''}`}>{selectedPlan.status === 'cancelled' ? 'Cancelled' : formatPlanDate(selectedPlan.starts_at)}</p>
            {selectedPlan.ends_at && <p className="chat-plan-detail-meta"><Clock3 size={15} />Ends {formatPlanDate(selectedPlan.ends_at)}</p>}
            {selectedPlan.location_text && <p className="chat-plan-detail-meta"><MapPin size={15} />{selectedPlan.location_text}</p>}
            {selectedPlan.description && <p className="chat-plan-detail-description">{selectedPlan.description}</p>}
            <section className="chat-plan-response-groups" aria-label="Plan responses">
              {PLAN_RESPONSES.map(({ value, label }) => {
                const matchingResponses = planData.responses.filter((response) => response.plan_id === selectedPlan.id && response.response === value);
                return (
                  <div className="chat-plan-response-group" key={value}>
                    <h3>{label} <span>{matchingResponses.length}</span></h3>
                    {matchingResponses.length > 0
                      ? matchingResponses.map((response) => {
                        const profile = planData.profiles[response.user_id];
                        return <div className="chat-plan-response-person" key={response.user_id}><Avatar src={profile?.photo_url} name={profile?.name || 'Member'} size="xs" /><span>{profile?.name || 'Member'}</span></div>;
                      })
                      : <p>No responses yet.</p>}
                  </div>
                );
              })}
            </section>
            {planActionError && <p className="chat-plan-form-error" role="alert">{planActionError}</p>}
            <div className="chat-plan-detail-actions">
              <Button variant="secondary" onClick={() => downloadPlanCalendarFile(selectedPlan)}><CalendarPlus size={15} />Add to calendar</Button>
              {selectedPlan.created_by === user.id && selectedPlan.status === 'active' && new Date(selectedPlan.starts_at) > new Date() && <Button variant="secondary" loading={nudgeBusy} onClick={nudgeUnconfirmed}>Nudge unconfirmed</Button>}
              {canManageSelectedPlan && selectedPlan.status === 'active' && <Button variant="secondary" onClick={() => beginPlanEdit(selectedPlan)}>Edit</Button>}
              {canManageSelectedPlan && selectedPlan.status === 'active' && <Button variant="danger" loading={planSaving} onClick={cancelSelectedPlan}>Cancel plan</Button>}
            </div>
          </div>
        )}
      </Modal>
      <Modal open={Boolean(lightboxUrl)} onClose={() => setLightboxUrl('')} title="Shared photo" size="lg">
        {lightboxUrl && <div className="chat-lightbox"><img src={lightboxUrl} alt="Shared in conversation" /></div>}
      </Modal>
    </div>
  );
}
