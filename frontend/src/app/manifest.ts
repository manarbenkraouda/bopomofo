import type { MetadataRoute } from "next";

// "Add to Home Screen" on a phone opens the app full screen, without the browser bars.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "bopomofo",
    short_name: "bopomofo",
    description: "Learn Bopomofo: reading, writing, listening, and speaking with tone feedback.",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#141218",
    theme_color: "#141218",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
