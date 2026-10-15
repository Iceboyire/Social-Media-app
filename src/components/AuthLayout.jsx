import { ArrowUpRight, MessageCircle, ShieldCheck, UsersRound } from 'lucide-react';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

const notes = [
  { Icon: UsersRound, title: 'Your people, all in one place', copy: 'Find your friends and grow your circle.' },
  { Icon: MessageCircle, title: 'Conversations that feel close', copy: 'Pick up where life left off.' },
  { Icon: ShieldCheck, title: 'A space that feels like yours', copy: 'Share only what you want, when you want.' },
];

export function AuthLayout({ children, dark, onToggleTheme }) {
  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="About Gather">
        <div className="story-shape story-shape-one" />
        <div className="story-shape story-shape-two" />
        <div className="story-shape story-shape-three" />
        <div className="story-top">
          <Brand light />
          <span className="story-edition">A PLACE TO STAY CLOSE</span>
        </div>
        <div className="story-content">
          <div className="story-eyebrow"><span /> YOUR PEOPLE, YOUR SPACE</div>
          <h1>Connect with the people who <em>matter.</em></h1>
          <p className="story-lede">A calmer corner of the internet for conversations, friendships, and the moments worth sharing.</p>
          <div className="story-notes">
            {notes.map(({ Icon, title, copy }, index) => (
              <div className="story-feature" key={title}>
                <span className="story-feature-icon"><Icon size={20} strokeWidth={1.8} /></span>
                <span className="story-feature-copy"><strong>{title}</strong><small>{copy}</small></span>
                <ArrowUpRight className="story-feature-arrow" size={17} />
                {index < notes.length - 1 && <span className="story-feature-line" />}
              </div>
            ))}
          </div>
        </div>
        <div className="story-footer">
          <span>A LITTLE MORE HUMAN. A LITTLE LESS NOISE.</span>
          <span className="story-footer-dots"><i /><i /><i /></span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-top">
          <Brand className="auth-mobile-brand" />
          <div className="auth-panel-actions">
            <span className="private-note"><span /> MADE FOR YOUR PEOPLE</span>
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          </div>
        </div>
        <div className="auth-content">
          <div className="auth-form-card">{children}</div>
        </div>
        <footer className="auth-footer">
          <span>A good place to stay close.</span>
          <span>© {new Date().getFullYear()}</span>
        </footer>
      </section>
    </main>
  );
}
