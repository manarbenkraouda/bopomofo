import type { MetadataRoute } from "next";
import { GUIDES } from "@/components/landing/brand";
import { SITE, UPDATED } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: SITE, lastModified: UPDATED, changeFrequency: "weekly", priority: 1 },
    ...GUIDES.map((g) => ({
      url: SITE + g.href,
      lastModified: UPDATED,
      changeFrequency: "monthly" as const,
      priority: 0.8,
    })),
  ];
}
