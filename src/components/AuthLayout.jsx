import { ArrowUpRight, Heart, Leaf, Sparkles } from 'lucide-react';
import { Brand } from './Brand';
import { ThemeToggle } from './ThemeToggle';

const notes = [
  { Icon: Heart, title: 'The people who get you', copy: 'A little less noise. A lot more meaning.' },
  { Icon: Leaf, title: 'Room for real life', copy: 'Stay close, even when life gets busy.' },
  { Icon: Sparkles, title: 'Your own kind of corner', copy: 'Make space for the conversations that matter.' },
];

export function AuthLayout({ children, dark, onToggleTheme }) {
  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="About Gather">
        <div className="story-orb story-orb-one" />
        <div className="story-orb story-orb-two" />
        <div className="story-top">
          <Brand light />
          <span className="story-edition">A SOCIAL SPACE, REIMAGINED</span>
        </div>
        <div className="story-content">
          <div className="story-eyebrow"><span /> MAKE YOURSELF AT HOME</div>
          <h1>Good things happen<br />when we <em>gather.</em></h1>
          <p className="story-lede">A little corner of the internet for the people who make life feel like life.</p>
          <div className="story-notes">
            {notes.map(({ Icon, title, copy }) => (
              <div className="story-note" key={title}>
                <span className="story-note-icon"><Icon size={17} /></span>
                <span><strong>{title}</strong><small>{copy}</small></span>
                <ArrowUpRight className="story-note-arrow" size={16} />
              </div>
            ))}
          </div>
        </div>
        <div className="story-footer">
          <span>HERE FOR THE GOOD CONVERSATIONS</span>
          <span className="story-footer-dots"><i /><i /><i /></span>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-panel-top">
          <Brand />
          <div className="auth-panel-actions">
            <span className="private-note"><span /> YOUR SPACE, ALWAYS</span>
            <ThemeToggle dark={dark} onToggle={onToggleTheme} />
          </div>
        </div>
        <div className="auth-content">{children}</div>
        <footer className="auth-footer">
          <span>Made for the moments that matter.</span>
          <span>© {new Date().getFullYear()} Gather</span>
        </footer>
      </section>
    </main>
  );
}
