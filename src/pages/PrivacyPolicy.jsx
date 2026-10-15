import { ArrowLeft, ArrowUp } from 'lucide-react';
import { Link } from 'react-router-dom';
import { Brand } from '../components/Brand';

const sections = [
  ['introduction', 'Introduction'],
  ['information-we-collect', 'Information We Collect'],
  ['how-we-use-your-information', 'How We Use Your Information'],
  ['legal-basis', 'Our Legal Basis for Using Your Information'],
  ['who-can-see-your-information', 'Who Can See Your Information'],
  ['who-we-share-information-with', 'Who We Share Information With'],
  ['international-data-transfers', 'International Data Transfers'],
  ['how-long-we-keep-your-information', 'How Long We Keep Your Information'],
  ['your-rights-and-choices', 'Your Rights and Choices'],
  ['blocking-reporting-and-safety', 'Blocking, Reporting and Safety'],
  ['security', 'Security'],
  ['cookies-and-local-storage', 'Cookies and Local Storage'],
  ['childrens-privacy', "Children's Privacy"],
  ['links-and-third-party-content', 'Links and Third-Party Content'],
  ['changes-to-this-policy', 'Changes to This Policy'],
  ['contact-us', 'Contact Us'],
];

function PolicySection({ id, title, children }) {
  return (
    <section className="privacy-policy-section" id={id}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function PrivacyPolicy() {
  function backToTop() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <main className="privacy-policy-page" id="top">
      <div className="privacy-policy-shell">
        <header className="privacy-policy-header">
          <Brand />
          <Link className="privacy-policy-back" to="/"><ArrowLeft size={16} /> Back</Link>
        </header>

        <article className="privacy-policy-card">
          <header className="privacy-policy-title">
            <span className="landing-eyebrow">GATHER · YOUR SPACE</span>
            <h1>Privacy Policy</h1>
            <p>Last updated: October 15, 2026</p>
          </header>

          <nav className="privacy-policy-toc" aria-label="Table of contents">
            <h2>Table of contents</h2>
            <ol>
              {sections.map(([id, title], index) => (
                <li key={id}><a href={`#${id}`}>{index + 1}. {title}</a></li>
              ))}
            </ol>
          </nav>

          <div className="privacy-policy-content">
            <PolicySection id="introduction" title="1. Introduction">
              <p>Welcome to Gather. Gather is a social messaging app operated by NEMA (&quot;NEMA&quot;, &quot;we&quot;, &quot;us&quot; or &quot;our&quot;). Gather lets you create an account, find people, send and receive friend requests, and exchange messages with your friends in one-to-one chats and group chats.</p>
              <p>This Privacy Policy explains what personal information we collect, how we use it, who we share it with, how long we keep it, and what choices and rights you have. By creating an account or using Gather, you confirm that you have read this policy. If you do not agree with it, please do not use Gather.</p>
              <p>If you have any questions, you can contact us at <a href="mailto:ireoluwadavid16@gmail.com">ireoluwadavid16@gmail.com</a>.</p>
            </PolicySection>

            <PolicySection id="information-we-collect" title="2. Information We Collect">
              <p><strong>2.1 Information you give us</strong></p>
              <ul>
                <li><strong>Account information:</strong> your name, username, email address and password. Your password is handled by our authentication provider and is stored in a protected, hashed form. We cannot see it.</li>
                <li><strong>Profile information:</strong> your profile photo, your bio and, if you choose to add it, your location. Your bio and location are optional.</li>
                <li><strong>Content you create:</strong> messages, emojis and images you send in direct chats and group chats, group names and group photos.</li>
                <li><strong>Reports and feedback:</strong> when you report a user or a message, we collect the details of the report, the reason you choose and any note you add.</li>
                <li><strong>Communications with us:</strong> if you email us, we keep your message and our reply.</li>
              </ul>
              <p><strong>2.2 Information created when you use Gather</strong></p>
              <ul>
                <li><strong>Social connections:</strong> friend requests you send or receive (and their status: pending, accepted or declined), your friends list, people you block, and your group memberships and roles.</li>
                <li><strong>Messaging activity:</strong> time of messages, read receipts (whether a message has been seen), and conversation membership. Typing indicators and online status are shown in real time and are not kept as permanent records.</li>
                <li><strong>Notifications:</strong> records of notifications we send you inside the app, such as friend requests, accepted requests, new messages and group invitations.</li>
                <li><strong>Activity information:</strong> the time you were last active, and when you signed up.</li>
                <li><strong>Moderation records:</strong> whether your account has been suspended or banned, and related notes made by our administrators.</li>
              </ul>
              <p><strong>2.3 Information collected automatically</strong></p>
              <ul>
                <li><strong>Technical data:</strong> IP address, browser type and version, device type, operating system, language and approximate region derived from your IP address.</li>
                <li><strong>Local storage:</strong> small pieces of data stored in your browser to keep you signed in and remember settings such as dark mode (see Section 12).</li>
              </ul>
              <p>We do not collect your precise GPS location. The location on your profile is text that you type yourself.</p>
            </PolicySection>

            <PolicySection id="how-we-use-your-information" title="3. How We Use Your Information">
              <p>We use your information to:</p>
              <ul>
                <li>Create and manage your account and verify your email address.</li>
                <li>Let you build a profile and let other users find you through search by name or username.</li>
                <li>Provide friend requests, friends lists, direct messaging and group chats, and enforce the rule that only friends can message each other.</li>
                <li>Deliver messages and notifications in real time.</li>
                <li>Show read receipts, typing indicators and online status.</li>
                <li>Enforce blocking so that people you block cannot find you, contact you or interact with you.</li>
                <li>Review reports, investigate abuse and take action such as warnings, suspensions or bans.</li>
                <li>Protect Gather and its users against spam, fraud, harassment, impersonation, illegal activity and security threats.</li>
                <li>Understand how Gather is used (for example, the number of signups, active users, messages sent and groups created) so that we can fix problems and improve the service.</li>
                <li>Send you service emails, such as email confirmation, password reset and important notices about your account or this policy.</li>
                <li>Comply with legal obligations and respond to lawful requests.</li>
              </ul>
              <p>We do not use your messages to show advertising, and we do not sell your personal information.</p>
            </PolicySection>

            <PolicySection id="legal-basis" title="4. Our Legal Basis for Using Your Information">
              <p>Where data protection laws require us to have a legal basis, we rely on the following:</p>
              <ul>
                <li><strong>Contract:</strong> we need to use your information to provide Gather to you, such as creating your account, delivering your messages and running friend and group features.</li>
                <li><strong>Legitimate interests:</strong> we have a legitimate interest in keeping Gather safe and secure, preventing abuse, moderating content, and improving the service, and we balance this against your rights and interests.</li>
                <li><strong>Consent:</strong> where you choose to give optional information such as your location, or agree to optional notifications, you consent to our use of it. You can withdraw consent at any time by removing the information or changing your settings.</li>
                <li><strong>Legal obligation:</strong> where we must keep or disclose information to follow the law.</li>
              </ul>
            </PolicySection>

            <PolicySection id="who-can-see-your-information" title="5. Who Can See Your Information">
              <p><strong>5.1 Other users</strong></p>
              <ul>
                <li>Your name, username, profile photo, bio and location (if provided) can be seen by other users who find your profile. People you have blocked, and people who have blocked you, cannot find or view your profile.</li>
                <li>Your online status, last active time and typing activity can be seen by your friends and by the people in your conversations.</li>
                <li>Messages and images in a direct chat are visible to you and the friend you are chatting with. Messages and images in a group chat are visible to the current members of that group, and to members who were part of the group when the messages were sent.</li>
                <li>If you unfriend someone, the direct chat becomes read only. The history of that chat remains visible to both of you but neither of you can send new messages.</li>
                <li>A person you have exchanged messages with can copy, screenshot or share what you sent. Please only share what you are comfortable sharing.</li>
              </ul>
              <p><strong>5.2 Our team</strong> Our administrators can see account details, activity totals and the content of reports so that they can moderate Gather. We may view the reported message and the surrounding context when we review a report. Our team does not read private conversations that have not been reported, except where it is strictly necessary to investigate serious abuse, keep users safe, fix a technical fault or comply with the law.</p>
              <p><strong>5.3 Messages are not end-to-end encrypted</strong> Gather protects data in transit and uses access rules so that only authorised people can read a conversation. However, messages are not end-to-end encrypted. This means they are stored on our servers in a form that our service providers and authorised team members could technically access if required for security, moderation or legal reasons.</p>
            </PolicySection>

            <PolicySection id="who-we-share-information-with" title="6. Who We Share Information With">
              <p>We do not sell your personal information. We share it only in the following situations:</p>
              <p><strong>6.1 Service providers</strong> We use trusted companies to help us run Gather. They may process your information only to provide services to us and under obligations to protect it:</p>
              <ul>
                <li><strong>Supabase:</strong> provides our database, user authentication, file storage and real-time messaging.</li>
                <li><strong>Our web hosting provider:</strong> serves the Gather website and app to your device.</li>
                <li><strong>Our email delivery provider:</strong> sends service emails such as confirmation and password reset emails.</li>
              </ul>
              <p><strong>6.2 Legal and safety reasons</strong> We may disclose information if we believe it is necessary to comply with a law, regulation, court order or valid request from a public authority, to enforce our Terms of Service, to investigate fraud or abuse, or to protect the rights, safety and property of our users, the public, Gather or NEMA.</p>
              <p><strong>6.3 Business changes</strong> If NEMA is involved in a merger, acquisition, restructuring or sale of assets, your information may be transferred as part of that transaction. We will tell you before your information becomes subject to a different privacy policy.</p>
              <p><strong>6.4 With your direction</strong> We share information when you ask us to or give your permission, for example, when you choose to send an image to a friend.</p>
            </PolicySection>

            <PolicySection id="international-data-transfers" title="7. International Data Transfers">
              <p>Our service providers may store and process information in countries other than the one where you live. These countries may have different data protection laws. Where required, we take steps to make sure your information is protected, such as choosing providers that apply recognised safeguards and contractual protections.</p>
            </PolicySection>

            <PolicySection id="how-long-we-keep-your-information" title="8. How Long We Keep Your Information">
              <ul>
                <li><strong>Account and profile information:</strong> kept while your account is active.</li>
                <li><strong>Messages and images:</strong> kept while your account is active so that your conversations remain available. When you leave a group, the group's earlier messages remain available to its other members.</li>
                <li><strong>Deleted accounts:</strong> when you delete your account, we delete or anonymise your profile and personal information within 30 days. Messages you sent in conversations may be removed or shown as sent by a deleted user.</li>
                <li><strong>Backups:</strong> deleted information may remain in secure backups for up to 90 days before it is permanently overwritten.</li>
                <li><strong>Reports and moderation records:</strong> kept for as long as needed to protect users, prevent repeat abuse and meet legal obligations, usually up to 24 months after the report is resolved.</li>
                <li><strong>Banned accounts:</strong> we may keep your email address and related records after a ban to stop you from creating new accounts to avoid the ban.</li>
                <li><strong>Technical logs:</strong> kept for a limited period for security and troubleshooting.</li>
              </ul>
              <p>We may keep information longer where the law requires or where it is needed to handle a legal claim or dispute.</p>
            </PolicySection>

            <PolicySection id="your-rights-and-choices" title="9. Your Rights and Choices">
              <p>Depending on where you live, you may have the following rights:</p>
              <ul>
                <li><strong>Access:</strong> ask for a copy of the personal information we hold about you.</li>
                <li><strong>Correction:</strong> ask us to fix information that is inaccurate or incomplete. You can edit most profile details yourself in Settings.</li>
                <li><strong>Deletion:</strong> ask us to delete your account and personal information.</li>
                <li><strong>Restriction and objection:</strong> ask us to limit or stop certain uses of your information, including uses based on our legitimate interests.</li>
                <li><strong>Portability:</strong> ask for your information in a commonly used, machine-readable format.</li>
                <li><strong>Withdrawing consent:</strong> where we rely on your consent, you can withdraw it at any time without affecting earlier use.</li>
                <li><strong>Complaint:</strong> lodge a complaint with your local data protection authority if you believe your rights have been violated.</li>
              </ul>
              <p>You can also manage your experience directly in Gather: edit your profile, remove your location, block or unfriend people, leave groups and control notifications.</p>
              <p>To exercise any right, email ireoluwadavid16@gmail.com from the email address linked to your account. We may need to confirm your identity before acting on a request. We will respond within 30 days, or sooner where the law requires.</p>
            </PolicySection>

            <PolicySection id="blocking-reporting-and-safety" title="10. Blocking, Reporting and Safety">
              <ul>
                <li><strong>Blocking:</strong> when you block someone, your friendship with them ends, you both disappear from each other's search results, and they can no longer send you requests or messages.</li>
                <li><strong>Reporting:</strong> you can report a user or a message. Reports are reviewed by our administrators. We may take action including warning, suspending or banning accounts. We may keep records of reports and the actions taken for safety and legal reasons.</li>
                <li><strong>Suspension and bans:</strong> if your account is suspended or banned, you may not be able to sign in or use Gather, and your profile may be hidden from others.</li>
              </ul>
              <p>We do not tolerate harassment, threats, hate, exploitation, illegal content or impersonation. Where we believe someone is at risk of serious harm, we may share relevant information with the appropriate authorities.</p>
            </PolicySection>

            <PolicySection id="security" title="11. Security">
              <p>We take reasonable technical and organisational steps to protect your information, including:</p>
              <ul>
                <li>Encrypted connections (HTTPS) between your device and our servers.</li>
                <li>Secure, hashed password storage through our authentication provider.</li>
                <li>Access rules on our database so that users can only read and send the data they are allowed to access.</li>
                <li>Restricted administrator access and role checks.</li>
                <li>Limits on the type and size of images that can be uploaded.</li>
              </ul>
              <p>No online service can be completely secure. You are responsible for keeping your password confidential, using a strong and unique password, and signing out on shared devices. If you believe your account has been compromised, contact us immediately at ireoluwadavid16@gmail.com.</p>
            </PolicySection>

            <PolicySection id="cookies-and-local-storage" title="12. Cookies and Local Storage">
              <p>Gather uses essential browser storage only. We use it to:</p>
              <ul>
                <li>Keep you signed in securely (your session).</li>
                <li>Remember preferences such as dark or light mode.</li>
                <li>Keep the app working properly.</li>
              </ul>
              <p>We do not use advertising cookies or third-party tracking cookies. Because this storage is essential to provide the service you asked for, it cannot be turned off inside Gather. You can clear it through your browser settings, but you may then be signed out and your preferences reset.</p>
            </PolicySection>

            <PolicySection id="childrens-privacy" title="13. Children's Privacy">
              <p>Gather is not for children. You must be at least 16 years old to create an account. We do not knowingly collect personal information from anyone under 16. If we learn that a user is under 16, we will delete the account and associated information. If you believe a child under 16 is using Gather, please contact us at ireoluwadavid16@gmail.com.</p>
            </PolicySection>

            <PolicySection id="links-and-third-party-content" title="14. Links and Third-Party Content">
              <p>Gather may show links shared by other users. We are not responsible for the privacy practices or content of other websites and services. We encourage you to read their privacy policies before you share information with them.</p>
            </PolicySection>

            <PolicySection id="changes-to-this-policy" title="15. Changes to This Policy">
              <p>We may update this Privacy Policy from time to time to reflect changes to Gather, our practices or the law. When we make important changes, we will notify you in the app or by email before they take effect. The date at the top of this page shows when the policy was last updated. By continuing to use Gather after changes take effect, you accept the updated policy.</p>
            </PolicySection>

            <PolicySection id="contact-us" title="16. Contact Us">
              <p>If you have questions, concerns or requests about this Privacy Policy or your personal information, please contact:</p>
              <p>NEMA Email: <a href="mailto:ireoluwadavid16@gmail.com">ireoluwadavid16@gmail.com</a></p>
            </PolicySection>
          </div>
          <button className="privacy-policy-top-button" type="button" onClick={backToTop}>
            <ArrowUp size={16} /> Back to top
          </button>
        </article>
      </div>
    </main>
  );
}
