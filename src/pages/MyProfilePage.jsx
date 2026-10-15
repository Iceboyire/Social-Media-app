import { AtSign, MapPin, PencilLine, UserRound } from 'lucide-react';
import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Button } from '../components/ui/Button';
import { Card } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Skeleton } from '../components/ui/Skeleton';
import { useProfile } from '../hooks/useProfile';
import { useToast } from '../providers/ToastProvider';

export function MyProfilePage() {
  const { data: profile, isLoading, isError, isSuccess, error, refetch } = useProfile();
  const toast = useToast();
  useEffect(() => {
    if (isError) toast(error?.message || 'Your profile could not be loaded.');
  }, [isError, error, toast]);
  return (
    <div className="app-page-content">
      <AppPageHeader eyebrow="YOUR CORNER" title="My profile" description="A little snapshot of you." action={<Link to="/profile/edit" className="ui-button ui-button-secondary ui-button-sm"><PencilLine size={15} /> Edit profile</Link>} />
      <Card className="my-profile-card">
        {isLoading && <div className="profile-loading"><Skeleton circle className="profile-large-skeleton" /><Skeleton className="profile-line-skeleton" /><Skeleton className="profile-line-skeleton short" /></div>}
        {isError && !profile && <EmptyState icon={UserRound} title="Profile didn’t load" description={error?.message || 'Your profile could not be loaded. Check your connection and try again.'} action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>} />}
        {isSuccess && !profile && <EmptyState icon={UserRound} title="Profile unavailable" description="Your profile is not available right now." action={<Button size="sm" variant="secondary" onClick={() => refetch()}>Try again</Button>} />}
        {profile && (
          <>
            <Avatar src={profile.photo_url} name={profile.name} size="xl" online={Boolean(profile.last_seen && Date.now() - new Date(profile.last_seen).getTime() < 5 * 60_000)} />
            <h2>{profile.name}</h2>
            <p className="my-profile-username"><AtSign size={15} />{profile.username}</p>
            {profile.bio && <p className="my-profile-bio">{profile.bio}</p>}
            {profile.location && <p className="my-profile-location"><MapPin size={15} />{profile.location}</p>}
            <div className="profile-divider" />
            <p className="my-profile-joined">A member since {new Date(profile.created_at).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</p>
            <Link className="ui-button ui-button-primary profile-edit-mobile" to="/profile/edit"><PencilLine size={15} /> Edit profile</Link>
          </>
        )}
      </Card>
    </div>
  );
}
