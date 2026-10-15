import { useEffect, useRef, useState } from 'react';
import { Navigate, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { AlertTriangle, LogOut, RefreshCw } from 'lucide-react';
import { useProfile } from '../hooks/useProfile';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { LoadingScreen } from './LoadingScreen';

function ProfileProblem({ retry, signOut }) {
  return (
    <main className="full-page-message">
      <div className="message-card">
        <span className="message-icon message-icon-error"><AlertTriangle size={23} /></span>
        <span className="form-kicker">WE COULDN’T LOAD YOUR PROFILE</span>
        <h1>Let’s try that again.</h1>
        <p>Your profile couldn’t be reached. Check your connection and try again.</p>
        <div className="message-actions">
          <button className="button button-primary" type="button" onClick={retry}><RefreshCw size={16} /> Try again</button>
          <button className="button button-ghost" type="button" onClick={signOut}><LogOut size={16} /> Sign out</button>
        </div>
      </div>
    </main>
  );
}

function AccountBlocked({ message, retrySignOut, error, retrying }) {
  return (
    <main className="full-page-message">
      <div className="message-card">
        <span className="message-icon message-icon-error"><AlertTriangle size={23} /></span>
        <span className="form-kicker">ACCOUNT ACCESS</span>
        <h1>This account can’t sign in.</h1>
        <p>{message}</p>
        {error && <p className="field-error">{error}</p>}
        <div className="message-actions">
          <button className="button button-primary" type="button" onClick={retrySignOut} disabled={retrying}>
            {retrying ? <span className="button-spinner" /> : <LogOut size={16} />}
            {retrying ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      </div>
    </main>
  );
}

export function ProfileBoundary() {
  const { user, signOut } = useAuth();
  const { data: profile, isLoading, isError, error, refetch } = useProfile();
  const location = useLocation();
  const navigate = useNavigate();
  const toast = useToast();
  const handledBlockedUser = useRef(null);
  const [blockedSignOutError, setBlockedSignOutError] = useState('');
  const [retryingSignOut, setRetryingSignOut] = useState(false);
  const isPasswordReset = location.pathname === '/reset-password';
  const blocked = profile?.status === 'suspended' || profile?.status === 'banned';
  const blockedMessage = profile?.status === 'banned'
    ? 'This account has been banned. You have been signed out. Contact support if you believe this is a mistake.'
    : 'This account is suspended. You have been signed out. Contact support for help restoring access.';

  useEffect(() => {
    if (!user || !blocked) {
      handledBlockedUser.current = null;
      setBlockedSignOutError('');
    }
  }, [user, blocked]);

  useEffect(() => {
    if (!isError) return;
    toast(error?.message || 'Your profile could not be loaded.');
  }, [isError, error, toast]);

  useEffect(() => {
    if (!blocked || !user?.id || handledBlockedUser.current === user.id) return undefined;
    handledBlockedUser.current = user.id;
    signOut()
      .then(() => {
        navigate('/login', { replace: true, state: { notice: blockedMessage } });
      })
      .catch((signOutError) => {
        const message = signOutError.message || 'We could not sign you out automatically.';
        setBlockedSignOutError(message);
        toast(message);
      })
      .finally(() => setRetryingSignOut(false));
  }, [blocked, blockedMessage, navigate, signOut, toast, user?.id]);

  async function retrySignOut() {
    setRetryingSignOut(true);
    setBlockedSignOutError('');
    try {
      await signOut();
      navigate('/login', { replace: true, state: { notice: blockedMessage } });
    } catch (signOutError) {
      const message = signOutError.message || 'We could not sign you out.';
      setBlockedSignOutError(message);
      toast(message);
    } finally {
      setRetryingSignOut(false);
    }
  }

  if (!user) return <Outlet />;
  if (isLoading) return <LoadingScreen message="Getting your space ready…" />;
  if (blocked) return blockedSignOutError
    ? <AccountBlocked message={blockedMessage} error={blockedSignOutError} retrySignOut={retrySignOut} retrying={retryingSignOut} />
    : <LoadingScreen message="This account can’t sign in. Signing you out…" />;
  if (isError) return <ProfileProblem retry={() => refetch()} signOut={() => signOut().catch((signOutError) => toast(signOutError.message))} />;
  if (!profile) return <ProfileProblem retry={() => refetch()} signOut={() => signOut().catch((signOutError) => toast(signOutError.message))} />;
  if (isPasswordReset) return <Outlet />;
  if (!profile.onboarding_completed && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }
  if (profile.onboarding_completed && location.pathname === '/onboarding') {
    return <Navigate to="/" replace />;
  }
  return <Outlet />;
}
