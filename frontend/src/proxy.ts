import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Every page needs a signed-in user, except the sign-in and sign-up pages. Signed-out visitors go to /sign-in.
// The API (FastAPI) checks the same Clerk session token on its side.
const isPublic = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req) => {
  if (!isPublic(req)) await auth.protect();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static files (audio, images, fonts, the manifest).
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|wav|mp3|webmanifest)).*)",
  ],
};
