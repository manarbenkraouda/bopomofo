import Image from "next/image";
import Link from "next/link";

export function Hero({
  crumb,
  title,
  lead,
  bear,
  children,
}: {
  crumb: string;
  title: string;
  lead: string;
  bear: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="g-hero f-night grid">
      <p className="crumbs">
        <Link className="link-plain" href="/">
          bopomofo
        </Link>{" "}
        / {crumb}
      </p>
      <h1>{title}</h1>
      <p className="lead">{lead}</p>
      {children}
      <Image
        className="g-bear"
        src={bear}
        alt=""
        width={560}
        height={587}
        sizes="(max-width: 60em) 40vw, 22vw"
        priority
      />
    </header>
  );
}

export function Section({
  id,
  title,
  tone = "f-paper",
  wide = false,
  children,
}: {
  id: string;
  title: string;
  tone?: "f-paper" | "f-night" | "f-deep";
  wide?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className={"g-sec grid " + tone + (wide ? " is-wide" : "")} aria-labelledby={id + "-title"}>
      <h2 id={id + "-title"}>{title}</h2>
      <div className="g-body">{children}</div>
    </section>
  );
}

export function Cta() {
  return (
    <section className="g-cta f-seal grid" aria-labelledby="cta-title">
      <h2 id="cta-title">Learn it with Bobo.</h2>
      <p className="lead">
        bopomofo teaches the 37 symbols with MOE audio, writing in stroke order, listening drills, and speaking practice
        with tone feedback. It is free and open source.
      </p>
      <div className="acts">
        <Link className="button" href="/sign-up">
          Start learning{" "}
          <span className="arrow" aria-hidden="true">
            &rarr;
          </span>
        </Link>
        <Link className="link-plain" href="/#try">
          Try one symbol first
        </Link>
      </div>
    </section>
  );
}

export function Sources({ items }: { items: { label: string; href: string }[] }) {
  return (
    <section className="g-sources f-deep grid" aria-labelledby="sources-title">
      <h2 id="sources-title">Sources</h2>
      <ul>
        {items.map((s) => (
          <li key={s.href}>
            <a className="link-plain" href={s.href}>
              {s.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
