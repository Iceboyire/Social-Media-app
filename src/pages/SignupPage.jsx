import { ArrowLeft, ArrowRight, Check, CircleCheck, Mail, ShieldCheck, UserRound } from 'lucide-react';
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
  const { signUp, resendSignUpConfirmation, configured } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [privacyPolicyAccepted, setPrivacyPolicyAccepted] = useState(false);
  const [photo, setPhoto] = useState(null);
  const [availability, setAvailability] = useState(false);
  const [availabilityError, setAvailabilityError] = useState(false);
  const [errors, setErrors] = useState({});
  const [serverError, setServerError] = useState('');
  const [success, setSuccess] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState('');
  const [step, setStep] = useState(1);

  function validateAccount() {
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
    if (!privacyPolicyAccepted) nextErrors.privacyPolicy = 'You must agree to the Privacy Policy to create an account.';
    return nextErrors;
  }

  async function createAccount() {
    setServerError('');
    setBusy(true);
    let createdUser = null;
    try {
      const { data, error } = await signUp({
        name: name.trim(),
        username: username.trim().toLowerCase(),
        email: email.trim(),
        password,
        privacyPolicyAccepted,
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

  async function handleSubmit(event) {
    event.preventDefault();
    if (step === 1) {
      const nextErrors = validateAccount();
      setErrors(nextErrors);
      setServerError('');
      if (Object.keys(nextErrors).length) return;
      setStep(2);
      return;
    }
    if (!privacyPolicyAccepted) {
      const message = 'You must agree to the Privacy Policy to create an account.';
      setErrors((current) => ({ ...current, privacyPolicy: message }));
      setServerError(message);
      return;
    }
    await createAccount();
  }

  async function resendConfirmation() {
    if (resending) return;
    setResending(true);
    setResendMessage('');
    try {
      const { error } = await resendSignUpConfirmation(email.trim());
      if (error) throw error;
      setResendMessage('A fresh confirmation link is on its way. Check your inbox and spam folder.');
      toast('Confirmation email sent.', 'success');
    } catch (error) {
      const message = error.message || 'We could not resend the confirmation email. Please try again.';
      setResendMessage(message);
      toast(message);
    } finally {
      setResending(false);
    }
  }

  if (success) {
    return (
      <div className="auth-form-wrap auth-form-wrap-compact">
        <div className="auth-success-mark"><Mail size={28} /></div>
        <div className="form-heading">
          <span className="form-kicker">YOU’RE ALMOST IN</span>
          <h2>Check your email<span className="heading-period">.</span></h2>
          <p>We sent a confirmation link to <strong>{email}</strong>. Verify your address, then sign in to finish making your space yours.</p>
        </div>
        <div className="email-check-hint"><span className="email-check-icon"><CircleCheck size={18} /></span><span>Your account is reserved. After confirming, you can add your photo and finish your profile.</span></div>
        {resendMessage && <p className={`resend-feedback${resendMessage.startsWith('A fresh') ? ' resend-feedback-success' : ''}`} role={resendMessage.startsWith('A fresh') ? 'status' : 'alert'}>{resendMessage}</p>}
        <button className="button button-primary button-submit" type="button" onClick={() => navigate('/login', { replace: true })}>Continue to sign in <ArrowRight size={17} /></button>
        <button className="resend-button" type="button" onClick={resendConfirmation} disabled={resending}>
          {resending ? <><span className="button-spinner button-spinner-dark" /> Sending a fresh link…</> : 'Didn’t get the email? Resend confirmation'}
        </button>
      </div>
    );
  }

  return (
    <div className="auth-form-wrap signup-form-wrap">
      <div className="form-heading">
        <span className="form-kicker">A BETTER WAY TO STAY CLOSE</span>
        <h2>{step === 1 ? 'Make it yours' : 'Add your face to the circle'}<span className="heading-period">.</span></h2>
        <p>{step === 1 ? 'Start with the basics. You can make everything else yours later.' : 'A photo helps your people spot you. You can always skip this for now.'}</p>
      </div>
      {serverError && <div className="inline-alert" role="alert">{serverError}</div>}
      <div className="signup-stepper" aria-label="Account setup progress">
        {[
          { id: 1, label: 'Account' },
          { id: 2, label: 'Photo' },
          { id: 3, label: 'Profile' },
        ].map((item, index) => (
          <div className={`signup-step${step === item.id ? ' signup-step-current' : ''}${step > item.id ? ' signup-step-done' : ''}`} key={item.id}>
            <span className="signup-step-number">{step > item.id ? <Check size={15} /> : item.id}</span>
            <span>{item.label}</span>
            {index < 2 && <span className={`signup-step-line${step > item.id ? ' signup-step-line-done' : ''}`} />}
          </div>
        ))}
      </div>
      <form className="auth-form signup-form" onSubmit={handleSubmit} noValidate>
        {step === 1 ? (
          <>
            <div className="signup-account-fields">
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
            <div className="signup-privacy-consent">
              <div className="signup-privacy-consent-row">
                <input
                  id="signup-privacy-policy"
                  type="checkbox"
                  checked={privacyPolicyAccepted}
                  required
                  aria-invalid={Boolean(errors.privacyPolicy)}
                  aria-describedby={errors.privacyPolicy ? 'signup-privacy-error' : undefined}
                  onChange={(event) => {
                    setPrivacyPolicyAccepted(event.target.checked);
                    if (event.target.checked) {
                      setErrors((current) => ({ ...current, privacyPolicy: undefined }));
                      setServerError('');
                    }
                  }}
                />
                <span><label htmlFor="signup-privacy-policy">I agree to the</label> <a href="/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a></span>
              </div>
              {errors.privacyPolicy && <p className="signup-privacy-error" id="signup-privacy-error" role="alert">{errors.privacyPolicy}</p>}
            </div>
            <button className="button button-primary button-submit" type="submit" disabled={!configured}>Continue <ArrowRight size={17} /></button>
          </>
        ) : (
          <>
            <PhotoCropper className="signup-photo-step" onCropped={setPhoto} onToast={toast} />
            <div className="photo-step-note"><ShieldCheck size={17} /><span>Your photo is only shared with people who can see your profile.</span></div>
            <button className="button button-primary button-submit" type="submit" disabled={busy || !configured || !privacyPolicyAccepted}>
              {busy ? <><span className="button-spinner" /> Creating your account…</> : <>Create my account <ArrowRight size={17} /></>}
            </button>
            <button className="signup-back-button" type="button" onClick={() => setStep(1)} disabled={busy}><ArrowLeft size={15} /> Back to account details</button>
          </>
        )}
      </form>
      {!configured && <p className="config-notice">Add your Supabase URL and anon key to <code>.env.local</code> to enable account creation.</p>}
      <p className="auth-switch">{step === 1 ? 'Already have a space here?' : 'Already have an account?'} <Link to="/login">Sign in <ArrowRight size={14} /></Link></p>
      <p className="auth-legal-link"><Link to="/privacy">Privacy Policy</Link></p>
    </div>
  );
}
