import { ArrowLeft, Check, Mail } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FormField } from '../components/FormField';
import { PasswordInput } from '../components/PasswordInput';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const { resetPassword, updatePassword, configured } = useAuth();
  const toast = useToast();
  const updating = searchParams.get('mode') === 'update';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [complete, setComplete] = useState(false);
  const [serverError, setServerError] = useState('');

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = {};
    if (updating) {
      if (password.length < 8) nextErrors.password = 'Use at least 8 characters.';
      if (password !== confirmation) nextErrors.confirmation = 'Your passwords do not match.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      nextErrors.email = 'Enter a valid email address.';
    }
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    try {
      if (updating) {
        const { error } = await updatePassword(password);
        if (error) throw error;
        setComplete(true);
        toast('Your password has been updated.', 'success');
      } else {
        const { error } = await resetPassword(email.trim());
        if (error) throw error;
        setSent(true);
        toast('If an account exists for that email, a reset link is on its way.', 'success');
      }
    } catch (error) {
      setServerError(error.message || 'We could not complete that request.');
      toast(error.message || 'We could not complete that request.');
    } finally {
      setBusy(false);
    }
  }

  if (complete || sent) {
    return (
      <div className="auth-form-wrap">
        <div className="form-heading">
          <span className="form-kicker">{complete ? 'ALL SET' : 'CHECK YOUR INBOX'}</span>
          <h2>{complete ? 'You’re back in control.' : 'A fresh start is on its way.'}</h2>
          <p>{complete ? 'Your password has been changed. You can sign in with it now.' : 'If there’s an account for that email, we’ll send a link to reset your password.'}</p>
        </div>
        <div className="success-panel"><span className="success-panel-icon"><Check size={19} /></span><span>{complete ? 'Password updated successfully.' : `A reset link is on its way${email ? ` to ${email}` : ''}.`}</span></div>
        <Link className="button button-primary button-submit button-link" to="/login">Back to sign in <ArrowLeft size={17} /></Link>
      </div>
    );
  }

  return (
    <div className="auth-form-wrap">
      <div className="form-heading">
        <span className="form-kicker">{updating ? 'A FRESH START' : 'WE’LL GET YOU BACK IN'}</span>
        <h2>{updating ? 'Choose a new password.' : 'Forgot your password?'}</h2>
        <p>{updating ? 'Make it something only you know.' : 'No worries. It happens to the best of us.'}</p>
      </div>
      {serverError && <div className="inline-alert" role="alert">{serverError}</div>}
      <form className="auth-form" onSubmit={handleSubmit} noValidate>
        {updating ? (
          <>
            <PasswordInput id="new-password" label="New password" autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} error={errors.password} showStrength />
            <PasswordInput id="new-password-confirm" label="Confirm new password" autoComplete="new-password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} error={errors.confirmation} />
          </>
        ) : (
          <FormField id="reset-email" label="Email address" type="email" placeholder="you@example.com" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} error={errors.email} leading={<Mail size={17} />} />
        )}
        <button className="button button-primary button-submit" type="submit" disabled={busy || !configured}>
          {busy ? <><span className="button-spinner" /> {updating ? 'Saving password…' : 'Sending reset link…'}</> : <>{updating ? 'Save new password' : 'Send me a reset link'} <ArrowLeft className="arrow-right-icon" size={17} /></>}
        </button>
      </form>
      <Link className="back-link" to="/login"><ArrowLeft size={15} /> Back to sign in</Link>
      {!configured && <p className="config-notice">Add your Supabase URL and anon key to <code>.env.local</code> to enable password recovery.</p>}
    </div>
  );
}
