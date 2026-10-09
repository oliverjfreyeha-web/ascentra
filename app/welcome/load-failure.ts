/**
 * R1: what /welcome says when it can't read the sign-up state. A 401 while Clerk says "signed in" means the sign-in
 * isn't finished (for example a step Clerk still asks for); before, the page stayed on "Checking your account…".
 */
export const SIGN_IN_UNFINISHED = "Your sign-in isn't finished. Sign out, then sign in again and complete every step Clerk asks for.";
export const LOAD_FAILED = "Couldn't load your account. Reload the page to try again.";
export const loadFailure = (status: number): string => (status === 401 ? SIGN_IN_UNFINISHED : LOAD_FAILED);
