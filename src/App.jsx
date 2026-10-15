import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AuthLayout } from './components/AuthLayout';
import { ProfileBoundary } from './components/ProfileBoundary';
import { ProtectedAdminRoute, ProtectedRoute, PublicOnlyRoute } from './components/ProtectedRoute';
import { AuthProvider } from './providers/AuthProvider';
import { ToastProvider } from './providers/ToastProvider';
import { LoadingScreen } from './components/LoadingScreen';
import { MainLayout } from './components/MainLayout';

const HomePage = lazy(() => import('./pages/HomePage').then((module) => ({ default: module.HomePage })));
const FriendsPage = lazy(() => import('./pages/FriendsPage').then((module) => ({ default: module.FriendsPage })));
const RequestsPage = lazy(() => import('./pages/RequestsPage').then((module) => ({ default: module.RequestsPage })));
const MessagesPage = lazy(() => import('./pages/MessagesPage').then((module) => ({ default: module.MessagesPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const CalendarPage = lazy(() => import('./pages/CalendarPage').then((module) => ({ default: module.CalendarPage })));
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const MyProfilePage = lazy(() => import('./pages/MyProfilePage').then((module) => ({ default: module.MyProfilePage })));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage').then((module) => ({ default: module.UserProfilePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const LandingPage = lazy(() => import('./pages/LandingPage').then((module) => ({ default: module.LandingPage })));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy').then((module) => ({ default: module.PrivacyPolicy })));
const LegalPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.LegalPage })));
const NotFoundPage = lazy(() => import('./pages/LegalPages').then((module) => ({ default: module.NotFoundPage })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: true,
    },
  },
});

function AuthScreen({ dark, onToggleTheme, children }) {
  return <AuthLayout dark={dark} onToggleTheme={onToggleTheme}>{children}</AuthLayout>;
}

function AppRoutes({ dark, onToggleTheme }) {
  const location = useLocation();

  useEffect(() => {
    const routeMetadata = [
      { path: '/', title: 'Welcome', description: 'A quieter place to stay close to the people who matter.' },
      { path: '/home', title: 'Home', description: 'A quieter space for the people who make life feel like life.' },
      { path: '/login', title: 'Sign in', description: 'Sign in to reconnect with your people on Gather.' },
      { path: '/signup', title: 'Create an account', description: 'Create your Gather account and make your space yours.' },
      { path: '/reset-password', title: 'Reset password', description: 'Reset or update your Gather account password.' },
      { path: '/onboarding', title: 'Finish your profile', description: 'Add the details you want your people to see.' },
      { path: '/friends', title: 'Friends', description: 'Find and keep up with the people you have connected with.' },
      { path: '/requests', title: 'Friend requests', description: 'Review invitations to connect on Gather.' },
      { path: '/messages', title: 'Messages', description: 'Pick up a conversation with your people.' },
      { path: '/notifications', title: 'Notifications', description: 'See what is happening in your Gather space.' },
      { path: '/calendar', title: 'Calendar', description: 'See upcoming plans and find a time to gather with your people.' },
      { path: '/admin', title: 'Admin console', description: 'Manage the Gather community.' },
      { path: '/profile', title: 'My profile', description: 'View the details you share with your people.' },
      { path: '/profile/edit', title: 'Edit profile', description: 'Update your Gather photo and profile details.' },
      { path: '/settings', title: 'Settings', description: 'Manage your profile, appearance, and account settings.' },
      { path: '/privacy', title: 'Privacy Policy', documentTitle: 'Privacy Policy | Gather', description: 'Read the Gather Privacy Policy to learn how NEMA handles personal information.' },
      { path: '/terms', title: 'Terms of Service', description: 'Review the terms for using Gather.' },
    ];
    const page = routeMetadata.find(({ path }) => path === location.pathname)
      ?? (location.pathname.startsWith('/profile/') && location.pathname !== '/profile/edit'
        ? { title: 'Profile', description: 'Get to know someone in your Gather community.' }
        : location.pathname.startsWith('/messages/')
          ? { title: 'Conversation', description: 'Continue your conversation on Gather.' }
          : { title: 'Page not found', description: 'This Gather page could not be found.' });
    const title = page.documentTitle ?? `${page.title} — Gather`;
    document.title = title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', page.description);
    document.querySelector('meta[property="og:title"]')?.setAttribute('content', title);
    document.querySelector('meta[property="og:description"]')?.setAttribute('content', page.description);
    document.querySelector('meta[name="twitter:title"]')?.setAttribute('content', title);
    document.querySelector('meta[name="twitter:description"]')?.setAttribute('content', page.description);
  }, [location.pathname]);

  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/privacy" element={<PrivacyPolicy />} />
        <Route path="/terms" element={<LegalPage />} />
        <Route element={<ProfileBoundary />}>
          <Route path="/reset-password" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><ResetPasswordPage /></AuthScreen>} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><LoginPage /></AuthScreen>} />
            <Route path="/signup" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><SignupPage /></AuthScreen>} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/onboarding" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><OnboardingPage /></AuthScreen>} />
            <Route element={<MainLayout dark={dark} onToggleTheme={onToggleTheme} />}>
              <Route path="/home" element={<HomePage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/messages" element={<MessagesPage />}>
                <Route path=":conversationId" element={<ConversationPage />} />
              </Route>
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/calendar" element={<CalendarPage />} />
              <Route element={<ProtectedAdminRoute />}>
                <Route path="/admin" element={<AdminPage />} />
              </Route>
              <Route path="/profile" element={<MyProfilePage />} />
              <Route path="/profile/edit" element={<SettingsPage editProfile dark={dark} onToggleTheme={onToggleTheme} />} />
              <Route path="/profile/:username" element={<UserProfilePage />} />
              <Route path="/settings" element={<SettingsPage dark={dark} onToggleTheme={onToggleTheme} />} />
            </Route>
          </Route>
        </Route>
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => {
    try {
      const savedTheme = localStorage.getItem('gather-theme');
      if (savedTheme) return savedTheme === 'dark';
    } catch {
      // Fall back to the system theme when storage is unavailable.
    }
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  }, [dark]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = (event) => {
      try {
        if (localStorage.getItem('gather-theme')) return;
      } catch {
        // Keep following the system theme when storage is unavailable.
      }
      setDark(event.matches);
    };
    media.addEventListener('change', syncSystemTheme);
    return () => media.removeEventListener('change', syncSystemTheme);
  }, []);

  function toggleTheme() {
    setDark((current) => {
      const next = !current;
      try {
        localStorage.setItem('gather-theme', next ? 'dark' : 'light');
      } catch {
        // Theme still works for this session when storage is unavailable.
      }
      return next;
    });
  }

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes dark={dark} onToggleTheme={toggleTheme} />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
