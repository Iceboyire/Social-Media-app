import { ArrowRight, Check, Mail, UserRound } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { FormField } from '../components/FormField';
import { PasswordInput } from '../components/PasswordInput';
import { PhotoCropper } from '../components/PhotoCropper';
import { UsernameField } from '../components/UsernameField';
import { uploadAvatar } from '../lib/avatar';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function SignupPage() {
  const { signUp, configured } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [photo, setPhoto] = useState(null);
  const [availability, setAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);

  function validate() {
    const nextErrors = {};
    if (!name.trim()) nextErrors.name = 'Tell us what to call you.';
    else if (name.trim().length > 80) nextErrors.name = 'Keep your name under 80 characters.';
    if (!/^[a-z0-9_]{3,24}$/.test(username.trim().toLowerCase())) {
      nextErrors.username = 'Use 3–24 letters, numbers, or underscores.';
    } else if (!availability) {
      nextErrors.username = availabilityError
        ? 'We could not check this username. Please try again.'
        : 'Choose an available username.';
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) nextErrors.email = 'Enter a valid email address.';
    if (password.length < 8) nextErrors.password = 'Use at least 8 characters.';
    if (confirmPassword !== password) nextErrors.confirmPassword = 'Your passwords do not match.';
    return nextErrors;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const nextErrors = validate();
    setErrors(nextErrors);
    setServerError('');
    if (Object.keys(nextErrors).length) return;

    setBusy(true);
    let createdUser = null;
    try {
      const { data, error } = await signUp({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim(),
        password,
      });
      if (error) throw error;
      createdUser = data.user;

      if (!data.session || !createdUser) {
        setSuccess(true);
        toast('Your account is ready. Confirm your email, then sign in to finish your profile.', 'success');
        return;
      }

      if (photo) {
        try {
          const photoUrl = await uploadAvatar(createdUser.id, photo);
          const { error: profileError } = await supabase
            .from('profiles')
            .update({ photo_url: photoUrl })
            .eq('id', createdUser.id);
          if (profileError) throw profileError;
          queryClient.invalidateQueries({ queryKey: ['profile', createdUser.id] });
        } catch (uploadError) {
          toast(`Your account was created, but the photo could not be saved. You can add it during setup. ${uploadError.message}`, 'error');
        }
      }
      navigate('/onboarding', { replace: true });
    } catch (error) {
      const message = error.message || 'We could not create your account. Please try again.';
      setServerError(message);
      toast(message);
    } finally {
      setBusy(false);
    }
  }

  if (success) {
    return (
      <div className="auth-form-wrap">
        <div className="form-heading">
          <span className="form-kicker">ONE LAST LITTLE STEP</span>
          <h2>Check your inbox<span className="heading-period">.</span></h2>
          <p>We sent a confirmation link to <strong>{email}</strong>. Confirm your email, then come back to finish your profile.</p>
        </div>
        <div className="success-panel"><span className="success-panel-icon"><Check size={19} /></span><span>Your account has been created. Your photo and profile setup will be ready after you confirm your email.</span></div>
        <button className="button button-primary button-submit" type="button" onClick={() => navigate('/login', { replace: true })}>Go to sign in <ArrowRight size={17} /></button>
      </div>
    );
  }

  return (
    <div className="auth-form-wrap signup-form-wrap">
      <div className="form-heading">
        <span className="form-kicker">THERE’S ROOM FOR YOU HERE</span>
        <h2>Let’s get you in<span className="heading-period">.</span></h2>
        <p>Your corner starts with a few little details.</p>
      </div>
      {serverError && <div className="inline-alert" role="alert">{serverError}</div>}
      <form className="auth-form signup-form" onSubmit={handleSubmit} noValidate>
        <div className="form-grid-two">
          <FormField
            id="signup-name"
            label="Your name"
            placeholder="How should we call you?"
            autoComplete="name"
            maxLength={80}
            value={name}
            onChange={(event) => setName(event.target.value)}
            error={errors.name}
            leading={<UserRound size={17} />}
          />
          <UsernameField
            value={username}
            onChange={(event) => {
              setUsername(event.target.value.toLowerCase());
              setAvailability(false);
              setAvailabilityError(false);
              setErrors((current) => ({ ...current, username: undefined }));
            }}
            error={errors.username}
            onAvailability={(available, failed) => {
              setAvailability(available);
              setAvailabilityError(failed);
            }}
          />
        </div>
        <FormField
          id="signup-email"
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
        <PasswordInput
          id="signup-password"
          label="Create a password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          error={errors.password}
          showStrength
        />
        <PasswordInput
          id="confirm-password"
          label="Confirm your password"
          autoComplete="new-password"
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          error={errors.confirmPassword}
        />
        <PhotoCropper onCropped={setPhoto} onToast={toast} />
        <button className="button button-primary button-submit" type="submit" disabled={busy || !configured}>
          {busy ? <><span className="button-spinner" /> Creating your account…</> : <>Create my account <ArrowRight size={17} /></>}
        </button>
      </form>
      {!configured && <p className="config-notice">Add your Supabase URL and anon key to <code>.env.local</code> to enable account creation.</p>}
      <p className="auth-switch">Already have a little corner here? <Link to="/login">Sign in <ArrowRight size={14} /></Link></p>
    </div>
  );
}
