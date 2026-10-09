import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";
import { Nav } from "@/components/Nav";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Zhuyin Studio",
  description: "Learn Bopomofo: reading, writing, listening, and speaking with tone feedback.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={geistSans.variable + " h-full antialiased"}>
      <body className="min-h-full flex flex-col md:flex-row">
        <Nav />
        <main className="flex-1 min-w-0 px-5 py-6 md:px-10 md:py-8">{children}</main>
      </body>
    </html>
  );
}
