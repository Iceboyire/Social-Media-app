import { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
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
const AdminPage = lazy(() => import('./pages/AdminPage').then((module) => ({ default: module.AdminPage })));
const ConversationPage = lazy(() => import('./pages/ConversationPage').then((module) => ({ default: module.ConversationPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then((module) => ({ default: module.SettingsPage })));
const MyProfilePage = lazy(() => import('./pages/MyProfilePage').then((module) => ({ default: module.MyProfilePage })));
const UserProfilePage = lazy(() => import('./pages/UserProfilePage').then((module) => ({ default: module.UserProfilePage })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const OnboardingPage = lazy(() => import('./pages/OnboardingPage').then((module) => ({ default: module.OnboardingPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then((module) => ({ default: module.ResetPasswordPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));

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
  return (
    <Suspense fallback={<LoadingScreen />}>
      <Routes>
        <Route element={<ProfileBoundary />}>
          <Route path="/reset-password" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><ResetPasswordPage /></AuthScreen>} />
          <Route element={<PublicOnlyRoute />}>
            <Route path="/login" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><LoginPage /></AuthScreen>} />
            <Route path="/signup" element={<AuthScreen dark={dark} onToggleTheme={onToggleTheme}><SignupPage /></AuthScreen>} />
          </Route>
          <Route element={<ProtectedRoute />}>
            <Route path="/onboarding" element={<OnboardingPage dark={dark} onToggleTheme={onToggleTheme} />} />
            <Route element={<MainLayout dark={dark} onToggleTheme={onToggleTheme} />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/friends" element={<FriendsPage />} />
              <Route path="/requests" element={<RequestsPage />} />
              <Route path="/messages" element={<MessagesPage />} />
              <Route path="/messages/:conversationId" element={<ConversationPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  );
}

export default function App() {
  const [dark, setDark] = useState(() => {
    try {
      return localStorage.getItem('gather-theme') === 'dark';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('gather-theme', dark ? 'dark' : 'light');
    } catch {
      // Theme still works for this session when storage is unavailable.
    }
  }, [dark]);

  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ToastProvider>
          <AuthProvider>
            <AppRoutes dark={dark} onToggleTheme={() => setDark((current) => !current)} />
          </AuthProvider>
        </ToastProvider>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
