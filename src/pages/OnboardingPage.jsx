import { ArrowRight, MapPin, SkipForward } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PhotoCropper } from '../components/PhotoCropper';
import { ThemeToggle } from '../components/ThemeToggle';
import { Brand } from '../components/Brand';
import { uploadAvatar } from '../lib/avatar';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function OnboardingPage({ dark, onToggleTheme }) {
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
      navigate('/', { replace: true });
    } catch (saveError) {
      const message = saveError.message || 'We could not save your profile. Please try again.';
      setError(message);
      toast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <div className="onboarding-topbar">
        <Brand />
        <ThemeToggle dark={dark} onToggle={onToggleTheme} />
      </div>
      <section className="onboarding-card">
        <div className="onboarding-progress" aria-label="Profile setup">
          <span className="progress-step progress-step-done"><i>✓</i> YOUR ACCOUNT</span>
          <span className="progress-line" />
          <span className="progress-step progress-step-current"><i>02</i> YOUR CORNER</span>
        </div>
        <div className="onboarding-heading">
          <span className="form-kicker">A COUPLE MORE DETAILS</span>
          <h1>Make yourself <em>at home.</em></h1>
          <p>Share as much or as little as feels like you. You can always change it later.</p>
        </div>

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
      <footer className="onboarding-footer">Take your time. There’s no rush here.</footer>
    </main>
  );
}
