import { useEffect, useState } from 'react';
import { ArrowLeft, Check, Download, Moon, Sun, Trash2, UserX } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { Input } from '../components/ui/Input';
import { PhotoCropper } from '../components/PhotoCropper';
import { uploadAvatar } from '../lib/avatar';
import { useProfile, useUpdateProfile } from '../hooks/useProfile';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { supabase } from '../lib/supabase';
import { invalidateFriendshipQueries } from '../hooks/useFriendshipRealtime';
import { useAvailability } from '../hooks/useAvailability';

export function SettingsPage({ dark, onToggleTheme, editProfile = false }) {
  const { user } = useAuth();
  const profileQuery = useProfile();
  const updateProfile = useUpdateProfile();
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [unblockingId, setUnblockingId] = useState('');
  const [exportingData, setExportingData] = useState(false);
  const [accountDeletionConfirmation, setAccountDeletionConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [accountActionError, setAccountActionError] = useState('');
  const blockedQuery = useQuery({
    queryKey: ['blocked-users', user?.id],
    queryFn: async () => {
      if (!supabase) throw new Error('Supabase is not configured.');
      const { data, error } = await supabase.rpc('list_blocked_users');
      if (error) throw error;
      return data ?? [];
    },
    enabled: Boolean(user?.id),
    retry: 1,
  });
  const [profile, setProfile] = useState(null);
  const [photo, setPhoto] = useState(null);
  const [photoChanged, setPhotoChanged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const { own: availability } = useAvailability();
  const [visibilitySaving, setVisibilitySaving] = useState(false);
  const [browserNotifications, setBrowserNotifications] = useState(() => {
    try {
      return localStorage.getItem('gather-browser-notifications') === 'true';
    } catch {
      return false;
    }
  });

  async function toggleBrowserNotifications(event) {
    const enabled = event.target.checked;
    if (enabled && typeof window !== 'undefined' && 'Notification' in window) {
      try {
        const permission = await window.Notification.requestPermission();
        if (permission !== 'granted') {
          toast('Browser notification permission was not granted.');
          return;
        }
      } catch (notificationError) {
        toast(notificationError.message || 'Browser notifications could not be enabled.');
        return;
      }
    } else if (enabled) {
      toast('This browser does not support desktop notifications.');
      return;
    }
    try {
      localStorage.setItem('gather-browser-notifications', String(enabled));
      setBrowserNotifications(enabled);
      toast(enabled ? 'Browser notifications are enabled.' : 'Browser notifications are disabled.', 'success');
    } catch (storageError) {
      toast(storageError.message || 'The notification preference could not be saved.');
    }
  }

  async function toggleStatusVisibility(event) {
    const hidden = event.target.checked;
    setVisibilitySaving(true);
    try {
      const { error: visibilityError } = await supabase.rpc('set_availability_hidden', { p_hidden: hidden });
      if (visibilityError) throw visibilityError;
      await queryClient.invalidateQueries({ queryKey: ['availability'] });
      toast(hidden ? 'Your status is hidden from friends.' : 'Your status is visible to friends.', 'success');
    } catch (visibilityError) {
      toast(visibilityError.message || 'Status visibility could not be changed.');
    } finally {
      setVisibilitySaving(false);
    }
  }

  useEffect(() => {
    if (profileQuery.isError) toast(profileQuery.error.message || 'Your profile could not be loaded.');
  }, [profileQuery.isError, profileQuery.error, toast]);
  useEffect(() => {
    if (blockedQuery.isError) toast(blockedQuery.error.message || 'Blocked users could not be loaded.');
  }, [blockedQuery.isError, blockedQuery.error, toast]);

  async function unblock(blockedUser) {
    if (unblockingId) return;
    setUnblockingId(blockedUser.id);
    try {
      const { error: unblockError } = await supabase.rpc('unblock_user', { target: blockedUser.id });
      if (unblockError) throw unblockError;
      toast(`${blockedUser.name} has been unblocked.`, 'success');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['blocked-users', user.id] }),
        invalidateFriendshipQueries(queryClient, user.id),
      ]);
    } catch (unblockError) {
      toast(unblockError.message || 'This user could not be unblocked.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['blocked-users', user.id] }),
        invalidateFriendshipQueries(queryClient, user.id),
      ]);
    } finally {
      setUnblockingId('');
    }
  }

  async function downloadAccountData() {
    if (exportingData) return;
    setExportingData(true);
    setAccountActionError('');
    try {
      const { data, error: exportError } = await supabase.rpc('export_own_account_data');
      if (exportError) throw exportError;
      if (!data || typeof data !== 'object') throw new Error('The account data export was empty or invalid.');
      const file = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = `gather-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast('Your account data has been downloaded.', 'success');
    } catch (exportError) {
      const message = exportError.message || 'Your account data could not be downloaded.';
      setAccountActionError(message);
      toast(message);
    } finally {
      setExportingData(false);
    }
  }

  async function deleteAccount() {
    if (deletingAccount || accountDeletionConfirmation.trim().toLowerCase() !== user?.email?.toLowerCase()) return;
    setDeletingAccount(true);
    setAccountActionError('');
    try {
      const { data: objects, error: objectsError } = await supabase.rpc('list_own_storage_objects');
      if (objectsError) throw objectsError;
      if (!Array.isArray(objects)) throw new Error('The storage cleanup list could not be verified; account deletion was stopped.');
      const objectsByBucket = objects.reduce((groups, object) => {
        if (!object?.bucket_id || !object?.name) throw new Error('The storage cleanup list contained an invalid object; account deletion was stopped.');
        (groups[object.bucket_id] ??= []).push(object.name);
        return groups;
      }, {});
      for (const [bucket, paths] of Object.entries(objectsByBucket)) {
        for (let offset = 0; offset < paths.length; offset += 100) {
          const { error: storageError } = await supabase.storage.from(bucket).remove(paths.slice(offset, offset + 100));
          if (storageError) throw new Error(`Account deletion stopped because stored ${bucket} files could not be removed: ${storageError.message}`);
        }
      }
      const { error: deleteError } = await supabase.rpc('delete_own_account');
      if (deleteError) throw deleteError;

      queryClient.clear();
      const { error: signOutError } = await supabase.auth.signOut({ scope: 'local' });
      if (signOutError) {
        setAccountActionError(`Your account was deleted, but this device could not clear the local session: ${signOutError.message}`);
        return;
      }
      toast('Your Gather account has been deleted.', 'success');
      navigate('/', { replace: true });
    } catch (deleteError) {
      const message = deleteError.message || 'Your account could not be deleted.';
      setAccountActionError(message);
      toast(message);
    } finally {
      setDeletingAccount(false);
    }
  }

  useEffect(() => {
    if (!profileQuery.data) return;
    setProfile((current) => current ?? {
      ...profileQuery.data,
      bio: profileQuery.data.bio ?? '',
      location: profileQuery.data.location ?? '',
    });
  }, [profileQuery.data]);

  async function saveProfile(event) {
    event.preventDefault();
    if (saving) return;
    if (!profile.name.trim()) {
      const message = 'Your name can’t be empty.';
      setError(message);
      toast(message);
      return;
    }
    setSaving(true);
    setError('');
    try {
      let photoUrl;
      if (photoChanged) photoUrl = photo ? await uploadAvatar(user.id, photo) : null;
      const updatedProfile = await updateProfile.mutateAsync({
        name: profile.name.trim(),
        bio: profile.bio.trim() || null,
        location: profile.location.trim() || null,
        ...(photoChanged && { photo_url: photoUrl }),
      });
      setProfile({
        ...updatedProfile,
        bio: updatedProfile.bio ?? '',
        location: updatedProfile.location ?? '',
      });
      setPhotoChanged(false);
      setPhoto(null);
      toast('Your profile has been saved.', 'success');
    } catch (saveError) {
      const message = saveError.message || 'Your changes could not be saved.';
      setError(message);
      toast(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-page-content">
      <AppPageHeader
        eyebrow={editProfile ? 'YOUR PROFILE' : 'MAKE IT YOURS'}
        title={editProfile ? 'Edit profile' : 'Settings'}
        description={editProfile ? 'Update your photo and the details people see.' : 'A few preferences for your Gather space.'}
      />
      <div className="settings-grid">
        <Card className="settings-card">
          <h2>Your profile</h2>
          <p className="settings-card-intro">The basics people see when they find you.</p>
          {profileQuery.isLoading && !profile && <div className="list-skeleton"><span className="ui-skeleton people-skeleton" /><span className="ui-skeleton people-skeleton" /></div>}
          {profileQuery.isError && !profile && <div className="inline-alert settings-error" role="alert"><span>{profileQuery.error.message || 'Your profile could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => profileQuery.refetch()}>Try again</Button></div>}
          {profileQuery.isSuccess && !profile && <EmptyState icon={UserX} title="Profile unavailable" description="Your profile is not available right now." action={<Button size="sm" variant="secondary" onClick={() => profileQuery.refetch()}>Try again</Button>} />}
          {profile && (
              <form className="settings-form" onSubmit={saveProfile}>
                <div className="settings-avatar-row">
                  <Avatar src={profile.photo_url} name={profile.name} size="lg" />
                  <div className="settings-avatar-copy">
                    <strong>Profile photo</strong>
                    <small>A friendly face goes a long way.</small>
                  </div>
                </div>
                <PhotoCropper
                  key={profile.photo_url ?? 'no-photo'}
                  initialUrl={profile.photo_url}
                  onCropped={(blob, touched) => {
                    setPhoto(blob);
                    if (touched) setPhotoChanged(true);
                  }}
                  onToast={toast}
                />
                <Input label="Name" id="settings-name" autoComplete="name" maxLength={80} value={profile.name} onChange={(event) => setProfile({ ...profile, name: event.target.value })} error={profile.name.trim() ? '' : 'Your name can’t be empty.'} />
                <div className="settings-readonly"><span className="ui-input-label">Username</span><strong>@{profile.username}</strong><small>Usernames can’t be changed here.</small></div>
                <div className="ui-input-field">
                  <label className="ui-input-label" htmlFor="settings-bio">About you</label>
                  <textarea className="ui-input settings-textarea" id="settings-bio" maxLength={160} rows={3} value={profile.bio} onChange={(event) => setProfile({ ...profile, bio: event.target.value })} />
                  <span className="ui-input-message">{profile.bio.length}/160</span>
                </div>
                <Input label="Location" id="settings-location" autoComplete="address-level2" maxLength={100} value={profile.location} onChange={(event) => setProfile({ ...profile, location: event.target.value })} />
                {error && <div className="inline-alert" role="alert">{error}</div>}
                <Button type="submit" loading={saving}><Check size={16} /> Save profile</Button>
              </form>
          )}
        </Card>
        <Card className="settings-card">
          <h2>Hangout status</h2>
          <p className="settings-card-intro">Choose whether friends can see your active status.</p>
          {availability.isLoading && <div className="list-skeleton"><Skeleton className="people-skeleton" /></div>}
          {availability.isError && <div className="inline-alert" role="alert">{availability.error.message || 'Your status settings could not be loaded.'}</div>}
          {availability.isSuccess && (
            <label className="availability-privacy-toggle">
              <span><strong>Hide my status from everyone</strong><small>This takes effect immediately and keeps your status when you make it visible again.</small></span>
              <input type="checkbox" checked={Boolean(availability.data?.is_hidden)} disabled={visibilitySaving || !availability.data} onChange={toggleStatusVisibility} />
            </label>
          )}
          {!availability.isLoading && !availability.isError && !availability.data && <p className="settings-card-intro">Set a status from the top bar to manage its visibility.</p>}
        </Card>
        <Card className="settings-card">
          <h2>Notifications</h2>
          <p className="settings-card-intro">Choose whether Gather can show browser alerts while it is open.</p>
          <label className="availability-privacy-toggle">
            <span><strong>Browser notifications</strong><small>Includes new messages and planning reminders.</small></span>
            <input type="checkbox" checked={browserNotifications} onChange={toggleBrowserNotifications} />
          </label>
        </Card>
        {!editProfile && <Card className="settings-card settings-data-card">
          <h2>Your data</h2>
          <p className="settings-card-intro">Download a copy of your Gather data or permanently delete your account and associated app records.</p>
          <Button type="button" variant="secondary" loading={exportingData} onClick={downloadAccountData}><Download size={15} />Download my data</Button>
          <div className="settings-delete-account">
            <label className="settings-data-label" htmlFor="delete-account-email">To delete your account, enter your sign-in email: <strong>{user?.email}</strong></label>
            <Input
              id="delete-account-email"
              label="Confirm email"
              type="email"
              autoComplete="email"
              value={accountDeletionConfirmation}
              onChange={(event) => setAccountDeletionConfirmation(event.target.value)}
              disabled={deletingAccount}
            />
            <Button
              type="button"
              variant="danger"
              loading={deletingAccount}
              disabled={accountDeletionConfirmation.trim().toLowerCase() !== user?.email?.toLowerCase()}
              onClick={deleteAccount}
            ><Trash2 size={15} />Delete account permanently</Button>
          </div>
          {accountActionError && <div className="inline-alert" role="alert">{accountActionError}</div>}
        </Card>}
        <div className="settings-side">
          <Card className="settings-card">
            <h2>Appearance</h2>
            <p className="settings-card-intro">Make yourself comfortable.</p>
            <button className="appearance-toggle" type="button" onClick={onToggleTheme}>
              <span className="appearance-icon">{dark ? <Moon size={18} /> : <Sun size={18} />}</span>
              <span><strong>{dark ? 'Dark mode' : 'Light mode'}</strong><small>Your choice is saved on this device.</small></span>
              <span className={`theme-switch${dark ? ' theme-switch-on' : ''}`} />
            </button>
          </Card>
          <Card className="settings-card settings-account-card">
            <h2>Your account</h2>
            <p className="settings-card-intro">Signed in with</p>
            <p className="settings-email">{user.email}</p>
            <Link className="settings-back-link" to="/home"><ArrowLeft size={14} /> Back to your space</Link>
            <Link className="settings-privacy-link" to="/privacy">Privacy Policy</Link>
          </Card>
          <Card className="settings-card blocked-users-card">
            <h2>Blocked users</h2>
            <p className="settings-card-intro">People you’ve blocked can’t find or interact with you.</p>
            {blockedQuery.isLoading && <div className="list-skeleton"><Skeleton className="people-skeleton" /></div>}
            {blockedQuery.isError && <div className="inline-alert settings-error" role="alert"><span>{blockedQuery.error.message || 'Blocked users could not be loaded.'}</span><Button size="sm" variant="secondary" onClick={() => blockedQuery.refetch()}>Try again</Button></div>}
            {blockedQuery.isSuccess && blockedQuery.data.length === 0 && <EmptyState icon={UserX} title="No blocked users" description="People you block will appear here." />}
            {blockedQuery.data?.map((blockedUser) => (
              <div className="blocked-user-row" key={blockedUser.id}>
                <Avatar src={blockedUser.photo_url} name={blockedUser.name} size="sm" />
                <span><strong>{blockedUser.name}</strong><small>@{blockedUser.username}</small></span>
                <Button size="sm" variant="secondary" onClick={() => unblock(blockedUser)} loading={unblockingId === blockedUser.id}>Unblock</Button>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
