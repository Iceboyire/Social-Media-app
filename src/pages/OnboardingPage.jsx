import { ArrowRight, Check, MapPin, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhotoCropper } from '../components/PhotoCropper';
import { uploadAvatar } from '../lib/avatar';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function OnboardingPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const updateProfile = useUpdateProfile();
  const navigate = useNavigate();
  const toast = useToast();
  const [bio, setBio] = useState('');
  const [location, setLocation] = useState('');
  const [photo, setPhoto] = useState(null);
  const [photoTouched, setPhotoTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const [initialized, setInitialized] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile || initialized) return;
    setBio(profile.bio ?? '');
    setLocation(profile.location ?? '');
    setInitialized(true);
  }, [profile, initialized]);

  async function finish({ skip = false } = {}) {
    if (saving) return;
    setError('');
    setSaving(true);
    try {
      let photoUrl;
      if (!skip && photoTouched) {
        photoUrl = photo ? await uploadAvatar(user.id, photo) : null;
      }
      const changes = {
        onboarding_completed: true,
        ...(!skip && {
          bio: bio.trim() || null,
          location: location.trim() || null,
          ...(photoTouched && { photo_url: photoUrl }),
        }),
      };
      const savedProfile = await updateProfile.mutateAsync(changes);
      toast(`Your space is ready, ${savedProfile.name}.`, 'success');
      navigate('/home', { replace: true });
    } catch (saveError) {
      const message = saveError.message || 'We could not save your profile. Please try again.';
      setError(message);
      toast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="auth-form-wrap onboarding-form-wrap">
      <div className="form-heading onboarding-heading">
        <span className="form-kicker">ONE LAST STEP</span>
        <h2>Make yourself <em>at home.</em></h2>
        <p>Share as much or as little as feels like you. You can always change it later.</p>
      </div>
      <div className="signup-stepper" aria-label="Account setup progress">
        <div className="signup-step signup-step-done"><span className="signup-step-number"><Check size={15} /></span><span>Account</span><span className="signup-step-line signup-step-line-done" /></div>
        <div className="signup-step signup-step-done"><span className="signup-step-number"><Check size={15} /></span><span>Photo</span><span className="signup-step-line signup-step-line-done" /></div>
        <div className="signup-step signup-step-current"><span className="signup-step-number">3</span><span>Profile</span></div>
      </div>
      <section className="onboarding-card">
        {error && <div className="inline-alert" role="alert">{error}</div>}
        <div className="onboarding-fields">
          <PhotoCropper
            initialUrl={profile?.photo_url}
            onCropped={(nextPhoto, touched) => {
              setPhoto(nextPhoto);
              if (touched) setPhotoTouched(true);
            }}
            onToast={toast}
          />
          <div className="field">
            <div className="field-row">
              <label className="field-label" htmlFor="profile-bio">A little about you <span className="optional-label">OPTIONAL</span></label>
              <span className={`character-count${bio.length >= 150 ? ' character-count-close' : ''}`}>{bio.length}/160</span>
            </div>
            <textarea
              className="text-input bio-input"
              id="profile-bio"
              placeholder="The little things you love, what you’re into lately…"
              maxLength={160}
              rows={3}
              value={bio}
              onChange={(event) => setBio(event.target.value)}
            />
            <p className="field-hint">A few words to help your people know it’s you.</p>
          </div>
          <div className="field">
            <label className="field-label" htmlFor="profile-location">Where you call home <span className="optional-label">OPTIONAL</span></label>
            <div className="input-wrap has-leading">
              <span className="input-leading" aria-hidden="true"><MapPin size={17} /></span>
              <input
                className="text-input"
                id="profile-location"
                type="text"
                placeholder="City, country"
                autoComplete="address-level2"
                maxLength={100}
                value={location}
                onChange={(event) => setLocation(event.target.value)}
              />
            </div>
          </div>
        </div>
        <div className="onboarding-actions">
          <button
            className="button button-primary button-submit"
            type="button"
            onClick={() => finish()}
            disabled={saving}
          >
            {saving
              ? <><span className="button-spinner" /> Saving your space…</>
              : <>Finish setting up <ArrowRight size={17} /></>}
          </button>
          <button className="skip-button" type="button" onClick={() => finish({ skip: true })} disabled={saving}>
            <SkipForward size={15} /> {saving ? 'Saving your space…' : 'I’ll do this later'}
          </button>
        </div>
        <p className="onboarding-private"><span /> Your details are yours. Share only what feels right.</p>
      </section>
    </div>
  );
}
