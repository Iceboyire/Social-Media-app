import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowLeft, Bookmark, CalendarDays, CalendarPlus, Check, CheckCheck, Clock3, ImagePlus, LoaderCircle, MapPin, Mic, MoreHorizontal, Pencil, Pin, Plus, Receipt, Reply, Send, ShoppingBasket, Smile, Square, Trash2, UsersRound, X } from 'lucide-react';
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
const REACTION_CHOICES = ['👍', '❤️', '😂', '😮', '😢', '🎉'];
const MAX_VOICE_NOTE_SIZE = 5 * 1024 * 1024;
const MAX_VOICE_NOTE_SECONDS = 120;
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

async function fetchPlanExtras(planId) {
  if (!planId) return { items: [], costs: [], profiles: {} };
  const [{ data: items, error: itemsError }, { data: costs, error: costsError }] = await Promise.all([
    supabase
      .from('plan_bring_items')
      .select('id, plan_id, item, created_by, is_brought, brought_by, brought_at, created_at')
      .eq('plan_id', planId)
      .order('created_at', { ascending: true }),
    supabase
      .from('plan_costs')
      .select('id, plan_id, amount, currency, note, paid_by, created_at')
      .eq('plan_id', planId)
      .order('created_at', { ascending: true }),
  ]);
  if (itemsError) throw itemsError;
  if (costsError) throw costsError;
  const profileIds = [...new Set([
    ...(items ?? []).flatMap((item) => [item.created_by, item.brought_by].filter(Boolean)),
    ...(costs ?? []).map((cost) => cost.paid_by),
  ])];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from('profiles').select('id, name').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;
  return {
    items: items ?? [],
    costs: costs ?? [],
    profiles: Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile])),
  };
}

