import { ArrowRight, Mail } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PasswordInput } from '../components/PasswordInput';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function LoginPage() {
  const { signIn, configured } = useAuth();
  const toast = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [busy, setBusy] = useState(false);
  const notice = location.state?.notice;

  useEffect(() => {
    if (!notice) return;
    toast(notice);
    navigate(location.pathname, { replace: true, state: {} });
  }, [notice, toast, navigate, location.pathname]);

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (!email.trim()) nextErrors.email = 'Enter your email address.';
    if (!password) nextErrors.password = 'Enter your password.';
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      const { error } = await signIn({ email: email.trim(), password });
      if (error) throw error;
      navigate(location.state?.from?.pathname || '/', { replace: true });
    } catch (error) {
      const message = error.message || 'We could not sign you in. Please try again.';
      setServerError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-form-wrap">
      <div className="form-heading">
        <span className="form-kicker">PICK UP WHERE YOU LEFT OFF</span>
        <h2>Welcome back<span className="heading-period">.</span></h2>
        <p>Your people are right where you left them.</p>
      </div>
      {serverError && <div className="inline-alert" role="alert">{serverError}</div>}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        <FormField
          id="login-email"
          label="Email address"
          type="email"
          placeholder="you@example.com"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          error={errors.email}
          leading={<Mail size={17} />}
        />
        <div className="field-group">
          <div className="field-row">
            <span />
            <Link className="text-link small-link" to="/reset-password">Forgot password?</Link>
          </div>
          <PasswordInput
            id="login-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            error={errors.password}
          />
        </div>
        <button className="button button-primary button-submit" type="submit" disabled={busy || !configured}>
          {busy ? <><span className="button-spinner" /> Signing you in…</> : <>Sign in <ArrowRight size={17} /></>}
        </button>
      </form>
      {!configured && <p className="config-notice">Authentication is not connected yet. Add your Supabase URL and anon key to <code>.env.local</code>.</p>}
      <p className="auth-switch">New around here? <Link to="/signup">Create an account <ArrowRight size={14} /></Link></p>
      <p className="auth-legal-link"><Link to="/privacy">Privacy Policy</Link></p>
      <div className="form-trust"><span /> A quieter space, just for you</div>
    </div>
  );
}
