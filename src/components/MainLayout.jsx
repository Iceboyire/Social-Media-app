import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import {
  Bell,
  ChevronDown,
  Compass,
  Home,
  LogOut,
  Mail,
  Menu,
  Moon,
  Search,
  ShieldCheck,
  Settings,
  Sun,
  UsersRound,
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Brand } from './Brand';
import { LoadingScreen } from './LoadingScreen';
import { Avatar } from './ui/Avatar';
import { CountBadge } from './ui/Badge';
import { SearchResult } from './SearchResult';
import { Dropdown } from './ui/Dropdown';
import { useAppCounts } from '../hooks/useAppCounts';
import { supabase } from '../lib/supabase';
import { useProfile } from '../hooks/useProfile';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

const NotificationBell = lazy(() => import('./NotificationCenter').then((module) => ({ default: module.NotificationBell })));

const mainLinks = [
  { to: '/', label: 'Home', icon: Home, end: true },
  { to: '/friends', label: 'Friends', icon: UsersRound, badge: 'friends' },
  { to: '/messages', label: 'Messages', icon: Mail, badge: 'messages' },
  { to: '/notifications', label: 'Notifications', icon: Bell, badge: 'notifications' },
];

export function MainLayout({ dark, onToggleTheme }) {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading: profileLoading } = useProfile();
  const counts = useAppCounts();
  const queryClient = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const menuRef = useRef(null);
  const searchRef = useRef(null);
  const normalizedSearch = search.trim();
  const searchWaiting = normalizedSearch.length >= 2 && normalizedSearch !== debouncedSearch;

  useEffect(() => {
    if (counts.isError) toast(counts.error.message || 'Unread counts could not be updated.');
  }, [counts.isError, counts.error, toast]);

  useEffect(() => {
    if (!user?.id || !supabase) return undefined;
    let active = true;
    const updatePresence = async () => {
      const { error } = await supabase
        .from('profiles')
        .update({ last_seen: new Date().toISOString() })
        .eq('id', user.id);
      if (error && active) toast(error.message || 'Your online status could not be updated.');
      if (!error && active) {
        queryClient.setQueryData(['profile', user.id], (current) => (
          current ? { ...current, last_seen: new Date().toISOString() } : current
        ));
      }
    };
    updatePresence();
    const timer = window.setInterval(updatePresence, 120_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user?.id, toast, queryClient]);

  const searchResults = useQuery({
    queryKey: ['user-search', user?.id, debouncedSearch],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase.rpc('search_users', { query: debouncedSearch });
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id && searchOpen && debouncedSearch.length >= 2),
    staleTime: 15_000,
    retry: false,
  });

  useEffect(() => {
    function closeMenu(event) {
      if (!menuRef.current?.contains(event.target)) setMenuOpen(false);
      if (!searchRef.current?.contains(event.target)) setSearchOpen(false);
    }
    function onEscape(event) {
      if (event.key === 'Escape') {
        setMenuOpen(false);
        setMobileMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', closeMenu);
    document.addEventListener('keydown', onEscape);
    return () => {
      document.removeEventListener('mousedown', closeMenu);
      document.removeEventListener('keydown', onEscape);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(normalizedSearch);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [normalizedSearch]);

  async function handleSignOut() {
    setLoggingOut(true);
    try {
      await signOut();
      toast('You’ve been signed out.', 'success');
      navigate('/login', { replace: true });
    } catch (error) {
      toast(error.message || 'We could not sign you out.');
    } finally {
      setLoggingOut(false);
    }
  }

  const name = profile?.name || user?.user_metadata?.name || 'Your profile';
  const avatar = <Avatar src={profile?.photo_url} name={name} size="sm" online={Boolean(profile?.last_seen && Date.now() - new Date(profile.last_seen).getTime() < 5 * 60_000)} />;

  if (profileLoading && !profile) return <LoadingScreen message="Getting your space ready…" />;

  return (
    <div className={`app-shell${/^\/messages\/[^/]+/.test(location.pathname) ? ' app-shell-chat-open' : ''}`}>
      <header className="app-navbar">
        <div className="app-navbar-inner">
          <button
            className="mobile-menu-button"
            type="button"
            aria-label={mobileMenuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen((open) => !open)}
          >
            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <Brand to="/home" />
          <div className={`app-search-wrap${searchOpen ? ' search-is-open' : ''}`} ref={searchRef}>
            <Search size={17} aria-hidden="true" />
            <input
              aria-label="Search people"
              type="search"
              placeholder="Search people..."
              value={search}
              aria-expanded={searchOpen && normalizedSearch.length >= 2}
              aria-controls="navbar-search-results"
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearchOpen(false);
              }}
              onFocus={() => setSearchOpen(true)}
              onChange={(event) => setSearch(event.target.value)}
            />
            {search && <button className="search-clear" aria-label="Clear search" type="button" onClick={() => setSearch('')}><X size={15} /></button>}
            {searchOpen && normalizedSearch.length >= 2 && (
              <div className="search-popover" id="navbar-search-results" role="region" aria-label="People search results">
                {(searchWaiting || searchResults.isFetching) && <p className="search-message">Searching…</p>}
                {!searchWaiting && searchResults.isError && <p className="search-message search-message-error">{searchResults.error.message || 'Search is unavailable right now.'}<button type="button" onClick={() => searchResults.refetch()}>Try again</button></p>}
                {!searchWaiting && !searchResults.isFetching && !searchResults.isError && searchResults.data?.length === 0 && <p className="search-message">No people found.</p>}
                {!searchWaiting && !searchResults.isFetching && !searchResults.isError && searchResults.data?.map((result) => (
                  <SearchResult
                    key={result.id}
                    profile={result}
                    onNavigate={() => {
                      setSearch('');
                      setSearchOpen(false);
                    }}
                  />
                ))}
              </div>
            )}
          </div>
          <nav className="navbar-actions" aria-label="Quick navigation">
            {mainLinks.slice(1).filter(({ badge }) => badge !== 'notifications').map(({ to, label, icon: Icon, badge }) => (
              <NavLink className={({ isActive }) => `navbar-icon-link${isActive ? ' navbar-icon-active' : ''}`} to={to} aria-label={label} title={label} key={to}>
                <Icon size={19} strokeWidth={1.8} />
                <CountBadge count={counts.data?.[badge] ?? 0} />
              </NavLink>
            ))}
            <Suspense fallback={<NavLink className="navbar-icon-link" to="/notifications" aria-label="Notifications" title="Notifications"><Bell size={19} strokeWidth={1.8} /><CountBadge count={counts.data?.notifications ?? 0} /></NavLink>}>
              <NotificationBell count={counts.data?.notifications ?? 0} />
            </Suspense>
          </nav>
          <div className="profile-menu" ref={menuRef}>
            <button
              className="profile-menu-trigger"
              type="button"
              onClick={() => setMenuOpen((open) => !open)}
              aria-expanded={menuOpen}
              aria-label="Open profile menu"
            >
              {avatar}
              <span className="profile-menu-name">{name}</span>
              <ChevronDown size={15} className={menuOpen ? 'chevron-open' : ''} />
            </button>
            <Dropdown open={menuOpen} className="profile-dropdown">
                <div className="dropdown-person">
                  {avatar}
                  <span><strong>{name}</strong><small>@{profile?.username}</small></span>
                </div>
                <div className="dropdown-divider" />
                <NavLink to="/profile" onClick={() => setMenuOpen(false)}><UsersRound size={16} /> My Profile</NavLink>
                {profile?.role === 'admin' && <NavLink to="/admin" onClick={() => setMenuOpen(false)}><ShieldCheck size={16} /> Admin console</NavLink>}
                <NavLink to="/settings" onClick={() => setMenuOpen(false)}><Settings size={16} /> Settings</NavLink>
                <button type="button" onClick={onToggleTheme} aria-pressed={dark}>{dark ? <Sun size={16} /> : <Moon size={16} />}{dark ? 'Light mode' : 'Dark mode'}<span className={`theme-switch${dark ? ' theme-switch-on' : ''}`} /></button>
                <div className="dropdown-divider" />
                <button className="dropdown-logout" type="button" onClick={handleSignOut} disabled={loggingOut}>
                  <LogOut size={16} />{loggingOut ? 'Signing out…' : 'Log out'}
                </button>
            </Dropdown>
          </div>
        </div>
        {mobileMenuOpen && (
          <nav className="mobile-drawer" aria-label="Main navigation">
            {mainLinks.map(({ to, label, icon: Icon, badge, end }) => (
              <NavLink end={end} to={to} key={to} onClick={() => setMobileMenuOpen(false)} className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}>
                <Icon size={19} /><span>{label}</span>{badge && <CountBadge count={counts.data?.[badge] ?? 0} />}
              </NavLink>
            ))}
            <NavLink to="/profile" className="sidebar-link" onClick={() => setMobileMenuOpen(false)}><UsersRound size={19} /><span>My Profile</span></NavLink>
            <NavLink to="/settings" className="sidebar-link" onClick={() => setMobileMenuOpen(false)}><Settings size={19} /><span>Settings</span></NavLink>
          </nav>
        )}
      </header>
      <div className="app-frame">
        <aside className="app-sidebar" aria-label="Main navigation">
          <span className="sidebar-heading">YOUR SPACE</span>
          <nav className="sidebar-nav">
            {mainLinks.map(({ to, label, icon: Icon, badge, end }) => (
              <NavLink end={end} to={to} key={to} className={({ isActive }) => `sidebar-link${isActive ? ' sidebar-link-active' : ''}`}>
                <Icon size={19} strokeWidth={1.8} /><span>{label}</span>{badge && <CountBadge count={counts.data?.[badge] ?? 0} />}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-note"><Compass size={17} /><span><strong>Your people, your pace.</strong><small>A good place to be.</small></span></div>
            <span className="sidebar-version">GATHER · YOUR SPACE</span>
          </div>
        </aside>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
      <nav className="mobile-tab-bar" aria-label="Mobile navigation">
        {mainLinks.map(({ to, label, icon: Icon, badge, end }) => (
          <NavLink end={end} to={to} key={to} className={({ isActive }) => `mobile-tab${isActive ? ' mobile-tab-active' : ''}`}>
            <span className="mobile-tab-icon"><Icon size={21} strokeWidth={1.8} />{badge && <CountBadge count={counts.data?.[badge] ?? 0} />}</span>
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