async function fetchChatMemories(conversationId) {
  const { data, error } = await supabase
    .from('chat_memories')
    .select('id, message_id, created_at, message:messages!chat_memories_message_id_fkey(id, sender_id, body, image_url, voice_path, created_at, deleted_at, expires_at)')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
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

  const [
    { data: conversation, error: conversationError },
    { data: members, error: membersError },
    { data: allMembers, error: allMembersError },
  ] = await Promise.all([
    supabase.from('conversations').select('id, type, name, photo_url').eq('id', conversationId).single(),
    supabase.from('conversation_members').select('user_id, role, joined_at, left_at, last_read_at').eq('conversation_id', conversationId).is('left_at', null),
    supabase.from('conversation_members').select('user_id').eq('conversation_id', conversationId),
  ]);
  for (const result of [{ error: conversationError }, { error: membersError }, { error: allMembersError }]) {
    if (result.error) throw result.error;
  }
  const otherIds = [...new Set((members ?? []).map((member) => member.user_id).filter((id) => id !== userId))];
  const profileIds = [...new Set((allMembers ?? []).map((member) => member.user_id))];
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
  } else if (conversation.type === 'group') {
    const { data: blocks, error: blocksError } = await supabase
      .from('blocks')
      .select('blocker_id, blocked_id')
      .or(`blocker_id.eq.${userId},blocked_id.eq.${userId}`);
    if (blocksError) throw blocksError;
    isBlocked = (blocks ?? []).some((block) => (
      otherIds.includes(block.blocker_id === userId ? block.blocked_id : block.blocker_id)
    ));
    canMessage = !isBlocked;
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
    .select('id, sender_id, body, image_url, voice_path, is_system, message_type, plan_id, poll_id, reply_to_message_id, edited_at, deleted_at, expires_at, created_at')
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

function ChatVoiceNote({ path }) {
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    if (!path) return undefined;
    supabase.storage.from('chat-voice-notes').createSignedUrl(path, 60 * 60)
      .then(({ data, error: signedUrlError }) => {
        if (!active) return;
        if (signedUrlError) setError(signedUrlError.message);
        else setUrl(data.signedUrl);
      }).catch((signedUrlError) => {
        if (active) setError(signedUrlError.message || 'Voice note unavailable');
      });
    return () => { active = false; };
  }, [path]);
  if (error) return <span className="chat-image-error">Voice note unavailable</span>;
  return url
    ? <audio className="chat-voice-player" controls preload="metadata" src={url}>Your browser cannot play this voice note.</audio>
    : <span className="chat-image-loading"><LoaderCircle size={16} /></span>;
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
  const [replyTo, setReplyTo] = useState(null);
  const [editingMessageId, setEditingMessageId] = useState('');
  const [editDraft, setEditDraft] = useState('');
  const [messageActionBusy, setMessageActionBusy] = useState('');
  const [voiceRecording, setVoiceRecording] = useState(false);
  const [voiceSending, setVoiceSending] = useState(false);
  const [voiceSeconds, setVoiceSeconds] = useState(0);
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
  const [bringItemDraft, setBringItemDraft] = useState('');
  const [costAmountDraft, setCostAmountDraft] = useState('');
  const [costCurrencyDraft, setCostCurrencyDraft] = useState('GBP');
  const [costNoteDraft, setCostNoteDraft] = useState('');
  const [planExtrasBusy, setPlanExtrasBusy] = useState('');
  const [planExtrasError, setPlanExtrasError] = useState('');
  const [planExtrasRealtimeError, setPlanExtrasRealtimeError] = useState('');
  const [showMemories, setShowMemories] = useState(false);
  const [memoryBusy, setMemoryBusy] = useState('');
  const [memoryError, setMemoryError] = useState('');
  const [locationMinutes, setLocationMinutes] = useState(15);
  const [locationSharing, setLocationSharing] = useState(false);
  const [locationError, setLocationError] = useState('');
  const [locationRealtimeError, setLocationRealtimeError] = useState('');
  const [lastLocationUpdated, setLastLocationUpdated] = useState(null);
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
  const messageInputRef = useRef(null);
  const selectedImageUrlRef = useRef(null);
  const voiceRecorderRef = useRef(null);
  const voiceStreamRef = useRef(null);
  const voiceChunksRef = useRef([]);
  const voiceStartedAtRef = useRef(0);
  const voiceTimerRef = useRef(null);
  const locationWatchRef = useRef(null);
  const locationExpiryTimerRef = useRef(null);
  const locationSharingRef = useRef(false);
  const locationLastUpdateRef = useRef(0);
  const locationExpiresAtRef = useRef('');
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
  const chatSettingsQuery = useQuery({
    queryKey: ['conversation-chat-settings', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_chat_settings')
        .select('conversation_id, expires_in_seconds')
        .eq('conversation_id', conversationId)
        .maybeSingle();
      if (error) throw error;
      return data ?? { conversation_id: conversationId, expires_in_seconds: 0 };
    },
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const pinnedMessageQuery = useQuery({
    queryKey: ['conversation-pin', conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('conversation_pins')
        .select('conversation_id, message_id, pinned_by, created_at, message:messages!conversation_pins_message_id_fkey(id, sender_id, body, image_url, voice_path, deleted_at, created_at)')
        .eq('conversation_id', conversationId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const plansQuery = useQuery({
    queryKey: ['conversation-plans', conversationId, user?.id],
    queryFn: () => fetchConversationPlans(conversationId),
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const memoriesQuery = useQuery({
    queryKey: ['chat-memories', conversationId, user?.id],
    queryFn: () => fetchChatMemories(conversationId),
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const liveLocationsQuery = useQuery({
    queryKey: ['live-locations', conversationId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('live_locations')
        .select('conversation_id, user_id, latitude, longitude, expires_at, updated_at')
        .eq('conversation_id', conversationId)
        .gt('expires_at', new Date().toISOString())
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(conversationId && user?.id),
    retry: 1,
  });
  const planExtrasQuery = useQuery({
    queryKey: ['plan-extras', selectedPlanId, user?.id],
    queryFn: () => fetchPlanExtras(selectedPlanId),
    enabled: Boolean(selectedPlanId && user?.id),
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
  useEffect(() => {
    if (!selectedPlanId || !user?.id) return undefined;
    let active = true;
    const channel = supabase.channel(`plan-extras:${selectedPlanId}:${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'plan_bring_items',
        filter: `plan_id=eq.${selectedPlanId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlanId, user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'plan_costs',
        filter: `plan_id=eq.${selectedPlanId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlanId, user.id] }))
      .subscribe((status) => {
        if (active && (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT')) {
          setPlanExtrasRealtimeError('Live plan updates are unavailable. Refresh the plan details to check for changes.');
        } else if (active && status === 'SUBSCRIBED') {
          setPlanExtrasRealtimeError('');
        }
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [selectedPlanId, user?.id, queryClient]);
  useEffect(() => {
    setBringItemDraft('');
    setCostAmountDraft('');
    setCostCurrencyDraft('GBP');
    setCostNoteDraft('');
    setPlanExtrasError('');
    setPlanExtrasRealtimeError('');
  }, [selectedPlanId]);
  useEffect(() => {
    if (!conversationId || !user?.id) return undefined;
    let active = true;
    const channel = supabase.channel(`conversation-live-data:${conversationId}:${user.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'chat_memories',
      }, () => queryClient.invalidateQueries({ queryKey: ['chat-memories', conversationId, user.id] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'live_locations',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['live-locations', conversationId, user.id] }))
      .subscribe((status) => {
        if (!active) return;
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          setLocationRealtimeError('Live updates for memories or locations are unavailable. Refresh to check for changes.');
        } else if (status === 'SUBSCRIBED') {
          setLocationRealtimeError('');
        }
      });
    return () => {
      active = false;
      supabase.removeChannel(channel);
    };
  }, [conversationId, user?.id, queryClient]);
  useEffect(() => {
    locationSharingRef.current = locationSharing;
  }, [locationSharing]);
  useEffect(() => () => {
    const shouldStopLocation = locationSharingRef.current;
    locationSharingRef.current = false;
    if (locationWatchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
    if (locationExpiryTimerRef.current !== null) {
      window.clearTimeout(locationExpiryTimerRef.current);
      locationExpiryTimerRef.current = null;
    }
    if (shouldStopLocation && conversationId && user?.id) {
      supabase.rpc('stop_live_location', { p_conversation_id: conversationId })
        .then(({ error }) => { if (error) console.error('Could not stop live location on conversation exit.', error); })
        .catch((error) => console.error('Could not stop live location on conversation exit.', error));
    }
  }, [conversationId, user?.id]);
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
  const messageIds = useMemo(
    () => messages.map((message) => message.id).filter((id) => !String(id).startsWith('pending-')),
    [messages],
  );
  const reactionsQuery = useQuery({
    queryKey: ['message-reactions', conversationId, messageIds],
    queryFn: async () => {
      if (!messageIds.length) return [];
      const { data, error } = await supabase
        .from('message_reactions')
        .select('message_id, user_id, emoji')
        .in('message_id', messageIds);
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(conversationId && user?.id && messageIds.length),
    retry: 1,
  });
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
    window.clearInterval(voiceTimerRef.current);
    if (voiceRecorderRef.current) {
      voiceRecorderRef.current.onstop = null;
      voiceRecorderRef.current.ondataavailable = null;
      if (voiceRecorderRef.current.state !== 'inactive') voiceRecorderRef.current.stop();
    }
    voiceStreamRef.current?.getTracks().forEach((track) => track.stop());
  }, []);

  useEffect(() => {
    if (!conversationId || !user?.id) return undefined;
    let active = true;
    async function removeExpiredAttachments() {
      const { data: queuedObjects, error } = await supabase.rpc('take_expired_chat_objects');
      if (error) throw error;
      const removedPaths = [];
      for (const bucket of ['chat-images', 'chat-voice-notes']) {
        const paths = (queuedObjects ?? []).filter((object) => object.bucket_id === bucket).map((object) => object.object_path);
        if (!paths.length) continue;
        const { error: removalError } = await supabase.storage.from(bucket).remove(paths);
        if (removalError) {
          toast(`Expired attachments could not be fully cleaned up: ${removalError.message}`);
          continue;
        }
        removedPaths.push(...paths);
      }
      if (removedPaths.length) {
        const { error: acknowledgementError } = await supabase.rpc('ack_expired_chat_objects', { p_object_paths: removedPaths });
        if (acknowledgementError) throw acknowledgementError;
      }
    }
    removeExpiredAttachments().catch((error) => {
      if (active) toast(error.message || 'Expired attachments could not be cleaned up.');
    });
    return () => { active = false; };
  }, [conversationId, user?.id, toast]);

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
        event: 'UPDATE',
        schema: 'public',
        table: 'messages',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: chatKey }))
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'messages',
      }, () => queryClient.invalidateQueries({ queryKey: chatKey }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'message_reactions',
      }, () => queryClient.invalidateQueries({ queryKey: ['message-reactions', conversationId] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversation_chat_settings',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-chat-settings', conversationId] }))
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'conversation_pins',
        filter: `conversation_id=eq.${conversationId}`,
      }, () => queryClient.invalidateQueries({ queryKey: ['conversation-pin', conversationId] }))
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
      const previousScrollBehavior = scroller.style.scrollBehavior;
      scroller.style.scrollBehavior = 'auto';
      scroller.scrollTop = scroller.scrollHeight - preserveScrollRef.current;
      preserveScrollRef.current = null;
      window.requestAnimationFrame(() => {
        scroller.style.scrollBehavior = previousScrollBehavior;
      });
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
    const text = retryMessage ? retryMessage.body ?? '' : body.trim();
    const image = retryMessage?.file ? pendingImage : pendingImage;
    if ((!text && !image) || sending || !conversationQuery.data?.canMessage) return;
    const optimisticId = retryMessage?.id ?? `pending-${crypto.randomUUID()}`;
    const timestamp = retryMessage?.created_at ?? new Date().toISOString();
    const item = retryMessage ?? {
      id: optimisticId,
      sender_id: user.id,
      body: text || null,
      image_url: image?.previewUrl ?? null,
      reply_to_message_id: replyTo?.id ?? null,
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
      const { data, error } = await supabase.rpc('send_chat_message', {
        p_conversation_id: conversationId,
        p_body: text || null,
        p_image_path: imagePath || null,
        p_reply_to_message_id: retryMessage ? retryMessage.reply_to_message_id : replyTo?.id ?? null,
      }).select('id, sender_id, body, image_url, voice_path, is_system, message_type, plan_id, poll_id, reply_to_message_id, edited_at, deleted_at, expires_at, created_at').single();
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
        setReplyTo(null);
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

  async function toggleReaction(messageId, emoji) {
    if (messageActionBusy || !messageState?.canMessage) return;
    setMessageActionBusy(messageId);
    try {
      const { error } = await supabase.rpc('react_to_chat_message', { p_message_id: messageId, p_emoji: emoji });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['message-reactions', conversationId] });
    } catch (error) {
      toast(error.message || 'The reaction could not be saved.');
    } finally {
      setMessageActionBusy('');
    }
  }

  async function saveEditedMessage(event, messageId) {
    event.preventDefault();
    if (messageActionBusy) return;
    setMessageActionBusy(messageId);
    try {
      const { error } = await supabase.rpc('edit_chat_message', { p_message_id: messageId, p_body: editDraft });
      if (error) throw error;
      setEditingMessageId('');
      setEditDraft('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKey }),
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
      ]);
    } catch (error) {
      toast(error.message || 'The message could not be edited.');
    } finally {
      setMessageActionBusy('');
    }
  }

  async function deleteMessage(message) {
    if (messageActionBusy || !window.confirm('Delete this message for everyone in the conversation?')) return;
    setMessageActionBusy(message.id);
    try {
      const { data: objectPath, error } = await supabase.rpc('delete_chat_message', { p_message_id: message.id });
      if (error) throw error;
      setEditingMessageId('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: chatKey }),
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
      ]);
      if (objectPath) {
        const bucket = message.voice_path ? 'chat-voice-notes' : 'chat-images';
        const { error: removeError } = await supabase.storage.from(bucket).remove([objectPath]);
        if (removeError) {
          toast(`Message deleted, but its attachment remains queued for cleanup: ${removeError.message}`);
        } else {
          const { error: ackError } = await supabase.rpc('ack_expired_chat_objects', { p_object_paths: [objectPath] });
          if (ackError) toast(`Message deleted, but attachment cleanup could not be recorded: ${ackError.message}`);
        }
      }
    } catch (error) {
      toast(error.message || 'The message could not be deleted.');
    } finally {
      setMessageActionBusy('');
    }
  }

  async function togglePin(message) {
    if (messageActionBusy || !messageState?.canMessage) return;
    setMessageActionBusy(message.id);
    try {
      const pinned = pinnedMessageQuery.data?.message_id === message.id;
      const { error } = pinned
        ? await supabase.rpc('unpin_chat_message', { p_conversation_id: conversationId })
        : await supabase.rpc('pin_chat_message', { p_message_id: message.id });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['conversation-pin', conversationId] });
    } catch (error) {
      toast(error.message || 'The pinned message could not be updated.');
    } finally {
      setMessageActionBusy('');
    }
  }

  async function changeChatExpiry(event) {
    const expiresInSeconds = Number(event.target.value);
    try {
      const { error } = await supabase.rpc('set_chat_expiry', {
        p_conversation_id: conversationId,
        p_expires_in_seconds: expiresInSeconds,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['conversation-chat-settings', conversationId] });
      toast(expiresInSeconds ? 'Disappearing messages updated for new messages.' : 'Disappearing messages turned off for new messages.', 'success');
    } catch (error) {
      toast(error.message || 'The message expiry could not be updated.');
    }
  }

  async function sendRecordedVoice(blob, mimeType) {
    if (!messageState?.canMessage || voiceSending) return;
    if (!blob.size || blob.size > MAX_VOICE_NOTE_SIZE) {
      toast('Voice notes must be smaller than 5 MB. Try a shorter recording.');
      return;
    }
    const allowedTypes = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav'];
    if (!allowedTypes.includes(mimeType)) {
      toast('This browser recorded an unsupported audio format.');
      return;
    }
    const extension = { 'audio/webm': 'webm', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/wav': 'wav' }[mimeType];
    const path = `${user.id}/${conversationId}/${crypto.randomUUID()}.${extension}`;
    setVoiceSending(true);
    let uploaded = false;
    try {
      const { error: uploadError } = await supabase.storage.from('chat-voice-notes').upload(path, blob, {
        contentType: mimeType,
        upsert: false,
      });
      if (uploadError) throw uploadError;
      uploaded = true;
      const { data, error } = await supabase.rpc('send_chat_voice_note', {
        p_conversation_id: conversationId,
        p_voice_path: path,
        p_reply_to_message_id: replyTo?.id ?? null,
      }).select('id, sender_id, body, image_url, voice_path, is_system, message_type, plan_id, poll_id, reply_to_message_id, edited_at, deleted_at, expires_at, created_at').single();
      if (error) throw error;
      queryClient.setQueryData(chatKey, (current) => {
        if (!current?.pages?.length || current.pages.some((page) => page.messages.some((message) => message.id === data.id))) return current;
        return {
          ...current,
          pages: current.pages.map((page, index) => index === 0
            ? { ...page, messages: [...page.messages, data].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }
            : page),
        };
      });
      setReplyTo(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['conversations', user.id] }),
        markRead(),
      ]);
      window.requestAnimationFrame(() => bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }));
    } catch (error) {
      if (uploaded) {
        const { error: cleanupError } = await supabase.storage.from('chat-voice-notes').remove([path]);
        if (cleanupError) toast(`Voice note was not sent, and its upload could not be removed: ${cleanupError.message}`);
      }
      toast(error.message || 'The voice note could not be sent.');
    } finally {
      setVoiceSending(false);
    }
  }

  async function startVoiceRecording() {
    if (voiceRecording || voiceSending || !messageState?.canMessage) return;
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      toast('Voice recording is not supported in this browser.');
      return;
    }
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = ['audio/webm', 'audio/mp4', 'audio/ogg', 'audio/mpeg', 'audio/wav']
        .find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      voiceStreamRef.current = stream;
      voiceRecorderRef.current = recorder;
      voiceChunksRef.current = [];
      voiceStartedAtRef.current = Date.now();
      recorder.ondataavailable = (event) => {
        if (event.data.size) voiceChunksRef.current.push(event.data);
      };
      recorder.onerror = () => {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
        recorder.onstop = null;
        stream.getTracks().forEach((track) => track.stop());
        voiceRecorderRef.current = null;
        voiceStreamRef.current = null;
        setVoiceRecording(false);
        toast('The voice recording failed. Please try again.');
      };
      recorder.onstop = () => {
        window.clearInterval(voiceTimerRef.current);
        voiceTimerRef.current = null;
        const detectedType = (recorder.mimeType || mimeType || '').split(';')[0];
        const recording = new Blob(voiceChunksRef.current, { type: detectedType });
        stream.getTracks().forEach((track) => track.stop());
        voiceStreamRef.current = null;
        voiceRecorderRef.current = null;
        setVoiceRecording(false);
        if (recording.size) sendRecordedVoice(recording, detectedType);
        else toast('No audio was recorded. Please try again.');
      };
      recorder.start();
      setVoiceRecording(true);
      setVoiceSeconds(0);
      voiceTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - voiceStartedAtRef.current) / 1000);
        setVoiceSeconds(elapsed);
        if (elapsed >= MAX_VOICE_NOTE_SECONDS) voiceRecorderRef.current?.stop();
      }, 1000);
    } catch (error) {
      stream?.getTracks().forEach((track) => track.stop());
      voiceRecorderRef.current = null;
      voiceStreamRef.current = null;
      toast(error.message || 'Microphone access was denied.');
    }
  }

  function stopVoiceRecording() {
    window.clearInterval(voiceTimerRef.current);
    voiceTimerRef.current = null;
    if (voiceRecorderRef.current?.state === 'recording') voiceRecorderRef.current.stop();
  }

  function selectReply(message) {
    if (!messageState?.canMessage || message.deleted_at) return;
    setReplyTo(message);
    window.requestAnimationFrame(() => messageInputRef.current?.focus());
  }

  async function locatePinnedMessage() {
    let result = { data: messageQuery.data, hasNextPage: messageQuery.hasNextPage };
    while (!result.data?.pages?.some((page) => page.messages.some((message) => message.id === pinnedMessageQuery.data?.message_id))
      && result.hasNextPage) {
      result = await messageQuery.fetchNextPage();
    }
    const found = result.data?.pages?.some((page) => page.messages.some((message) => message.id === pinnedMessageQuery.data?.message_id));
    if (!found) {
      toast('The pinned message is no longer available.');
      return;
    }
    window.requestAnimationFrame(() => document.getElementById(`message-${pinnedMessageQuery.data.message_id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' }));
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

  async function submitBringItem(event) {
    event.preventDefault();
    const item = bringItemDraft.trim();
    if (!selectedPlan || !item || item.length > 140 || planExtrasBusy) return;
    setPlanExtrasBusy('bring-add');
    setPlanExtrasError('');
    try {
      const { error } = await supabase.rpc('add_plan_bring_item', {
        p_plan_id: selectedPlan.id,
        p_item: item,
      });
      if (error) throw error;
      setBringItemDraft('');
      await queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlan.id, user.id] });
    } catch (error) {
      setPlanExtrasError(error.message || 'The item could not be added.');
    } finally {
      setPlanExtrasBusy('');
    }
  }

  async function updateBringItem(item, isBrought) {
    if (!selectedPlan || planExtrasBusy) return;
    setPlanExtrasBusy(item.id);
    setPlanExtrasError('');
    try {
      const { error } = await supabase.rpc('set_plan_bring_item', {
        p_item_id: item.id,
        p_is_brought: isBrought,
      });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlan.id, user.id] });
    } catch (error) {
      setPlanExtrasError(error.message || 'The bring-list item could not be updated.');
    } finally {
      setPlanExtrasBusy('');
    }
  }

  async function removeBringItem(itemId) {
    if (!selectedPlan || planExtrasBusy) return;
    setPlanExtrasBusy(itemId);
    setPlanExtrasError('');
    try {
      const { error } = await supabase.rpc('delete_plan_bring_item', { p_item_id: itemId });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlan.id, user.id] });
    } catch (error) {
      setPlanExtrasError(error.message || 'The bring-list item could not be removed.');
    } finally {
      setPlanExtrasBusy('');
    }
  }

  async function submitPlanCost(event) {
    event.preventDefault();
    const amount = Number(costAmountDraft);
    const currency = costCurrencyDraft.trim().toUpperCase();
    const note = costNoteDraft.trim();
    if (!selectedPlan || planExtrasBusy) return;
    if (!Number.isFinite(amount) || amount <= 0 || amount > 9999999999.99
      || !/^[A-Z]{3}$/.test(currency) || note.length > 200) {
      setPlanExtrasError('Enter a positive amount, a three-letter currency code, and an optional note up to 200 characters.');
      return;
    }
    setPlanExtrasBusy('cost-add');
    setPlanExtrasError('');
    try {
      const { error } = await supabase.rpc('add_plan_cost', {
        p_plan_id: selectedPlan.id,
        p_amount: amount,
        p_currency: currency,
        p_note: note || null,
      });
      if (error) throw error;
      setCostAmountDraft('');
      setCostNoteDraft('');
      await queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlan.id, user.id] });
    } catch (error) {
      setPlanExtrasError(error.message || 'The cost could not be recorded.');
    } finally {
      setPlanExtrasBusy('');
    }
  }

  async function removePlanCost(costId) {
    if (!selectedPlan || planExtrasBusy) return;
    setPlanExtrasBusy(costId);
    setPlanExtrasError('');
    try {
      const { error } = await supabase.rpc('delete_plan_cost', { p_cost_id: costId });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['plan-extras', selectedPlan.id, user.id] });
    } catch (error) {
      setPlanExtrasError(error.message || 'The cost could not be removed.');
    } finally {
      setPlanExtrasBusy('');
    }
  }

  async function toggleChatMemory(message) {
    if (!messageState?.canMessage || memoryBusy) return;
    const existing = memoriesQuery.data?.find((memory) => memory.message_id === message.id);
    setMemoryBusy(message.id);
    setMemoryError('');
    try {
      const { error } = existing
        ? await supabase.rpc('remove_chat_memory', { p_memory_id: existing.id })
        : await supabase.rpc('save_chat_memory', { p_message_id: message.id });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['chat-memories', conversationId, user.id] });
    } catch (error) {
      setMemoryError(error.message || 'The memory could not be updated.');
    } finally {
      setMemoryBusy('');
    }
  }

  async function stopSharingLocation() {
    locationSharingRef.current = false;
    if (locationWatchRef.current !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
    }
    if (locationExpiryTimerRef.current !== null) {
      window.clearTimeout(locationExpiryTimerRef.current);
      locationExpiryTimerRef.current = null;
    }
    setLocationSharing(false);
    setLocationError('');
    try {
      const { error } = await supabase.rpc('stop_live_location', { p_conversation_id: conversationId });
      if (error) throw error;
      await queryClient.invalidateQueries({ queryKey: ['live-locations', conversationId, user.id] });
    } catch (error) {
      setLocationError(error.message || 'Location sharing could not be stopped on the server.');
    }
  }

  function startSharingLocation() {
    if (!messageState?.canMessage || locationSharingRef.current) return;
    if (!navigator.geolocation) {
      setLocationError('This browser does not support location sharing.');
      return;
    }
    setLocationError('');
    setLastLocationUpdated(null);
    locationSharingRef.current = true;
    locationExpiresAtRef.current = new Date(Date.now() + locationMinutes * 60_000).toISOString();
    setLocationSharing(true);
    locationExpiryTimerRef.current = window.setTimeout(() => {
      locationSharingRef.current = false;
      if (locationWatchRef.current !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchRef.current);
        locationWatchRef.current = null;
      }
      setLocationSharing(false);
      queryClient.invalidateQueries({ queryKey: ['live-locations', conversationId, user.id] });
    }, locationMinutes * 60_000);
    locationLastUpdateRef.current = 0;
    locationWatchRef.current = navigator.geolocation.watchPosition(async (position) => {
      if (!locationSharingRef.current) return;
      const now = Date.now();
      if (now - locationLastUpdateRef.current < 10_000 && locationLastUpdateRef.current !== 0) return;
      locationLastUpdateRef.current = now;
      try {
        const { error } = await supabase.rpc('update_live_location', {
          p_conversation_id: conversationId,
          p_latitude: position.coords.latitude,
          p_longitude: position.coords.longitude,
          p_expires_at: locationExpiresAtRef.current,
        });
        if (error) throw error;
        setLastLocationUpdated(new Date().toISOString());
        setLocationError('');
        await queryClient.invalidateQueries({ queryKey: ['live-locations', conversationId, user.id] });
      } catch (error) {
        locationSharingRef.current = false;
        if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
        locationWatchRef.current = null;
        setLocationSharing(false);
        setLocationError(error.message || 'Your location could not be shared.');
      }
    }, (error) => {
      locationSharingRef.current = false;
      if (locationWatchRef.current !== null) navigator.geolocation.clearWatch(locationWatchRef.current);
      locationWatchRef.current = null;
      setLocationSharing(false);
      setLocationError(error.message || 'The browser could not access your location.');
    }, { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 });
  }

  const messageState = conversationQuery.data;
  const planData = plansQuery.data;
  const pollData = pollsQuery.data;
  const memories = memoriesQuery.data ?? [];
  const liveLocations = liveLocationsQuery.data ?? [];
  const ownLiveLocation = liveLocations.find((location) => location.user_id === user?.id);
  const selectedPlan = planData?.plans.find((plan) => plan.id === selectedPlanId);
  const planExtras = planExtrasQuery.data;
  const planCostTotals = (planExtras?.costs ?? []).reduce((totals, cost) => {
    totals[cost.currency] = (totals[cost.currency] ?? 0) + Math.round(Number(cost.amount) * 100);
    return totals;
  }, {});
  const currentMemberRole = messageState?.members.find((member) => member.user_id === user?.id)?.role;
  const pinnedMessage = messages.find((message) => message.id === pinnedMessageQuery.data?.message_id);
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
            <label className="chat-expiry-setting">
              <span>Disappearing messages</span>
              <select
                aria-label="Disappearing message expiry"
                value={chatSettingsQuery.data?.expires_in_seconds ?? 0}
                disabled={!messageState?.canMessage || chatSettingsQuery.isLoading}
                onChange={changeChatExpiry}
              >
                <option value={0}>Off</option>
                <option value={86400}>24 hours</option>
                <option value={604800}>7 days</option>
                <option value={2592000}>30 days</option>
              </select>
            </label>
          </div>}
        </div>
      </header>
      <section className="chat-sharing-tools" aria-label="Memories and live location">
        <div className="chat-sharing-actions">
          <Button type="button" size="sm" variant="secondary" aria-expanded={showMemories} onClick={() => setShowMemories((open) => !open)}>
            <Bookmark size={15} /> Memories ({memories.length})
          </Button>
          {messageState?.canMessage && !locationSharing && !ownLiveLocation && <label className="chat-location-duration">
            <span>Share live location</span>
            <select value={locationMinutes} onChange={(event) => setLocationMinutes(Number(event.target.value))} aria-label="Live location sharing duration">
              <option value={15}>15 minutes</option>
              <option value={60}>1 hour</option>
            </select>
          </label>}
          {messageState?.canMessage && <Button type="button" size="sm" variant={locationSharing || ownLiveLocation ? 'danger' : 'secondary'} onClick={locationSharing || ownLiveLocation ? stopSharingLocation : startSharingLocation}>
            <MapPin size={15} />{locationSharing || ownLiveLocation ? 'Stop sharing' : 'Share location'}
          </Button>}
        </div>
        {showMemories && <div className="chat-memories-panel">
          <strong>Saved from this conversation</strong>
          {memoriesQuery.isLoading && <p role="status">Loading memories…</p>}
          {memoriesQuery.isError && <div className="chat-live-warning" role="alert"><span>{memoriesQuery.error.message || 'Memories could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => memoriesQuery.refetch()}>Try again</Button></div>}
          {memoriesQuery.isSuccess && memories.length === 0 && <p>No saved memories in this conversation yet.</p>}
          {memories.map((memory) => <div className="chat-memory-row" key={memory.id}>
            <span><strong>{memory.message?.body || (memory.message?.image_url ? 'Photo' : memory.message?.voice_path ? 'Voice note' : 'Saved message')}</strong><small>{new Date(memory.message?.created_at || memory.created_at).toLocaleString()}</small></span>
            <button type="button" aria-label="Remove saved memory" disabled={Boolean(memoryBusy)} onClick={() => toggleChatMemory({ id: memory.message_id })}><Trash2 size={14} /></button>
          </div>)}
          {memoryError && <p className="chat-memory-error" role="alert">{memoryError}</p>}
        </div>}
        {locationSharing && <p className="chat-location-status" role="status">
          Sharing your live location until {new Date(locationExpiresAtRef.current).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Updates while this conversation is open{lastLocationUpdated ? ` · updated ${new Date(lastLocationUpdated).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : ' · waiting for location permission'}.
        </p>}
        {!locationSharing && ownLiveLocation && <p className="chat-location-status" role="status">Your last shared location remains visible until {new Date(ownLiveLocation.expires_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}. Start sharing again to resume updates.</p>}
        {liveLocationsQuery.isLoading && <p className="chat-sharing-state" role="status">Checking shared locations…</p>}
        {liveLocationsQuery.isError && <div className="chat-live-warning" role="alert"><span>{liveLocationsQuery.error.message || 'Shared locations could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => liveLocationsQuery.refetch()}>Try again</Button></div>}
        {liveLocationsQuery.isSuccess && liveLocations.filter((location) => location.user_id !== user.id).map((location) => {
          const member = messageState?.profiles[location.user_id];
          const mapUrl = `https://www.openstreetmap.org/?mlat=${location.latitude}&mlon=${location.longitude}#map=16/${location.latitude}/${location.longitude}`;
          return <p className="chat-shared-location" key={location.user_id}>
            <MapPin size={14} /><span><strong>{member?.name || 'A member'}</strong> is sharing live location · updated {new Date(location.updated_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
            <a href={mapUrl} target="_blank" rel="noreferrer">View map</a>
          </p>;
        })}
        {(locationError || locationRealtimeError) && <div className="chat-live-warning" role="alert"><span>{locationError || locationRealtimeError}</span>{locationRealtimeError && <Button size="sm" variant="secondary" onClick={() => liveLocationsQuery.refetch()}>Refresh</Button>}</div>}
      </section>
      {pinnedMessageQuery.isError && <div className="chat-live-warning" role="alert"><span>Pinned message could not be loaded: {pinnedMessageQuery.error.message}</span><Button size="sm" variant="secondary" onClick={() => pinnedMessageQuery.refetch()}>Try again</Button></div>}
      {pinnedMessageQuery.data && <button
        type="button"
        className="chat-pinned-banner"
        onClick={locatePinnedMessage}
      >
        <Pin size={15} />
        <span><strong>Pinned message</strong><small>{pinnedMessage?.body || pinnedMessageQuery.data.message?.body || (pinnedMessage?.image_url || pinnedMessageQuery.data.message?.image_url ? 'Photo' : pinnedMessage?.voice_path || pinnedMessageQuery.data.message?.voice_path ? 'Voice note' : 'Deleted message')}</small></span>
      </button>}
      {messageQuery.isError && <EmptyState title="Messages unavailable" description={messageQuery.error.message || 'Messages could not be loaded.'} action={<Button size="sm" variant="secondary" onClick={() => messageQuery.refetch()}>Try again</Button>} />}
      {reactionsQuery.isError && <div className="chat-live-warning" role="alert"><span>Message reactions could not be loaded: {reactionsQuery.error.message}</span><Button size="sm" variant="secondary" onClick={() => reactionsQuery.refetch()}>Try again</Button></div>}
      {reactionsQuery.isLoading && <p className="chat-live-warning" role="status">Loading message reactions…</p>}
      {chatSettingsQuery.isError && <div className="chat-live-warning" role="alert"><span>Conversation settings could not be loaded: {chatSettingsQuery.error.message}</span><Button size="sm" variant="secondary" onClick={() => chatSettingsQuery.refetch()}>Try again</Button></div>}
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
                const replyTarget = messages.find((item) => item.id === message.reply_to_message_id);
                const messageReactions = (reactionsQuery.data ?? []).filter((reaction) => reaction.message_id === message.id);
                const canModifyContent = Boolean(messageState?.canMessage && !message.deleted_at
                  && ['text', 'image', 'voice'].includes(message.message_type));
                return (
                  <div className="chat-message-item" key={message.id} id={`message-${message.id}`}>
                    {newDay && <div className="chat-day-separator"><span>{dayLabel(message.created_at)}</span></div>}
                    <div className={`chat-message${own ? ' chat-message-own' : ''}${groupStart ? ' chat-message-group-start' : ' chat-message-group-continuation'}${groupEnd ? ' chat-message-group-end' : ''}`}>
                      {!own && <Avatar src={sender?.photo_url} name={sender?.name || 'Member'} size="xs" className={!groupStart ? 'chat-group-avatar-hidden' : ''} />}
                      <div className={`chat-message-content${message.failed ? ' chat-message-failed' : ''}`}>
                        {!own && groupStart && <span className="chat-message-sender">{sender?.name || 'Member'}</span>}
                        {message.reply_to_message_id && <div className="chat-reply-quote">
                          <strong>{replyTarget?.sender_id === user.id ? 'You' : messageState.profiles[replyTarget?.sender_id]?.name || 'Reply'}</strong>
                          <span>{replyTarget?.deleted_at ? 'Message deleted' : replyTarget?.body || (replyTarget?.image_url ? 'Photo' : replyTarget?.voice_path ? 'Voice note' : 'Original message')}</span>
                        </div>}
                        {editingMessageId === message.id
                          ? <form className="chat-message-edit" onSubmit={(event) => saveEditedMessage(event, message.id)}>
                              <textarea aria-label="Edit message" value={editDraft} maxLength={5000} onChange={(event) => setEditDraft(event.target.value)} autoFocus />
                              <span><button type="button" onClick={() => { setEditingMessageId(''); setEditDraft(''); }}>Cancel</button><button type="submit" disabled={!editDraft.trim() || messageActionBusy === message.id}>Save</button></span>
                            </form>
                          : message.message_type === 'deleted'
                            ? <p className="chat-message-deleted">This message was deleted.</p>
                            : <>
                                {message.image_url?.startsWith('blob:')
                                  ? <button className="chat-image-open" type="button" onClick={() => setLightboxUrl(message.image_url)} aria-label="Open image"><img className="chat-image" src={message.image_url} alt="Image to send" /></button>
                                  : message.image_url && <ChatImage path={message.image_url} alt="Shared image" onImageClick={setLightboxUrl} />}
                                {message.voice_path && <ChatVoiceNote path={message.voice_path} />}
                                {message.body && <p>{message.body}</p>}
                              </>}
                        <time dateTime={message.created_at}>{message.edited_at && <span>Edited · </span>}{new Date(message.created_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}{own && !message.failed && (seen ? <CheckCheck className="chat-receipt-seen" size={15} aria-label="Seen" /> : <Check className="chat-receipt-sent" size={15} aria-label="Sent" />)}</time>
                        {message.failed && <button type="button" className="chat-retry-button" onClick={() => sendMessage(null, message)}>Failed · Retry</button>}
                        {!message.failed && message.message_type !== 'deleted' && <div className="chat-message-tools">
                          {message.message_type !== 'system' && <button type="button" title={memories.some((memory) => memory.message_id === message.id) ? 'Remove from memories' : 'Save to memories'} aria-label={memories.some((memory) => memory.message_id === message.id) ? 'Remove from memories' : 'Save to memories'} disabled={!messageState?.canMessage || memoryBusy === message.id} onClick={() => toggleChatMemory(message)}><Bookmark size={13} /></button>}
                          <button type="button" title="Reply" aria-label="Reply to message" disabled={!messageState?.canMessage || !canModifyContent} onClick={() => selectReply(message)}><Reply size={13} /></button>
                          {own && message.message_type === 'text' && <button type="button" title="Edit" aria-label="Edit message" disabled={!messageState?.canMessage || messageActionBusy === message.id} onClick={() => { setEditingMessageId(message.id); setEditDraft(message.body || ''); }}><Pencil size={13} /></button>}
                          {own && canModifyContent && <button type="button" title="Delete for everyone" aria-label="Delete message for everyone" disabled={!messageState?.canMessage || messageActionBusy === message.id} onClick={() => deleteMessage(message)}><Trash2 size={13} /></button>}
                          {canModifyContent && <button type="button" title={pinnedMessageQuery.data?.message_id === message.id ? 'Unpin message' : 'Pin message'} aria-label={pinnedMessageQuery.data?.message_id === message.id ? 'Unpin message' : 'Pin message'} disabled={!messageState?.canMessage || messageActionBusy === message.id} onClick={() => togglePin(message)}><Pin size={13} /></button>}
                        </div>}
                        {canModifyContent && <div className="chat-reaction-row">
                          {REACTION_CHOICES.map((emoji) => {
                            const matching = messageReactions.filter((reaction) => reaction.emoji === emoji);
                            const selected = matching.some((reaction) => reaction.user_id === user.id);
                            return <button type="button" key={emoji} className={selected ? 'chat-reaction-selected' : ''} aria-label={`${emoji} reaction${matching.length ? `, ${matching.length}` : ''}`} aria-pressed={selected} disabled={!messageState?.canMessage || messageActionBusy === message.id} onClick={() => toggleReaction(message.id, emoji)}>{emoji}{matching.length > 0 && <span>{matching.length}</span>}</button>;
                          })}
                        </div>}
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
            {replyTo && <div className="chat-composing-reply"><span><strong>Replying to {replyTo.sender_id === user.id ? 'yourself' : messageState.profiles[replyTo.sender_id]?.name || 'member'}</strong><small>{replyTo.body || (replyTo.image_url ? 'Photo' : replyTo.voice_path ? 'Voice note' : 'Message')}</small></span><button type="button" aria-label="Cancel reply" onClick={() => setReplyTo(null)}><X size={15} /></button></div>}
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
                <button type="button" className="chat-compose-tool" aria-label="Add image" disabled={!messageState?.canMessage || sending || voiceSending} onClick={() => imageInputRef.current?.click()}><ImagePlus size={18} /></button>
                <input ref={imageInputRef} type="file" accept="image/jpeg,image/png,image/webp,image/gif" hidden onChange={(event) => { selectImage(event.target.files?.[0]); event.target.value = ''; }} />
                <div className="chat-emoji-wrap">
                  <button type="button" className="chat-compose-tool" aria-label="Choose emoji" aria-expanded={emojiOpen} disabled={!messageState?.canMessage || sending || voiceSending} onClick={() => setEmojiOpen((open) => !open)}><Smile size={18} /></button>
                  {emojiOpen && <div className="chat-emoji-popover"><EmojiPicker onEmojiClick={(emoji) => { changeBody(`${body}${emoji.emoji}`); setEmojiOpen(false); }} theme={document.documentElement.classList.contains('dark') ? 'dark' : 'light'} height={350} width={300} /></div>}
                </div>
                <button
                  type="button"
                  className={`chat-compose-tool${voiceRecording ? ' chat-recording' : ''}`}
                  aria-label={voiceRecording ? `Stop recording at ${voiceSeconds} seconds` : 'Record voice note'}
                  disabled={!messageState?.canMessage || voiceSending || sending}
                  onClick={voiceRecording ? stopVoiceRecording : startVoiceRecording}
                >{voiceRecording ? <><Square size={15} /><span>{voiceSeconds}s</span></> : <Mic size={18} />}</button>
              </div>
              <input ref={messageInputRef} aria-label="Write a message" placeholder={messageState?.canMessage ? 'Write a message…' : 'Messaging unavailable'} maxLength={5000} value={body} onChange={(event) => changeBody(event.target.value)} disabled={!messageState?.canMessage || sending || voiceSending} />
              <Button className={`chat-send-button${body.trim() || pendingImage ? ' chat-send-button-visible' : ''}`} type="submit" loading={sending || voiceSending} disabled={(!body.trim() && !pendingImage) || !messageState?.canMessage} aria-label="Send message"><Send size={17} /></Button>
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
            <section className="plan-extras-section" aria-labelledby="plan-bring-list-heading">
              <div className="plan-extras-heading">
                <h3 id="plan-bring-list-heading"><ShoppingBasket size={16} />Bring list</h3>
                <span>{planExtras?.items.length ?? 0} items</span>
              </div>
              {planExtrasQuery.isLoading && <p className="plan-extras-state">Loading the bring list…</p>}
              {planExtrasQuery.isError && <div className="plan-extras-error" role="alert">
                <p>{planExtrasQuery.error.message || 'The bring list could not be loaded.'}</p>
                <Button size="sm" variant="secondary" onClick={() => planExtrasQuery.refetch()}>Try again</Button>
              </div>}
              {planExtrasQuery.isSuccess && planExtras?.items.length === 0 && <p className="plan-extras-state">Nothing has been added yet.</p>}
              {planExtrasQuery.isSuccess && planExtras?.items.length > 0 && (
                <ul className="plan-extras-list">
                  {planExtras.items.map((item) => {
                    const addedBy = planExtras.profiles[item.created_by]?.name || 'A member';
                    const broughtBy = item.brought_by ? planExtras.profiles[item.brought_by]?.name || 'A member' : '';
                    const canRemove = item.created_by === user?.id || selectedPlan.created_by === user?.id || canManageSelectedPlan;
                    return (
                      <li className={`plan-bring-item${item.is_brought ? ' is-brought' : ''}`} key={item.id}>
                        <button
                          type="button"
                          className="plan-bring-toggle"
                          onClick={() => updateBringItem(item, !item.is_brought)}
                          disabled={Boolean(planExtrasBusy) || selectedPlan.status !== 'active'}
                          aria-pressed={item.is_brought}
                          aria-label={`${item.is_brought ? 'Mark not brought' : 'Mark brought'}: ${item.item}`}
                        ><Check size={15} /></button>
                        <span className="plan-bring-copy">
                          <strong>{item.item}</strong>
                          <small>{item.is_brought ? `Brought by ${broughtBy}` : `Added by ${addedBy}`}</small>
                        </span>
                        {canRemove && <button
                          type="button"
                          className="plan-extras-remove"
                          onClick={() => removeBringItem(item.id)}
                          disabled={Boolean(planExtrasBusy)}
                          aria-label={`Remove ${item.item}`}
                        ><Trash2 size={14} /></button>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedPlan.status === 'active' && (
                <form className="plan-extras-add-row" onSubmit={submitBringItem}>
                  <input
                    className="ui-input"
                    value={bringItemDraft}
                    maxLength={140}
                    onChange={(event) => setBringItemDraft(event.target.value)}
                    placeholder="Add something to bring"
                    aria-label="Item to add to the bring list"
                    required
                  />
                  <Button type="submit" size="sm" loading={planExtrasBusy === 'bring-add'} disabled={!bringItemDraft.trim() || Boolean(planExtrasBusy)}><Plus size={14} />Add</Button>
                </form>
              )}
            </section>
            <section className="plan-extras-section" aria-labelledby="plan-costs-heading">
              <div className="plan-extras-heading">
                <h3 id="plan-costs-heading"><Receipt size={16} />Costs</h3>
                <span>Individual expenses · totals only</span>
              </div>
              {planExtrasQuery.isSuccess && Object.entries(planCostTotals).length > 0 && (
                <div className="plan-cost-totals" aria-label="Expense totals">
                  {Object.entries(planCostTotals).sort(([currencyA], [currencyB]) => currencyA.localeCompare(currencyB)).map(([currency, total]) => (
                    <p key={currency}><span>Total ({currency})</span><strong>{new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(total / 100)} {currency}</strong></p>
                  ))}
                </div>
              )}
              {planExtrasQuery.isSuccess && planExtras?.costs.length === 0 && <p className="plan-extras-state">No expenses recorded yet.</p>}
              {planExtrasQuery.isSuccess && planExtras?.costs.length > 0 && (
                <ul className="plan-extras-list plan-cost-list">
                  {planExtras.costs.map((cost) => {
                    const paidBy = planExtras.profiles[cost.paid_by]?.name || 'A member';
                    const canRemove = cost.paid_by === user?.id || selectedPlan.created_by === user?.id || canManageSelectedPlan;
                    return (
                      <li className="plan-cost-item" key={cost.id}>
                        <span className="plan-cost-copy">
                          <strong>{new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(cost.amount))} {cost.currency}</strong>
                          <small>{cost.note || `Paid by ${paidBy}`}{cost.note ? ` · Paid by ${paidBy}` : ''}</small>
                        </span>
                        {canRemove && <button
                          type="button"
                          className="plan-extras-remove"
                          onClick={() => removePlanCost(cost.id)}
                          disabled={Boolean(planExtrasBusy)}
                          aria-label={`Remove cost ${cost.amount} ${cost.currency}`}
                        ><Trash2 size={14} /></button>}
                      </li>
                    );
                  })}
                </ul>
              )}
              {selectedPlan.status === 'active' && (
                <form className="plan-cost-form" onSubmit={submitPlanCost}>
                  <label className="chat-plan-field">
                    <span>Amount</span>
                    <input className="ui-input" type="number" inputMode="decimal" min="0.01" max="9999999999.99" step="0.01" value={costAmountDraft} onChange={(event) => setCostAmountDraft(event.target.value)} placeholder="0.00" required />
                  </label>
                  <label className="chat-plan-field">
                    <span>Currency</span>
                    <input className="ui-input plan-cost-currency" value={costCurrencyDraft} maxLength={3} onChange={(event) => setCostCurrencyDraft(event.target.value.toUpperCase())} aria-label="Three-letter currency code" required />
                  </label>
                  <label className="chat-plan-field plan-cost-note">
                    <span>Note <small>Optional</small></span>
                    <input className="ui-input" value={costNoteDraft} maxLength={200} onChange={(event) => setCostNoteDraft(event.target.value)} placeholder="What was this for?" />
                  </label>
                  <Button type="submit" size="sm" loading={planExtrasBusy === 'cost-add'} disabled={!costAmountDraft || !/^[A-Z]{3}$/.test(costCurrencyDraft.trim()) || Boolean(planExtrasBusy)}><Plus size={14} />Add expense</Button>
                </form>
              )}
            </section>
            {(planExtrasError || planExtrasRealtimeError) && (
              <div className="plan-extras-error" role="alert">
                <p>{planExtrasError || planExtrasRealtimeError}</p>
                {!planExtrasError && planExtrasRealtimeError && <Button size="sm" variant="secondary" onClick={() => planExtrasQuery.refetch()}>Refresh</Button>}
              </div>
            )}
            {planActionError && <p className="chat-plan-form-error" role="alert">{planActionError}</p>}
            <div className="chat-plan-detail-actions">
              <Button variant="secondary" onClick={() => downloadPlanCalendarFile(selectedPlan)}><CalendarPlus size={15} />Add to calendar</Button>
              {canManageSelectedPlan && selectedPlan.created_by === user.id && selectedPlan.status === 'active' && new Date(selectedPlan.starts_at) > new Date() && <Button variant="secondary" loading={nudgeBusy} onClick={nudgeUnconfirmed}>Nudge unconfirmed</Button>}
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
