"use client";
import { useAuth } from "@clerk/nextjs";
import { useEffect } from "react";
import { setTokenGetter } from "@/lib/api";

/**
 * Gives the API client the Clerk session token, so every request to the backend says who is signed in.
 * Only once the user is signed in: requests made before that (just after the sign-in redirect) wait for the token.
 */
export function ApiAuth() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  useEffect(() => {
    setTokenGetter(isLoaded && isSignedIn ? () => getToken() : null);
  }, [isLoaded, isSignedIn, getToken]);
  return null;
}
