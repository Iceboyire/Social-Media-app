import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';

export function WelcomeScreen() {
  return (
    <section className="welcome-screen" aria-label="Welcome to Gather">
      <div className="welcome-screen-content">
        <Brand />
        <span className="welcome-screen-mark" aria-hidden="true" />
        <h1>Your people.<br /><em>Your space.</em></h1>
        <p>A quieter place to stay close to the people who matter.</p>
        <div className="welcome-screen-actions">
          <Link className="ui-button ui-button-primary" to="/signup">Create account</Link>
          <Link className="ui-button ui-button-secondary" to="/login">Log in</Link>
        </div>
      </div>
      <footer className="welcome-screen-footer">A little more human. A little less noise.</footer>
    </section>
  );
}
