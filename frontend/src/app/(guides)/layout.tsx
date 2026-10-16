import Link from "next/link";
import { GuideNav } from "@/components/guides/GuideNav";
import { COFFEE, CoffeeCup, GITHUB, GitHubMark, GUIDES, MARK } from "@/components/landing/brand";
import "@/components/landing/landing.css";
import "@/components/guides/guides.css";

/** The public guides: plain pages for readers and search engines, in the landing page's style. */
export default function GuidesLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="landing guide">
      <header className="top">
        <Link className="wordmark" href="/" aria-label="bopomofo, home">
          <svg viewBox="0 0 2150 2150" aria-hidden="true">
            <path d={MARK} />
          </svg>
          <span>bopomofo</span>
        </Link>
        <GuideNav />
        <nav className="actions" aria-label="Account and project">
          <a className="icon-link" href={GITHUB} aria-label="bopomofo on GitHub">
            <GitHubMark />
            <span className="label">GitHub</span>
          </a>
          <a className="icon-link" href={COFFEE} aria-label="Buy me a coffee, to help pay for the hosting">
            <CoffeeCup />
            <span className="label">Buy me a coffee</span>
          </a>
          <Link className="button" href="/sign-up">
            Start learning{" "}
            <span className="arrow" aria-hidden="true">
              &rarr;
            </span>
          </Link>
        </nav>
      </header>

      <main>{children}</main>

      <footer className="foot f-deep grid">
        <div className="foot-links">
          <nav className="places" aria-label="Project links">
            <Link className="link" href="/">
              The bopomofo app
            </Link>
            <Link className="link" href="/sign-up">
              Make an account
            </Link>
            <a className="link" href={GITHUB}>
              Source code
            </a>
            <a className="link" href={COFFEE}>
              Buy me a coffee
            </a>
          </nav>
          <div className="cols">
            <nav aria-label="Bopomofo guides">
              <h3>Learn Bopomofo</h3>
              <ul>
                {GUIDES.map((g) => (
                  <li key={g.href}>
                    <Link className="link-plain" href={g.href}>
                      {g.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
            <div>
              <h3>Licences</h3>
              <ul>
                <li>
                  Code:{" "}
                  <a className="link-plain" href={GITHUB + "/blob/main/LICENSE"}>
                    AGPL-3.0-only
                  </a>
                </li>
                <li>Symbol strokes and audio: Ministry of Education, Taiwan, CC BY 4.0</li>
              </ul>
            </div>
          </div>
        </div>
        <div className="legal">
          <span>bopomofo is free software under AGPL-3.0-only.</span>
          <Link className="link-plain" href="/">
            bopomofo.app
          </Link>
        </div>
        <div className="giant" aria-hidden="true">
          <span>bopomofo</span>
        </div>
      </footer>
    </div>
  );
}
