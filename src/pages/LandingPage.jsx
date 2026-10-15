import { useEffect, useState } from 'react';
import {
  CheckCheck,
  LockKeyhole,
  MessageCircle,
  MessagesSquare,
  ShieldCheck,
  UsersRound,
  Zap,
} from 'lucide-react';
import { Link, Navigate } from 'react-router-dom';
import { Avatar } from '../components/ui/Avatar';
import { Brand } from '../components/Brand';
import { Card } from '../components/ui/Card';
import { LoadingScreen } from '../components/LoadingScreen';
import { useAuth } from '../providers/AuthProvider';
import { WelcomeScreen } from './WelcomeScreen';

const features = [
  { icon: UsersRound, title: 'Friends-only messaging', description: 'Conversations stay between you and the people you choose.' },
  { icon: MessagesSquare, title: 'Group chats', description: 'Bring your favorite people together in one shared space.' },
  { icon: CheckCheck, title: 'Read receipts and typing', description: 'See when a message arrives, is read, or gets a reply.' },
  { icon: ShieldCheck, title: 'Block and report for safety', description: 'Simple controls help you decide who can reach you.' },
  { icon: Zap, title: 'Real-time delivery', description: 'New messages and notifications arrive as they happen.' },
  { icon: LockKeyhole, title: 'Private by design', description: 'Your space is for your people, not a public feed.' },
];

const steps = [
  { number: '01', title: 'Create your account', description: 'Set up your space in just a few steps.' },
  { number: '02', title: 'Find and add friends', description: 'Build your circle with the people you know.' },
  { number: '03', title: 'Start chatting', description: 'Pick up a conversation or make a group together.' },
];

let hasShownSplash = false;

function LandingSplash() {
  return (
    <div className="landing-splash" role="status" aria-label="Welcome to Gather">
      <Brand />
    </div>
  );
}

function ChatPreview() {
  return (
    <div className="landing-phone" aria-label="Preview of a Gather conversation">
      <span className="landing-phone-speaker" aria-hidden="true" />
      <header className="landing-chat-header">
        <Avatar name="Maya" size="sm" online />
        <span className="landing-chat-person">
          <strong>Maya</strong>
          <small><i /> Online</small>
        </span>
        <button className="landing-chat-menu" type="button" aria-label="More conversation options">
          <span /><span /><span />
        </button>
      </header>
      <div className="landing-chat-day"><span>Today</span></div>
      <div className="landing-chat-messages">
        <div className="landing-chat-message landing-chat-message-incoming">
          Hey! How was your weekend?
          <time>10:41</time>
        </div>
        <div className="landing-chat-message landing-chat-message-outgoing">
          So good. We finally made it out to the coast.
          <time>10:42 <CheckCheck size={13} aria-label="Read" /></time>
        </div>
        <div className="landing-chat-message landing-chat-message-incoming">
          That sounds lovely. Send me a photo sometime!
          <time>10:43</time>
        </div>
      </div>
      <div className="landing-chat-compose">
        <span><MessageCircle size={14} /> Write a message…</span>
        <span className="landing-chat-send" aria-hidden="true"><MessageCircle size={14} /></span>
      </div>
      <div className="landing-phone-home" aria-hidden="true" />
    </div>
  );
}

export function LandingPage() {
  const { user, loading } = useAuth();
  const [showSplash, setShowSplash] = useState(() => !hasShownSplash);

  useEffect(() => {
    if (!showSplash) return undefined;
    hasShownSplash = true;
    const timer = window.setTimeout(() => setShowSplash(false), 1000);
    return () => window.clearTimeout(timer);
  }, [showSplash]);

  if (loading) return <LoadingScreen message="Getting your space ready…" />;
  if (user) return <Navigate to="/home" replace />;

  return (
    <main className="landing-page" id="about">
      {showSplash && <LandingSplash />}
      <div className="landing-desktop">
        <header className="landing-topbar">
          <div className="landing-topbar-inner">
            <Brand />
            <nav className="landing-nav" aria-label="About Gather">
              <a href="#features">Features</a>
              <a href="#how-it-works">How it works</a>
            </nav>
            <div className="landing-nav-actions">
              <Link className="landing-login-link" to="/login">Log in</Link>
              <Link className="ui-button ui-button-primary" to="/signup">Get Started</Link>
            </div>
          </div>
        </header>

        <section className="landing-hero" id="top">
          <div className="landing-hero-inner">
            <div className="landing-hero-copy">
              <span className="landing-eyebrow"><i /> A quieter place to stay close</span>
              <h1>Connect with the people who <em>matter.</em></h1>
              <p>Good conversations, close friends, and a little more room to be yourself.</p>
              <div className="landing-hero-actions">
                <Link className="ui-button ui-button-primary" to="/signup">Get Started <MessageCircle size={16} /></Link>
                <Link className="ui-button ui-button-secondary" to="/login">Log in</Link>
              </div>
              <div className="landing-hero-note"><UsersRound size={16} /><span>Made for your people, at your pace.</span></div>
            </div>
            <div className="landing-hero-visual">
              <div className="landing-visual-orbit landing-visual-orbit-one" />
              <div className="landing-visual-orbit landing-visual-orbit-two" />
              <div className="landing-visual-spark landing-visual-spark-one" />
              <div className="landing-visual-spark landing-visual-spark-two" />
              <ChatPreview />
              <Card className="landing-float-card">
                <span className="landing-float-icon"><CheckCheck size={17} /></span>
                <span><strong>All caught up</strong><small>Your conversations, together.</small></span>
              </Card>
            </div>
          </div>
        </section>

        <section className="landing-features landing-section" id="features">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">A space that feels like yours</span>
            <h2>Closer connections.<br /><em>Less noise.</em></h2>
            <p>Everything you need to stay in touch, with the people who matter most.</p>
          </div>
          <div className="landing-feature-grid">
            {features.map(({ icon: Icon, title, description }) => (
              <Card className="landing-feature-card" key={title}>
                <span className="landing-feature-icon"><Icon size={20} strokeWidth={1.8} /></span>
                <h3>{title}</h3>
                <p>{description}</p>
              </Card>
            ))}
          </div>
        </section>

        <section className="landing-how landing-section" id="how-it-works">
          <div className="landing-section-heading">
            <span className="landing-eyebrow">Easy as hello</span>
            <h2>Your circle is just<br /><em>three steps away.</em></h2>
          </div>
          <div className="landing-steps">
            {steps.map((step) => (
              <article className="landing-step" key={step.number}>
                <span className="landing-step-number">{step.number}</span>
                <div><h3>{step.title}</h3><p>{step.description}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-cta">
          <div className="landing-cta-decoration" aria-hidden="true" />
          <span className="landing-eyebrow">Your people are right here</span>
          <h2>Make room for more<br />good conversations.</h2>
          <p>Create your space and bring your circle a little closer.</p>
          <Link className="ui-button ui-button-primary" to="/signup">Get Started <MessageCircle size={16} /></Link>
        </section>

        <footer className="landing-footer">
          <div className="landing-footer-main">
            <Brand />
            <p>A quieter place to stay close to your people.</p>
            <nav aria-label="Footer">
              <a href="#about">About</a>
              <Link to="/privacy">Privacy Policy</Link>
              <Link to="/terms">Terms of Service</Link>
              <a href="mailto:" aria-label="Contact by email">Contact</a>
            </nav>
          </div>
          <div className="landing-footer-bottom">
            <span>© {new Date().getFullYear()} Gather</span>
            <span>Made for your people.</span>
          </div>
        </footer>
      </div>
      <WelcomeScreen />
    </main>
  );
}
