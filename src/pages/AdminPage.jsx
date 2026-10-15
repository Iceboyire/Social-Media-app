import { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowUp,
  Ban,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Flag,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

const PAGE_SIZE = 10;
const adminTabs = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'users', label: 'Users', icon: Users },
  { id: 'reports', label: 'Reports', icon: Flag },
];

const numberFormat = new Intl.NumberFormat();
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function formatDay(day) {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${day}T00:00:00`));
}

function StatCard({ icon: Icon, label, value, note, tone = 'blue' }) {
  return (
    <article className={`admin-stat admin-stat-${tone}`}>
      <span className="admin-stat-icon"><Icon size={18} /></span>
      <span className="admin-stat-label">{label}</span>
      <strong>{value == null ? '—' : numberFormat.format(value)}</strong>
      <small>{note}</small>
    </article>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="admin-chart-tooltip">
      <strong>{label}</strong>
      {payload.map((item) => <span key={item.dataKey}><i style={{ background: item.color }} />{item.name}: {numberFormat.format(item.value)}</span>)}
    </div>
  );
}

function useAdminDashboard() {
  return useQuery({
    queryKey: ['admin-dashboard'],
    queryFn: async () => {
      const [statsResult, seriesResult] = await Promise.all([
        supabase.rpc('admin_dashboard_stats'),
        supabase.rpc('admin_signups_by_day', { days: 30 }),
      ]);
      if (statsResult.error) throw statsResult.error;
      if (seriesResult.error) throw seriesResult.error;
      return {
        stats: statsResult.data?.[0] ?? null,
        series: (seriesResult.data ?? []).map((row) => ({ ...row, label: formatDay(row.signup_day) })),
      };
    },
  });
}

function OverviewTab() {
  const dashboard = useAdminDashboard();
  if (dashboard.isError) {
    return <EmptyState icon={ShieldAlert} title="Dashboard data unavailable" description={dashboard.error.message || 'The protected dashboard RPCs could not be loaded.'} />;
  }
  const stats = dashboard.data?.stats;
  return (
    <div className="admin-panel">
      <div className="admin-stat-grid">
        {dashboard.isLoading
          ? [1, 2, 3, 4].map((item) => <Skeleton className="admin-stat-skeleton" key={item} />)
          : <>
            <StatCard icon={Users} label="Total users" value={stats?.total_users} note="Registered profiles" />
            <StatCard icon={Activity} label="Active users" value={stats?.active_users} note="Seen in the last 30 days" tone="green" />
            <StatCard icon={ArrowUp} label="Messages sent" value={stats?.total_messages} note="Across all conversations" tone="purple" />
            <StatCard icon={Users} label="Groups created" value={stats?.total_groups} note="Group conversations" tone="amber" />
          </>}
      </div>
      {!dashboard.isLoading && stats && (
        <div className="admin-stat-summary">
          <span><strong>{numberFormat.format(stats.suspended_users)}</strong> suspended</span>
          <span><strong>{numberFormat.format(stats.banned_users)}</strong> banned</span>
          <span><strong>{numberFormat.format(stats.open_reports)}</strong> open reports</span>
        </div>
      )}
      <div className="admin-chart-grid">
        <section className="admin-card admin-chart-card">
          <header><div><span className="admin-eyebrow">GROWTH</span><h2>New signups</h2></div><span className="admin-chart-range">Last 30 days</span></header>
          {dashboard.isLoading
            ? <Skeleton className="admin-chart-skeleton" />
            : <ResponsiveContainer width="100%" height={250}>
              <AreaChart data={dashboard.data?.series ?? []} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                <defs><linearGradient id="signupFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#2563eb" stopOpacity={0.22} /><stop offset="95%" stopColor="#2563eb" stopOpacity={0.01} /></linearGradient></defs>
                <CartesianGrid stroke="var(--app-line)" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--app-faint)', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--app-faint)', fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="signups" name="Signups" stroke="#2563eb" strokeWidth={2} fill="url(#signupFill)" />
              </AreaChart>
            </ResponsiveContainer>}
        </section>
        <section className="admin-card admin-chart-card">
          <header><div><span className="admin-eyebrow">ACTIVITY</span><h2>Messages and groups</h2></div><span className="admin-chart-range">Last 30 days</span></header>
          {dashboard.isLoading
            ? <Skeleton className="admin-chart-skeleton" />
            : <ResponsiveContainer width="100%" height={250}>
              <LineChart data={dashboard.data?.series ?? []} margin={{ top: 12, right: 12, left: -18, bottom: 0 }}>
                <CartesianGrid stroke="var(--app-line)" strokeDasharray="3 4" vertical={false} />
                <XAxis dataKey="label" tick={{ fill: 'var(--app-faint)', fontSize: 9 }} axisLine={false} tickLine={false} minTickGap={18} />
                <YAxis allowDecimals={false} tick={{ fill: 'var(--app-faint)', fontSize: 9 }} axisLine={false} tickLine={false} />
                <Tooltip content={<ChartTooltip />} />
                <Legend wrapperStyle={{ color: 'var(--app-muted)', fontSize: 10 }} />
                <Line type="monotone" dataKey="messages_sent" name="Messages" stroke="#7c3aed" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="groups_created" name="Groups" stroke="#f59e0b" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>}
        </section>
      </div>
    </div>
  );
}

function fetchUsers({ search, status, page }) {
  let request = supabase
    .from('profiles')
    .select('id, name, username, photo_url, role, status, last_seen, created_at', { count: 'exact' })
    .order('created_at', { ascending: false })
    .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
  if (status !== 'all') request = request.eq('status', status);
  const term = search.trim().replace(/[,%()\\"*]/g, ' ').replace(/\s+/g, ' ');
  if (term) request = request.or(`name.ilike.%${term}%,username.ilike.%${term}%`);
  return request.then(({ data, count, error }) => {
    if (error) throw error;
    return { rows: data ?? [], count: count ?? 0 };
  });
}

function UsersTab({ currentUserId }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(0);
  const [pendingAction, setPendingAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const users = useQuery({
    queryKey: ['admin-users', debouncedSearch, status, page],
    queryFn: () => fetchUsers({ search: debouncedSearch, status, page }),
    placeholderData: (previous) => previous,
  });
  const totalPages = Math.max(1, Math.ceil((users.data?.count ?? 0) / PAGE_SIZE));

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);
  useEffect(() => setPage(0), [debouncedSearch, status]);

  async function updateStatus() {
    if (!pendingAction || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_set_user_status', {
        user: pendingAction.user.id,
        status: pendingAction.status,
      });
      if (error) throw error;
      toast(`${pendingAction.user.name} is now ${pendingAction.status}.`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-users'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] }),
      ]);
      setPendingAction(null);
    } catch (error) {
      toast(error.message || 'The account status could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  function scheduleAction(user, nextStatus) {
    const action = nextStatus === 'active' ? 'reinstate' : nextStatus === 'suspended' ? 'suspend' : 'ban';
    setPendingAction({ user, status: nextStatus, action });
  }

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <label className="admin-search"><Search size={16} /><input aria-label="Search users" placeholder="Search name or username" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
        <select aria-label="Filter users by status" className="admin-select" value={status} onChange={(event) => setStatus(event.target.value)}>
          <option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option><option value="banned">Banned</option>
        </select>
        <span className="admin-result-count">{numberFormat.format(users.data?.count ?? 0)} users</span>
      </div>
      <section className="admin-card admin-table-card">
        <div className="admin-table-scroll">
          <table className="admin-table">
            <thead><tr><th>User</th><th>Joined</th><th>Last seen</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>
              {users.isLoading && [1, 2, 3].map((item) => <tr key={item}><td colSpan="5"><Skeleton className="admin-row-skeleton" /></td></tr>)}
              {users.isError && <tr><td colSpan="5"><EmptyState icon={Users} title="Users could not be loaded" description={users.error.message} /></td></tr>}
              {!users.isLoading && !users.isError && users.data?.rows.map((profile) => (
                <tr key={profile.id}>
                  <td><div className="admin-user-cell"><Avatar src={profile.photo_url} name={profile.name} size="sm" /><span><strong>{profile.name}</strong><small>@{profile.username}{profile.role === 'admin' ? ' · Admin' : ''}</small></span></div></td>
                  <td>{dateFormat.format(new Date(profile.created_at))}</td>
                  <td>{profile.last_seen ? dateFormat.format(new Date(profile.last_seen)) : 'Never'}</td>
                  <td><span className={`admin-status admin-status-${profile.status}`}>{profile.status}</span></td>
                  <td><div className="admin-row-actions">
                    {profile.id === currentUserId || profile.role === 'admin'
                      ? <span className="admin-protected-user">Protected</span>
                      : <>
                        {profile.status === 'active' && <><Button size="sm" variant="secondary" onClick={() => scheduleAction(profile, 'suspended')}><Shield size={13} /> Suspend</Button><Button size="sm" variant="danger" onClick={() => scheduleAction(profile, 'banned')}><Ban size={13} /> Ban</Button></>}
                        {profile.status !== 'active' && <Button size="sm" onClick={() => scheduleAction(profile, 'active')}><Check size={13} /> Reinstate</Button>}
                      </>}
                  </div></td>
                </tr>
              ))}
              {!users.isLoading && !users.isError && users.data?.rows.length === 0 && <tr><td colSpan="5"><EmptyState icon={Users} title="No users found" description="Try a different search or status filter." /></td></tr>}
            </tbody>
          </table>
        </div>
        <div className="admin-pagination">
          <span>Page {page + 1} of {totalPages}</span>
          <div><Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={15} /> Previous</Button><Button variant="secondary" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={15} /></Button></div>
        </div>
      </section>
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        onConfirm={updateStatus}
        loading={busy}
        destructive={pendingAction?.status !== 'active'}
        title={pendingAction ? `${pendingAction.action[0].toUpperCase()}${pendingAction.action.slice(1)} account?` : 'Confirm action'}
        message={pendingAction ? `${pendingAction.user.name} will be ${pendingAction.status === 'active' ? 'restored to active status' : pendingAction.status}.` : ''}
        confirmLabel={pendingAction?.action ? `${pendingAction.action[0].toUpperCase()}${pendingAction.action.slice(1)}` : 'Confirm'}
      />
    </div>
  );
}

async function fetchReports(status, page) {
  const start = page * PAGE_SIZE;
  const { data, count, error } = await supabase
    .from('reports')
    .select('id, reporter_id, reported_user_id, message_id, reason, note, status, resolved_by, created_at', { count: 'exact' })
    .eq('status', status)
    .order('created_at', { ascending: false })
    .range(start, start + PAGE_SIZE - 1);
  if (error) throw error;
  const reports = data ?? [];
  const profileIds = [...new Set(reports.flatMap((report) => [report.reporter_id, report.reported_user_id, report.resolved_by]).filter(Boolean))];
  const messageIds = [...new Set(reports.map((report) => report.message_id).filter(Boolean))];
  const [profilesResult, messagesResult] = await Promise.all([
    profileIds.length ? supabase.from('profiles').select('id, name, username, photo_url').in('id', profileIds) : Promise.resolve({ data: [], error: null }),
    messageIds.length ? supabase.from('messages').select('id, body, image_url, created_at, conversation_id, sender_id').in('id', messageIds) : Promise.resolve({ data: [], error: null }),
  ]);
  if (profilesResult.error) throw profilesResult.error;
  if (messagesResult.error) throw messagesResult.error;
  const profiles = new Map((profilesResult.data ?? []).map((profile) => [profile.id, profile]));
  const messages = new Map((messagesResult.data ?? []).map((message) => [message.id, message]));
  return {
    count: count ?? 0,
    rows: reports.map((report) => ({
      ...report,
      reporter: profiles.get(report.reporter_id),
      reportedUser: profiles.get(report.reported_user_id),
      resolver: profiles.get(report.resolved_by),
      message: messages.get(report.message_id),
    })),
  };
}

function ReportsTab() {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('open');
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState(null);
  const [pendingAction, setPendingAction] = useState(null);
  const [busy, setBusy] = useState(false);
  const reports = useQuery({
    queryKey: ['admin-reports', status, page],
    queryFn: () => fetchReports(status, page),
  });
  const totalPages = Math.max(1, Math.ceil((reports.data?.count ?? 0) / PAGE_SIZE));
  const selectedReport = useMemo(
    () => reports.data?.rows.find((report) => report.id === selected?.id) ?? selected,
    [reports.data, selected],
  );

  useEffect(() => setPage(0), [status]);

  async function resolveReport() {
    if (!pendingAction || busy) return;
    setBusy(true);
    try {
      const { error } = await supabase.rpc('admin_resolve_report', {
        report_id: pendingAction.report.id,
        resolution_action: pendingAction.action,
      });
      if (error) throw error;
      toast(pendingAction.action === 'dismiss' ? 'Report dismissed.' : `Report resolved: ${pendingAction.action}.`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-reports'] }),
        queryClient.invalidateQueries({ queryKey: ['admin-dashboard'] }),
      ]);
      setSelected(null);
      setPendingAction(null);
    } catch (error) {
      toast(error.message || 'The report could not be resolved.');
    } finally {
      setBusy(false);
    }
  }

  function requestAction(report, action) {
    setPendingAction({ report, action });
  }

  return (
    <div className="admin-panel">
      <div className="admin-toolbar">
        <div className="admin-filter-tabs" role="tablist" aria-label="Report status">
          {['open', 'resolved'].map((item) => <button key={item} type="button" role="tab" aria-selected={status === item} className={status === item ? 'admin-filter-active' : ''} onClick={() => setStatus(item)}>{item === 'open' ? 'Open queue' : 'Resolved'}</button>)}
        </div>
        <span className="admin-result-count">{numberFormat.format(reports.data?.count ?? 0)} reports</span>
      </div>
      <section className="admin-card admin-table-card">
        <div className="admin-report-list">
          {reports.isLoading && [1, 2, 3].map((item) => <Skeleton className="admin-report-skeleton" key={item} />)}
          {reports.isError && <EmptyState icon={Flag} title="Reports could not be loaded" description={reports.error.message} />}
          {!reports.isLoading && !reports.isError && reports.data?.rows.map((report) => (
            <button className="admin-report-row" type="button" key={report.id} onClick={() => setSelected(report)}>
              <span className={`admin-report-icon admin-report-${report.status}`}><Flag size={16} /></span>
              <span className="admin-report-summary"><strong>{report.reportedUser?.name || 'Deleted account'} <small>reported by {report.reporter?.name || 'Deleted account'}</small></strong><span>{report.reason}{report.message_id ? ' · Message report' : ' · Profile report'}</span></span>
              <span className="admin-report-date">{dateFormat.format(new Date(report.created_at))}</span>
              <ChevronRight size={17} />
            </button>
          ))}
          {!reports.isLoading && !reports.isError && reports.data?.rows.length === 0 && <EmptyState icon={Flag} title={status === 'open' ? 'Queue is clear' : 'No resolved reports'} description={status === 'open' ? 'New user reports will appear here.' : 'Resolved reports will appear here.'} />}
        </div>
        <div className="admin-pagination"><span>Page {page + 1} of {totalPages}</span><div><Button variant="secondary" size="sm" disabled={page === 0} onClick={() => setPage((current) => Math.max(0, current - 1))}><ChevronLeft size={15} /> Previous</Button><Button variant="secondary" size="sm" disabled={page + 1 >= totalPages} onClick={() => setPage((current) => current + 1)}>Next <ChevronRight size={15} /></Button></div></div>
      </section>
      {selectedReport && (
        <div className="admin-drawer-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
          <aside className="admin-report-drawer" aria-label="Report details">
            <header><div><span className="admin-eyebrow">REPORT DETAILS</span><h2>{selectedReport.message_id ? 'Message report' : 'Profile report'}</h2></div><button type="button" aria-label="Close report details" onClick={() => setSelected(null)}><X size={19} /></button></header>
            <div className="admin-drawer-body">
              <div className="admin-report-meta"><span className={`admin-status admin-status-${selectedReport.status}`}>{selectedReport.status}</span><span><Clock3 size={13} />{new Date(selectedReport.created_at).toLocaleString()}</span></div>
              <section className="admin-context-block"><span className="admin-eyebrow">REPORTED USER</span><div className="admin-user-cell"><Avatar src={selectedReport.reportedUser?.photo_url} name={selectedReport.reportedUser?.name || 'Deleted account'} size="md" /><span><strong>{selectedReport.reportedUser?.name || 'Deleted account'}</strong><small>@{selectedReport.reportedUser?.username || 'unknown'}</small></span></div></section>
              <section className="admin-context-block"><span className="admin-eyebrow">REPORTED BY</span><div className="admin-user-cell"><Avatar src={selectedReport.reporter?.photo_url} name={selectedReport.reporter?.name || 'Deleted account'} size="md" /><span><strong>{selectedReport.reporter?.name || 'Deleted account'}</strong><small>@{selectedReport.reporter?.username || 'unknown'}</small></span></div></section>
              <section className="admin-context-block"><span className="admin-eyebrow">REASON</span><p>{selectedReport.reason}</p>{selectedReport.note && <blockquote>{selectedReport.note}</blockquote>}</section>
              {selectedReport.message_id && <section className="admin-context-block"><span className="admin-eyebrow">MESSAGE CONTEXT</span>{selectedReport.message ? <div className="admin-message-context">{selectedReport.message.body && <p>{selectedReport.message.body}</p>}{selectedReport.message.image_url && <a href={selectedReport.message.image_url} target="_blank" rel="noreferrer">View reported image</a>}<small>{new Date(selectedReport.message.created_at).toLocaleString()}</small></div> : <p className="admin-context-muted">The reported message is no longer available.</p>}</section>}
              {selectedReport.resolver && <p className="admin-context-muted">Resolved by {selectedReport.resolver.name}.</p>}
            </div>
            {selectedReport.status === 'open' && <footer className="admin-drawer-actions">
              <Button variant="secondary" onClick={() => requestAction(selectedReport, 'dismiss')}><X size={14} /> Dismiss</Button>
              <Button variant="secondary" onClick={() => requestAction(selectedReport, 'warn')}><ShieldAlert size={14} /> Warn</Button>
              <Button variant="secondary" onClick={() => requestAction(selectedReport, 'suspend')}><Shield size={14} /> Suspend</Button>
              <Button variant="danger" onClick={() => requestAction(selectedReport, 'ban')}><Ban size={14} /> Ban</Button>
            </footer>}
          </aside>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(pendingAction)}
        onClose={() => setPendingAction(null)}
        onConfirm={resolveReport}
        loading={busy}
        destructive={['suspend', 'ban'].includes(pendingAction?.action)}
        title={pendingAction ? `${pendingAction.action[0].toUpperCase()}${pendingAction.action.slice(1)} and resolve report?` : 'Confirm action'}
        message={pendingAction ? pendingAction.action === 'dismiss'
          ? 'This report will be marked resolved without action on the reported account.'
          : pendingAction.action === 'warn'
            ? `${pendingAction.report.reportedUser?.name || 'This user'} will receive an account warning and the report will be resolved.`
            : `${pendingAction.report.reportedUser?.name || 'This user'} will be ${pendingAction.action === 'suspend' ? 'suspended' : 'banned'} and the report will be resolved.`
          : ''}
        confirmLabel={pendingAction?.action ? `${pendingAction.action[0].toUpperCase()}${pendingAction.action.slice(1)}` : 'Confirm'}
      />
    </div>
  );
}

export function AdminPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState('overview');
  return (
    <div className="app-page-content admin-page">
      <header className="admin-page-heading">
        <div><span className="admin-eyebrow">GATHER CONTROL CENTER</span><h1>Admin console</h1><p>Review platform activity and keep the community safe.</p></div>
        <span className="admin-verified"><ShieldCheck size={15} /> Verified admin</span>
      </header>
      <nav className="admin-tabs" aria-label="Admin sections">
        {adminTabs.map(({ id, label, icon: Icon }) => <button type="button" key={id} className={tab === id ? 'admin-tab admin-tab-active' : 'admin-tab'} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}><Icon size={16} />{label}</button>)}
      </nav>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'users' && <UsersTab currentUserId={user?.id} />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
