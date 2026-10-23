export const FIRST_TRY_ATTEMPTS = 3;

/** tryN is zero-based. Hints end first-try eligibility for the card. */
export function firstTry(ok: boolean, help: boolean, tryN: number): boolean {
  return ok && !help && tryN >= 0 && tryN < FIRST_TRY_ATTEMPTS;
}

/** A missed recording stays pending while another attempt can still earn credit. */
export function firstTryResult(ok: boolean, help: boolean, tryN: number): boolean | null {
  if (firstTry(ok, help, tryN)) return true;
  return help || tryN >= FIRST_TRY_ATTEMPTS - 1 ? false : null;
}
