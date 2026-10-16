import type { Metadata } from "next";
import { GITHUB } from "@/components/landing/brand";

export const SITE = "https://bopomofo.app";
export const OG_IMAGE = { url: "/landing/bobo-night-market.jpg", width: 1672, height: 941 };
/** The day the public pages last changed. The sitemap and the Article data use it. */
export const UPDATED = "2026-10-16";

const ORG_ID = SITE + "/#org";
const SITE_ID = SITE + "/#website";
export const APP_ID = SITE + "/#app";

/** The full metadata of a public page. Next.js replaces nested objects such as openGraph, so each page sets all of them. */
export function pageMeta({
  path,
  title,
  description,
  image = OG_IMAGE,
}: {
  path: string;
  title: string;
  description: string;
  image?: { url: string; width: number; height: number };
}): Metadata {
  return {
    title: { absolute: title },
    description,
    alternates: { canonical: path },
    openGraph: {
      type: "website",
      siteName: "bopomofo",
      locale: "en_US",
      url: path,
      title,
      description,
      images: [image],
    },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}

export const ORGANIZATION = {
  "@type": "Organization",
  "@id": ORG_ID,
  name: "bopomofo",
  url: SITE,
  logo: SITE + "/icon-512.png",
  sameAs: [GITHUB],
};

export const WEBSITE = {
  "@type": "WebSite",
  "@id": SITE_ID,
  url: SITE,
  name: "bopomofo",
  alternateName: ["bopomofo.app", "Bopomofo app", "注音 bopomofo"],
  description: "Learn Bopomofo (Zhuyin, 注音), the phonetic alphabet of Taiwan Mandarin.",
  inLanguage: "en",
  publisher: { "@id": ORG_ID },
};

export const WEB_APP = {
  "@type": "WebApplication",
  "@id": APP_ID,
  name: "bopomofo",
  url: SITE,
  image: SITE + OG_IMAGE.url,
  description:
    "A free, open-source app to learn Bopomofo (Zhuyin, 注音): read the 37 symbols, write each stroke, hear the tones, and speak with tone feedback.",
  applicationCategory: "EducationalApplication",
  operatingSystem: "Any web browser",
  browserRequirements: "Requires JavaScript",
  inLanguage: "en",
  isAccessibleForFree: true,
  offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  license: "https://www.gnu.org/licenses/agpl-3.0.html",
  teaches: ["Bopomofo", "Zhuyin", "Taiwan Mandarin pronunciation", "Mandarin tones"],
  educationalLevel: "Beginner",
  featureList: [
    "The 37 Bopomofo symbols with MOE audio",
    "Stroke-order writing practice",
    "Listening and dictation drills",
    "Speaking practice with tone feedback",
    "Placement test and levels",
  ],
  publisher: { "@id": ORG_ID },
  sameAs: [GITHUB],
};

/** Structured data for a guide page: the article, its place in the site, and the site itself. */
export function guideGraph({
  path,
  title,
  description,
  crumb,
  extra = [],
}: {
  path: string;
  title: string;
  description: string;
  crumb: string;
  extra?: object[];
}) {
  const url = SITE + path;
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Article",
        "@id": url + "#article",
        headline: title,
        description,
        url,
        mainEntityOfPage: url,
        image: SITE + OG_IMAGE.url,
        inLanguage: "en",
        datePublished: UPDATED,
        dateModified: UPDATED,
        author: { "@id": ORG_ID },
        publisher: { "@id": ORG_ID },
        isPartOf: { "@id": SITE_ID },
        about: [
          { "@type": "Thing", name: "Bopomofo", sameAs: "https://en.wikipedia.org/wiki/Bopomofo" },
          { "@type": "Language", name: "Mandarin Chinese", alternateName: "zh-TW" },
        ],
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "bopomofo", item: SITE },
          { "@type": "ListItem", position: 2, name: crumb, item: url },
        ],
      },
      ORGANIZATION,
      WEBSITE,
      ...extra,
    ],
  };
}

/** A JSON-LD script. "<" becomes \u003c, so the text cannot close the script tag (Next.js JSON-LD guide). */
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
