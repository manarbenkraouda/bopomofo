import type { Metadata, Viewport } from "next";
import { ClerkProvider } from "@clerk/nextjs";
import { Geist } from "next/font/google";
import "./globals.css";
import { ApiAuth } from "@/components/shell/ApiAuth";
import { Frame } from "@/components/shell/AppShell";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://bopomofo.app"),
  title: "bopomofo",
  description: "Learn Bopomofo: reading, writing, listening, and speaking with tone feedback.",
  appleWebApp: { capable: true, title: "bopomofo", statusBarStyle: "black-translucent" },
  icons: { icon: "/icon.svg", apple: "/icon.svg" },
};

// viewportFit "cover": the app draws under the phone's notch and home bar; the shell keeps clear of them with safe-area padding.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#141218" };

// Set the saved theme before the first paint, so the page does not flash.
const THEME = "try{document.documentElement.dataset.theme=localStorage.getItem('zhuyin.theme')||'dark'}catch(e){}";

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" data-theme="dark" className={geistSans.variable + " h-full antialiased"} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME }} />
      </head>
      <body className="h-full overflow-hidden">
        <ClerkProvider>
          <ApiAuth />
          <Frame>{children}</Frame>
        </ClerkProvider>
      </body>
    </html>
  );
}
