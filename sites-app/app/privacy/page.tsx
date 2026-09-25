import type { Metadata } from "next";
import "./privacy.css";

export const metadata: Metadata = {
  title: "Privacy policy | BullCase",
  description: "How BullCase handles account information, AI Research requests, browser preferences, and service data.",
};

const sections = [
  { id: "scope", label: "Scope and operator" },
  { id: "information", label: "Information we handle" },
  { id: "uses", label: "How we use it" },
  { id: "ai", label: "AI Research" },
  { id: "storage", label: "Browser storage" },
  { id: "sharing", label: "Sharing and providers" },
  { id: "retention", label: "Retention" },
  { id: "security", label: "Security" },
  { id: "choices", label: "Your choices and rights" },
  { id: "transfers", label: "Processing locations" },
  { id: "changes", label: "Changes and contact" },
];

export default function PrivacyPage() {
  return <div className="privacy-page">
    <header className="privacy-site-header">
      <a className="privacy-brand" href="/"><strong>Bull</strong>Case</a>
      <a className="privacy-back" href="/">Back to research</a>
    </header>
    <main className="privacy-document">
      <p className="privacy-eyebrow">BullCase / Privacy</p>
      <h1>Privacy policy</h1>
      <p className="privacy-updated">Effective September 24, 2026</p>
      <p className="privacy-intro">This policy explains what information BullCase handles when you use its company-research site, including optional ChatGPT sign-in and AI Research. You can browse the site without creating a BullCase account.</p>

      <div className="privacy-layout">
        <nav className="privacy-toc" aria-label="Privacy policy sections">
          <h2>On this page</h2>
          {sections.map((section) => <a key={section.id} href={`#${section.id}`}>{section.label}</a>)}
        </nav>
        <div className="privacy-sections">
          <section id="scope">
            <h2>Scope and operator</h2>
            <p>This policy covers information handled by the BullCase website. BullCase is a personal side project operated by Alex Karamov, not a registered business. For questions or privacy requests, email <a href="mailto:GarretLipkin@gmail.com">GarretLipkin@gmail.com</a>.</p>
            <p>OpenAI provides the ChatGPT sign-in and Sites hosting services. Your separate ChatGPT account is governed by <a href="https://openai.com/policies/privacy-policy/" target="_blank" rel="noreferrer">OpenAI’s privacy policy</a>; this page describes BullCase’s own use of information made available to the site.</p>
          </section>

          <section id="information">
            <h2>Information we handle</h2>
            <h3>When you sign in</h3>
            <p>If you choose Sign in with ChatGPT, BullCase receives an account identifier and email address, plus your name if it is available through the sign-in service. BullCase stores your identifier, email, display name, preferred AI provider, any provider credentials you save, and favorite companies associated with your account. A favorite records its ticker and when it was saved.</p>
            <h3>When you use research features</h3>
            <p>The site processes the company symbols, searches, data requests, and manual refreshes needed to provide research. It keeps short-lived rate-limit records using account-based or IP-derived identifiers. It also stores public-company data caches and company-level usage counts to keep research available and manage refreshes. Those company-level counts are not linked to your account in the application code.</p>
            <h3>Technical information</h3>
            <p>The hosting and security layers may receive ordinary request information such as an IP address, browser headers, requested page, and time of access. The application can record operational errors and cache events, which may include a company ticker, provider, outcome, timing, and a shortened error message. We do not add an advertising tracker or a third-party analytics SDK in the current site code.</p>
          </section>

          <section id="uses">
            <h2>How we use information</h2>
            <ul>
              <li>Provide company search, financial analysis, saved favorites, and account settings.</li>
              <li>Connect to an AI provider only when you use AI Research, and send the information needed for that request.</li>
              <li>Apply usage limits, protect the service from abuse, diagnose errors, and keep public-company data reasonably current.</li>
              <li>Respond to privacy questions or requests sent to the contact address above.</li>
            </ul>
            <p>Signing in, saving favorites, and saving provider keys are optional. Some personalized features will not work without sign-in, and AI Research needs an available provider connection.</p>
          </section>

          <section id="ai">
            <h2>AI Research and provider keys</h2>
            <p>When you submit an AI Research question, BullCase sends your question, recent conversation turns included with that request, the selected company, and relevant financial evidence to the provider you selected: OpenRouter, Groq, or Google AI Studio. A provider may process that content under its own terms and privacy practices. Avoid including information in a question that you do not want sent to that provider.</p>
            <p>The conversation stays in the current page’s memory in the application code; BullCase does not save AI chat transcripts in its account database. Starting a new chat clears the conversation shown in that page. This does not control what an AI provider or hosting service may retain.</p>
            <p>A key entered in the AI Research dialog is used for that chat session and is not saved to your BullCase account by that flow. If you separately choose to save an OpenRouter or Groq key in Account, BullCase encrypts it before database storage, uses it to make provider requests, and does not return the saved key to the browser. You can remove a saved provider key in Account.</p>
          </section>

          <section id="storage">
            <h2>Browser storage and cookies</h2>
            <p>BullCase uses your browser’s local storage for your selected theme, up to five recent companies, valuation assumptions, and whether a favorites tip has been shown. These preferences stay on that browser rather than being saved in your BullCase account. They do not expire automatically in the application code. You can clear them with your browser’s site-data controls.</p>
            <p>The current BullCase application code does not set analytics or advertising cookies. ChatGPT sign-in and hosting may use cookies or similar technologies to provide sessions, security, and site delivery; those are controlled by the relevant service providers, not by the browser-preference features described above.</p>
          </section>

          <section id="sharing">
            <h2>Sharing and outside services</h2>
            <p>OpenAI hosts BullCase as a ChatGPT Site and provides sign-in. The site runs using hosted infrastructure, including a Cloudflare Worker and database. These services may process information needed to operate the site. The AI provider you choose receives the content described in the AI Research section.</p>
            <p>BullCase obtains public company, market, news, and policy information from outside data sources. The application may fetch company logos from outside image hosts in your browser; when it does, that host may receive your network address and ordinary request information. Following an external link takes you to that service’s own site and privacy practices.</p>
            <p>We may also disclose information when required by law or to protect the site and its users. This policy does not claim that outside providers follow BullCase’s retention rules.</p>
          </section>

          <section id="retention">
            <h2>How long information is kept</h2>
            <p>Account profiles, favorites, and saved provider keys do not have an automatic expiry in the current application code. You can remove favorites and saved provider keys in Account. For a broader access or deletion request, email the privacy contact below; we may need to verify that the account is yours and assess what can be removed under applicable law.</p>
            <p>Rate-limit records expire with their time windows. Operational cache events are scheduled for pruning after 30 days. Public-company data caches have their own refresh and expiry rules. Browser preferences remain until you clear them or your browser removes them. Hosting logs and backups may follow separate provider retention settings, and immediate removal from those systems is not guaranteed.</p>
          </section>

          <section id="security">
            <h2>Security</h2>
            <p>BullCase limits access to account features to signed-in users and encrypts saved AI provider keys before database storage. The saved key itself is not displayed again in Account. The site also applies request validation and rate limits. No online service can guarantee absolute security, so please do not put secrets or unrelated sensitive personal information in research questions.</p>
          </section>

          <section id="choices">
            <h2>Your choices and privacy rights</h2>
            <ul>
              <li>Use general research without signing in, subject to the site’s usage limits.</li>
              <li>Remove individual favorites or saved provider keys from Account.</li>
              <li>Start a new AI chat and clear browser-stored preferences using your browser settings.</li>
              <li>Email us to ask about access, correction, or deletion of personal information associated with your BullCase account.</li>
            </ul>
            <p>Depending on where you live, applicable privacy law may provide additional rights, including the ability to object to or restrict processing, receive a copy of information, withdraw consent where relevant, or complain to a privacy regulator. We will review requests in light of the law that applies and may ask you to verify your identity. For information held in your separate ChatGPT account, use OpenAI’s own privacy controls or contact OpenAI.</p>
          </section>

          <section id="transfers">
            <h2>Where information may be processed</h2>
            <p>BullCase uses online hosting, sign-in, market-data, image, and optional AI services. Information may be processed in locations outside your country. We do not promise that BullCase data remains in a particular country, and this policy does not assert a transfer mechanism or data-residency setting that has not been verified for this deployment.</p>
          </section>

          <section id="changes">
            <h2>Changes and contact</h2>
            <p>We may update this policy when the site’s features or data practices change. The effective date at the top shows when this version took effect. Material changes may also need a notice where required by law.</p>
            <div className="privacy-contact">
              <p>For privacy questions, access or deletion requests, or concerns about this policy, contact <a href="mailto:GarretLipkin@gmail.com">GarretLipkin@gmail.com</a>. Please do not include an AI provider key or other secret in your email.</p>
            </div>
          </section>
        </div>
      </div>
    </main>
  </div>;
}
