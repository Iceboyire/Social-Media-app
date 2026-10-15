import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../providers/AuthProvider';
import { LoadingScreen } from './LoadingScreen';
import { supabase } from '../lib/supabase';
import { EmptyState } from './ui/EmptyState';
import { ShieldAlert } from 'lucide-react';
import { Button } from './ui/Button';

export function ProtectedRoute() {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <LoadingScreen message="Restoring your session…" />;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

export function PublicOnlyRoute() {
  const { user, loading } = useAuth();
  if (loading) return <LoadingScreen message="Restoring your session…" />;
  if (user) return <Navigate to="/" replace />;
  return <Outlet />;
}

export function ProtectedAdminRoute() {
  const { user } = useAuth();
  const adminCheck = useQuery({
    queryKey: ['admin-access', user?.id],
    enabled: Boolean(user?.id),
    retry: false,
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const [roleResult, permissionResult] = await Promise.all([
        supabase.from('profiles').select('role, status').eq('id', user.id).maybeSingle(),
        supabase.rpc('is_admin'),
      ]);
      if (roleResult.error) throw roleResult.error;
      if (permissionResult.error) throw permissionResult.error;
      return roleResult.data?.role === 'admin'
        && roleResult.data?.status === 'active'
        && permissionResult.data === true;
    },
  });

  if (adminCheck.isLoading) return <LoadingScreen message="Verifying administrator access…" />;
  if (adminCheck.isError) {
    return (
      <div className="app-page-content">
        <EmptyState icon={ShieldAlert} title="Admin access could not be verified" description={adminCheck.error.message || 'Try again after checking your connection.'} />
        <div className="admin-access-retry"><Button variant="secondary" onClick={() => adminCheck.refetch()}>Try again</Button></div>
      </div>
    );
  }
  if (!adminCheck.data) return <Navigate to="/" replace />;
  return <Outlet />;
}
