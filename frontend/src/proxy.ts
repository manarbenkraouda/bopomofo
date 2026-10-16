import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

// Every page needs a signed-in user, except the landing page and the sign-in and sign-up pages.
// "/" shows the landing page to a signed-out visitor and the Dashboard to a learner. The landing page's route is
// /welcome, but the address stays "/": a rewrite does not change the URL, so /welcome itself goes back to "/".
// On any other page, a signed-out visitor goes to /sign-in.
// The API (FastAPI) checks the same Clerk session token on its side.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  const { pathname } = req.nextUrl;
  if (pathname === "/welcome") return NextResponse.redirect(new URL("/", req.url));
  if (pathname === "/" && !(await auth()).userId) return NextResponse.rewrite(new URL("/welcome", req.url));
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files (audio, video, images, fonts, the manifest).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|wav|mp3|mp4|webmanifest)).*)",
  ],
};
