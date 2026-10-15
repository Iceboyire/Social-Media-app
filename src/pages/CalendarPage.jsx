import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownToLine, CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Modal } from '../components/ui/Modal';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

const RESPONSE_OPTIONS = [
  { value: 'going', label: 'Going' },
  { value: 'maybe', label: 'Maybe' },
  { value: 'declined', label: 'Can’t' },
];

function monthKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}`;
}

function sameDay(first, second) {
  return first.getFullYear() === second.getFullYear()
    && first.getMonth() === second.getMonth()
    && first.getDate() === second.getDate();
}

function dateLabel(date) {
  return new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(date);
}

function eventTime(value) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function escapeIcs(value) {
  return String(value ?? '').replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
}

function exportPlans(plans) {
  const toUtc = (value) => new Date(value).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const events = plans.flatMap((plan) => [
    'BEGIN:VEVENT',
    `UID:${plan.id}@gather`,
    `DTSTAMP:${toUtc(new Date().toISOString())}`,
    `DTSTART:${toUtc(plan.starts_at)}`,
    ...(plan.ends_at ? [`DTEND:${toUtc(plan.ends_at)}`] : []),
    `SUMMARY:${escapeIcs(plan.title)}`,
    ...(plan.location_text ? [`LOCATION:${escapeIcs(plan.location_text)}`] : []),
    'END:VEVENT',
  ]);
  const file = new Blob([['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Gather//Calendar//EN', ...events, 'END:VCALENDAR', ''].join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(file);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'gather-calendar.ics';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function fetchCalendarData(userId, fromMonth) {
  const { data: plans, error: plansError } = await supabase
    .from('plans')
    .select('id, conversation_id, created_by, title, description, starts_at, ends_at, location_text, status, created_at')
    .gte('starts_at', fromMonth.toISOString())
    .order('starts_at')
    .limit(1000);
  if (plansError) throw plansError;
  const planIds = (plans ?? []).map((plan) => plan.id);
  const conversationIds = [...new Set((plans ?? []).map((plan) => plan.conversation_id))];
  const [responsesResult, conversationsResult, membersResult, circlesResult, circleMembersResult, actionableResult] = await Promise.all([
    planIds.length ? supabase.from('plan_responses').select('plan_id, user_id, response, updated_at').in('plan_id', planIds) : Promise.resolve({ data: [], error: null }),
    conversationIds.length ? supabase.from('conversations').select('id, name, type').in('id', conversationIds) : Promise.resolve({ data: [], error: null }),
    conversationIds.length ? supabase.from('conversation_members').select('conversation_id, user_id, left_at').in('conversation_id', conversationIds).is('left_at', null) : Promise.resolve({ data: [], error: null }),
    supabase.from('circles').select('id, name, color').eq('owner_id', userId),
    supabase.from('circle_members').select('circle_id, friend_id'),
    conversationIds.length
      ? supabase.rpc('get_actionable_plan_conversations', { p_conversation_ids: conversationIds })
      : Promise.resolve({ data: [], error: null }),
  ]);
  for (const result of [responsesResult, conversationsResult, membersResult, circlesResult, circleMembersResult, actionableResult]) {
    if (result.error) throw result.error;
  }
  const profileIds = [...new Set([
    ...(plans ?? []).map((plan) => plan.created_by),
    ...(responsesResult.data ?? []).map((response) => response.user_id),
    ...(membersResult.data ?? []).map((member) => member.user_id),
  ])];
  const { data: profiles, error: profilesError } = profileIds.length
    ? await supabase.from('profiles').select('id, name, username, photo_url').in('id', profileIds)
    : { data: [], error: null };
  if (profilesError) throw profilesError;

  return {
    plans: plans ?? [],
    responses: responsesResult.data ?? [],
    conversations: Object.fromEntries((conversationsResult.data ?? []).map((conversation) => [conversation.id, conversation])),
    members: membersResult.data ?? [],
    profiles: Object.fromEntries((profiles ?? []).map((profile) => [profile.id, profile])),
    circles: circlesResult.data ?? [],
    circleMembers: circleMembersResult.data ?? [],
    actionableConversationIds: actionableResult.data ?? [],
  };
}

export function CalendarPage() {
  const { user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [view, setView] = useState('month');
  const [filter, setFilter] = useState('all');
  const [circleFilter, setCircleFilter] = useState('');
  const [selectedDay, setSelectedDay] = useState(() => new Date());
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [busyId, setBusyId] = useState('');
  const query = useQuery({
    queryKey: ['calendar', user?.id, monthKey(month)],
    queryFn: () => fetchCalendarData(user.id, month),
    enabled: Boolean(user?.id),
    retry: 1,
  });

  useEffect(() => {
    if (!user?.id) return undefined;
    const channel = supabase.channel(`calendar-${user.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plans' }, () => queryClient.invalidateQueries({ queryKey: ['calendar', user.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'plan_responses' }, () => queryClient.invalidateQueries({ queryKey: ['calendar', user.id] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circle_members' }, () => queryClient.invalidateQueries({ queryKey: ['calendar', user.id] }))
      .subscribe((status) => {
        if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') toast('Live calendar updates are unavailable. Refresh to see the latest plans.');
      });
    return () => { supabase.removeChannel(channel); };
  }, [user?.id, queryClient, toast]);

  const data = query.data;
  const filteredPlans = useMemo(() => {
    if (!data) return [];
    return data.plans.filter((plan) => {
      const response = data.responses.find((item) => item.plan_id === plan.id && item.user_id === user.id)?.response;
      if (filter === 'going' && response !== 'going') return false;
      if (filter === 'maybe' && response !== 'maybe') return false;
      if (filter === 'needs-answer' && response) return false;
      if (circleFilter) {
        const friendIds = data.circleMembers.filter((item) => item.circle_id === circleFilter).map((item) => item.friend_id);
        if (!data.members.some((member) => member.conversation_id === plan.conversation_id && friendIds.includes(member.user_id))) return false;
      }
      return true;
    });
  }, [data, filter, circleFilter, user?.id]);
  const currentMonthPlans = filteredPlans.filter((plan) => {
    const date = new Date(plan.starts_at);
    return date.getFullYear() === month.getFullYear() && date.getMonth() === month.getMonth();
  });
  const selectedDayPlans = filteredPlans.filter((plan) => sameDay(new Date(plan.starts_at), selectedDay));
  const upcomingPlans = filteredPlans.filter((plan) => new Date(plan.starts_at).getTime() > Date.now());
  const selectedPlan = data?.plans.find((plan) => plan.id === selectedPlanId);
  const selectedResponses = data?.responses.filter((item) => item.plan_id === selectedPlanId) ?? [];

  async function respond(plan, response) {
    if (busyId) return;
    setBusyId(plan.id);
    try {
      const { error } = await supabase.rpc('respond_to_plan', { p_plan_id: plan.id, p_response: response });
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['calendar', user.id] }),
        queryClient.invalidateQueries({ queryKey: ['calendar-unanswered', user.id] }),
      ]);
      toast(response === 'declined' ? 'Your response was updated.' : `You’re marked ${response}.`, 'success');
    } catch (error) {
      toast(error.message || 'Your response could not be saved.');
    } finally {
      setBusyId('');
    }
  }

  function responseFor(planId) {
    return data?.responses.find((response) => response.plan_id === planId && response.user_id === user.id)?.response ?? '';
  }

  function circleColorFor(plan) {
    const memberIds = data?.members.filter((member) => member.conversation_id === plan.conversation_id).map((member) => member.user_id) ?? [];
    const matching = data?.circleMembers.find((membership) => memberIds.includes(membership.friend_id));
    return data?.circles.find((circle) => circle.id === matching?.circle_id)?.color;
  }

  function planTitle(plan) {
    const conversation = data.conversations[plan.conversation_id];
    if (conversation?.type === 'group') return conversation.name || 'Group chat';
    const friend = data.members.find((member) => member.conversation_id === plan.conversation_id && member.user_id !== user.id);
    return friend ? data.profiles[friend.user_id]?.name || 'Direct chat' : 'Conversation';
  }

  function renderPlan(plan) {
    const attendees = data.responses.filter((item) => item.plan_id === plan.id && item.response === 'going')
      .map((item) => data.profiles[item.user_id]).filter(Boolean).slice(0, 5);
    return (
      <article className={`calendar-plan-item${plan.status === 'cancelled' ? ' calendar-plan-cancelled' : ''}`} key={plan.id}>
        <button type="button" className="calendar-plan-main" onClick={() => setSelectedPlanId(plan.id)} aria-label={`Open plan ${plan.title}`}>
          <span className="calendar-plan-color" style={{ background: circleColorFor(plan) || 'var(--app-blue)' }} />
          <span className="calendar-plan-copy"><strong>{plan.title}</strong><small><Clock3 size={13} />{eventTime(plan.starts_at)}{plan.location_text ? <><span>·</span><MapPin size={13} />{plan.location_text}</> : null}</small><small><UsersRound size={13} />{planTitle(plan)}</small></span>
          <span className="chat-plan-avatar-stack">{attendees.map((profile) => <Avatar key={profile.id} src={profile.photo_url} name={profile.name} size="xs" />)}</span>
          {plan.status === 'cancelled' && <span className="chat-plan-cancelled-badge">Cancelled</span>}
        </button>
        {plan.status === 'active' && data.actionableConversationIds.includes(plan.conversation_id) && <div className="calendar-plan-responses">
          {RESPONSE_OPTIONS.map((option) => <button type="button" key={option.value} aria-pressed={responseFor(plan.id) === option.value} disabled={busyId === plan.id} onClick={() => respond(plan, option.value)}>{option.label}</button>)}
        </div>}
      </article>
    );
  }

  const monthLabel = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' }).format(month);
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const leadingDays = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const calendarCells = [...Array(leadingDays).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  while (calendarCells.length % 7) calendarCells.push(null);

  return (
    <div className="app-page-content calendar-page">
      <AppPageHeader eyebrow="MAKE TIME TOGETHER" title="Calendar" description="Plans and possibilities with your people." action={<Button variant="secondary" onClick={() => exportPlans((data?.plans ?? []).filter((plan) => plan.status === 'active' && new Date(plan.starts_at).getTime() > Date.now() && ['going', 'maybe'].includes(responseFor(plan.id))))} disabled={!data?.plans.some((plan) => plan.status === 'active' && new Date(plan.starts_at).getTime() > Date.now() && ['going', 'maybe'].includes(responseFor(plan.id)))}><ArrowDownToLine size={15} /> Export</Button>} />
      <div className="calendar-filters">
        <div className="calendar-filter-group" aria-label="Filter plans">
          {[['all', 'All'], ['going', 'Going'], ['maybe', 'Maybe'], ['needs-answer', 'Needs my answer']].map(([value, label]) => <button type="button" key={value} className={filter === value ? 'calendar-filter-active' : ''} onClick={() => setFilter(value)}>{label}</button>)}
        </div>
        <label className="calendar-circle-filter">Circle
          <select value={circleFilter} onChange={(event) => setCircleFilter(event.target.value)}><option value="">All circles</option>{data?.circles.map((circle) => <option value={circle.id} key={circle.id}>{circle.name}</option>)}</select>
        </label>
      </div>
      {query.isLoading && <div className="calendar-loading">{[1, 2, 3].map((key) => <Skeleton className="people-skeleton" key={key} />)}</div>}
      {query.isError && <EmptyState icon={CalendarDays} title="Calendar didn’t load" description={query.error.message || 'Your plans could not be loaded.'} action={<Button size="sm" variant="secondary" onClick={() => query.refetch()}>Try again</Button>} />}
      {data && <Card className="calendar-card">
        <div className="calendar-view-toolbar">
          <div className="calendar-month-switch"><Button size="sm" variant="secondary" aria-label="Previous month" onClick={() => { const nextMonth = new Date(month.getFullYear(), month.getMonth() - 1, 1); setMonth(nextMonth); setSelectedDay(nextMonth); }}><ChevronLeft size={17} /></Button><h2>{monthLabel}</h2><Button size="sm" variant="secondary" aria-label="Next month" onClick={() => { const nextMonth = new Date(month.getFullYear(), month.getMonth() + 1, 1); setMonth(nextMonth); setSelectedDay(nextMonth); }}><ChevronRight size={17} /></Button></div>
          <div className="calendar-view-switch" role="group" aria-label="Calendar view"><button type="button" className={view === 'month' ? 'calendar-filter-active' : ''} onClick={() => setView('month')}>Month</button><button type="button" className={view === 'agenda' ? 'calendar-filter-active' : ''} onClick={() => setView('agenda')}>Agenda</button></div>
        </div>
        {view === 'month' && <>
          <div className="calendar-weekdays">{['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day) => <span key={day}>{day}</span>)}</div>
          <div className="calendar-month-grid">{calendarCells.map((day, index) => {
            const date = day ? new Date(month.getFullYear(), month.getMonth(), day) : null;
            const dayPlans = date ? currentMonthPlans.filter((plan) => sameDay(new Date(plan.starts_at), date)) : [];
            return <button type="button" key={`${monthKey(month)}-${index}`} className={`calendar-day${date && sameDay(date, selectedDay) ? ' calendar-day-selected' : ''}${date && sameDay(date, new Date()) ? ' calendar-day-today' : ''}`} disabled={!date} onClick={() => date && setSelectedDay(date)} aria-label={date ? `${dateLabel(date)}${dayPlans.length ? `, ${dayPlans.length} plans` : ''}` : undefined}>
              {day && <><span className="calendar-day-number">{day}</span><span className="calendar-day-plan-dots">{dayPlans.slice(0, 3).map((plan) => <i key={plan.id} style={{ background: plan.status === 'cancelled' ? 'var(--app-faint)' : circleColorFor(plan) || 'var(--app-blue)' }} />)}</span><span className="calendar-day-plan-count">{dayPlans.length ? `${dayPlans.length} ${dayPlans.length === 1 ? 'plan' : 'plans'}` : ''}</span></>}
            </button>;
          })}</div>
          <section className="calendar-agenda"><h3>{dateLabel(selectedDay)}</h3>{selectedDayPlans.length ? selectedDayPlans.map(renderPlan) : <p className="calendar-empty-day">No plans for this day.</p>}</section>
        </>}
        {view === 'agenda' && (upcomingPlans.length ? <div className="calendar-agenda calendar-agenda-full">
          {[...new Set(upcomingPlans.map((plan) => new Date(plan.starts_at).toDateString()))].map((date) => <section key={date}><h3>{dateLabel(new Date(date))}</h3>{upcomingPlans.filter((plan) => new Date(plan.starts_at).toDateString() === date).map(renderPlan)}</section>)}
        </div> : <EmptyState icon={CalendarDays} title="No plans yet" description="Create one from any chat." action={<Link className="ui-button ui-button-secondary" to="/messages">Open messages</Link>} />)}
        {!query.isLoading && filteredPlans.length === 0 && view === 'month' && <EmptyState icon={CalendarDays} title="No plans yet" description="Create one from any chat." action={<Link className="ui-button ui-button-secondary" to="/messages">Open messages</Link>} />}
      </Card>}
      {selectedPlan && <Modal open onClose={() => setSelectedPlanId('')} title={selectedPlan.title} size="md" className="calendar-plan-drawer">
        <div className="calendar-plan-details">
          <p className={`chat-plan-detail-status${selectedPlan.status === 'cancelled' ? ' is-cancelled' : ''}`}>{selectedPlan.status === 'cancelled' ? 'Cancelled' : `${dateLabel(new Date(selectedPlan.starts_at))} · ${eventTime(selectedPlan.starts_at)}`}</p>
          {selectedPlan.location_text && <p className="chat-plan-detail-meta"><MapPin size={15} />{selectedPlan.location_text}</p>}
          {selectedPlan.description && <p className="chat-plan-detail-description">{selectedPlan.description}</p>}
          <p className="chat-plan-detail-meta"><UsersRound size={15} />{planTitle(selectedPlan)}</p>
          <section className="chat-plan-response-groups">
            {RESPONSE_OPTIONS.map((option) => {
              const responses = selectedResponses.filter((response) => response.response === option.value);
              return <div className="chat-plan-response-group" key={option.value}><h3>{option.label} <span>{responses.length}</span></h3>{responses.length ? responses.map((response) => { const profile = data.profiles[response.user_id]; return <div className="chat-plan-response-person" key={response.user_id}><Avatar src={profile?.photo_url} name={profile?.name || 'Member'} size="xs" /><span>{profile?.name || 'Member'}</span></div>; }) : <p>No responses yet.</p>}</div>;
            })}
          </section>
          <div className="calendar-plan-detail-actions"><Link className="ui-button ui-button-secondary" to={`/messages/${selectedPlan.conversation_id}`}>Open chat</Link>{selectedPlan.status === 'active' && data.actionableConversationIds.includes(selectedPlan.conversation_id) && RESPONSE_OPTIONS.map((option) => <Button key={option.value} size="sm" variant={responseFor(selectedPlan.id) === option.value ? 'primary' : 'secondary'} disabled={busyId === selectedPlan.id} onClick={() => respond(selectedPlan, option.value)}>{option.label}</Button>)}</div>
        </div>
      </Modal>}
    </div>
  );
}
