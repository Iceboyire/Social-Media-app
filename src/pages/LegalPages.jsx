import { ArrowLeft, MessageCircle, ScrollText } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { Brand } from '../components/Brand';

const legalCopy = {
  '/terms': {
    icon: ScrollText,
    title: 'Terms of Service',
    intro: 'A few basics for making Gather a good place to be.',
    paragraphs: [
      'Use Gather respectfully and only share content you have the right to share. Do not use the service to threaten, harass, impersonate, or harm other people.',
      'You are responsible for keeping your account credentials safe and for activity that happens through your account.',
      'Before launch, add the final service terms, eligibility rules, moderation process, liability terms, and governing-law information after legal review.',
    ],
  },
};

export function LegalPage() {
  const { pathname } = useLocation();
  const page = legalCopy[pathname] ?? legalCopy['/terms'];
  const Icon = page.icon;

  return (
    <main className="public-info-page">
      <header className="public-info-header"><Brand /><Link to="/">Back to Gather</Link></header>
      <article className="public-info-card">
        <span className="public-info-icon"><Icon size={22} /></span>
        <span className="landing-eyebrow">GATHER · YOUR SPACE</span>
        <h1>{page.title}</h1>
        <p className="public-info-intro">{page.intro}</p>
        <div className="public-info-review" role="note">
          <strong>Starter copy — review before launch</strong>
          <span>This page is a starting point, not legal advice. Replace it with approved text before making the service public.</span>
        </div>
        {page.paragraphs.map((paragraph) => <p className="public-info-paragraph" key={paragraph}>{paragraph}</p>)}
        <Link className="public-info-back" to="/"><ArrowLeft size={15} /> Back to Gather</Link>
      </article>
    </main>
  );
}

export function NotFoundPage() {
  return (
    <main className="public-info-page public-not-found">
      <Brand />
      <section className="public-info-card">
        <span className="public-info-icon"><MessageCircle size={22} /></span>
        <span className="landing-eyebrow">A LITTLE DETOUR</span>
        <h1>We can’t find that page.</h1>
        <p className="public-info-intro">It may have moved, or the link may be a little out of date.</p>
        <Link className="ui-button ui-button-primary" to="/">Back home</Link>
      </section>
    </main>
  );
}
