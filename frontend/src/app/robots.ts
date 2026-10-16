import type { MetadataRoute } from "next";
import { SITE } from "@/lib/seo";

// Every crawler, search engines and AI assistants alike, may read the public pages. App pages need a session and
// send a crawler to /sign-in, which has noindex.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: SITE + "/sitemap.xml",
    host: SITE,
  };
}
