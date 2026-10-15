import { AtSign, ArrowRight, MapPin, MessageCircle, PencilLine, Sprout, UsersRound } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AppPageHeader } from '../components/AppPageHeader';
import { Avatar } from '../components/ui/Avatar';
import { Card } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { EmptyState } from '../components/ui/EmptyState';
import { LoadingScreen } from '../components/LoadingScreen';
import { useProfile } from '../hooks/useProfile';
import { useAvailability } from '../hooks/useAvailability';
import { supabase } from '../lib/supabase';
import { useAuth } from '../providers/AuthProvider';
import { useToast } from '../providers/ToastProvider';

export function HomePage() {
  const { data: profile, isLoading, isError, error, refetch } = useProfile();
  const { friends } = useAvailability();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const toast = useToast();

  async function openGatherChat(friend) {
    try {
      const { data: conversationId, error: conversationError } = await supabase.rpc('get_or_create_direct_conversation', { friend: friend.user_id });
      if (conversationError) throw conversationError;
      if (!conversationId) throw new Error('The conversation could not be opened.');
      await queryClient.invalidateQueries({ queryKey: ['conversations', user.id] });
      navigate(`/messages/${conversationId}`, { state: { draftMessage: "Hey, I saw you're free. Want to gather?", offerPlan: true } });
    } catch (actionError) {
      toast(actionError.message || 'That chat could not be opened.');
    }
  }

  if (isLoading) return <LoadingScreen message="Getting your space ready…" />;
  if (isError || !profile) {
    return (
      <div className="app-page-content app-dashboard">
        <EmptyState
          icon={Sprout}
          title="Your space couldn’t load"
          description={error?.message || 'Your profile is not available right now. Please try again.'}
          action={<Button variant="secondary" onClick={() => refetch()}>Try again</Button>}
        />
      </div>
    );
  }

  return (
    <div className="app-page-content app-dashboard">
      <AppPageHeader eyebrow="YOUR SPACE" title={`Hello, ${profile.name.split(' ')[0]}.`} description="A quieter space for the people who make life feel like life." />
      <section className="home-welcome">
        <div className="welcome-decoration welcome-decoration-one" />
        <div className="welcome-decoration welcome-decoration-two" />
        <div className="welcome-copy">
          <span className="form-kicker">GOOD TO HAVE YOU HERE</span>
          <h1>Your people,<br />your <em>place.</em></h1>
          <p>Take a moment to find your friends and pick up a conversation. Your space is yours to make.</p>
          <div className="welcome-actions">
            <Link className="ui-button ui-button-primary" to="/friends"><UsersRound size={16} /> Find your friends <ArrowRight size={15} /></Link>
            <Link className="welcome-secondary-link" to="/messages"><MessageCircle size={16} /> Go to messages</Link>
          </div>
        </div>
        <Card className="welcome-profile">
          <Avatar src={profile.photo_url} name={profile.name} size="xl" online={Boolean(profile.last_seen && Date.now() - new Date(profile.last_seen).getTime() < 5 * 60_000)} />
          <span className="welcome-profile-label">YOUR PROFILE</span>
          <h2>{profile.name}</h2>
          <p className="profile-username"><AtSign size={14} />{profile.username}</p>
          {profile.bio && <p className="profile-bio">{profile.bio}</p>}
          {profile.location && <p className="profile-location"><MapPin size={14} />{profile.location}</p>}
          <div className="profile-divider" />
          <p className="profile-private"><span /> Your profile belongs to you.</p>
          <Link className="welcome-profile-edit" to="/profile"><PencilLine size={14} /> View my profile</Link>
        </Card>
      </section>
      <section className="home-availability" aria-labelledby="home-availability-title">
        <div className="home-availability-heading">
          <div><span className="form-kicker">MAKE A PLAN</span><h2 id="home-availability-title">Who’s free?</h2></div>
          <Link className="welcome-secondary-link" to="/friends">All friends <ArrowRight size={14} /></Link>
        </div>
        {friends.isLoading && <div className="availability-friends-loading" aria-label="Loading friend statuses"><span /><span /><span /></div>}
        {friends.isError && <EmptyState icon={UsersRound} title="Statuses didn’t load" description={friends.error.message || 'Friend availability could not be loaded.'} />}
        {friends.isSuccess && !friends.data.some((friend) => ['free_now', 'free_tonight'].includes(friend.state)) && (
          <EmptyState icon={UsersRound} title="No friends are free right now" description="When friends share that they’re free, you’ll see them here." />
        )}
        {friends.data?.filter((friend) => ['free_now', 'free_tonight'].includes(friend.state)).map((friend) => (
          <Card className="home-free-friend" key={friend.user_id}>
            <Avatar src={friend.photo_url} name={friend.name} size="md" />
            <div className="home-free-friend-copy"><strong>{friend.name}</strong><span>{friend.state === 'free_now' ? 'Free now' : 'Free tonight'}{friend.note ? ` · ${friend.note}` : ''}</span></div>
            <Button size="sm" onClick={() => openGatherChat(friend)}><MessageCircle size={14} /> Let’s gather</Button>
          </Card>
        ))}
      </section>
      <section className="home-next">
        <div>
          <span className="form-kicker">YOUR PEOPLE ARE NEXT</span>
          <h2>Good things take a little time.</h2>
          <p>Start with a friend, or browse your conversations. You can always come back to your space.</p>
        </div>
        <Link className="home-next-mark" to="/friends" aria-label="Go to friends"><Sprout size={20} /></Link>
      </section>
    </div>
  );
}
