/** Wording rules shared by server code and pure checks (no server-only imports here). */
export const ATTORNEY = /attorney[- ]?approved|lawyer[- ]?approved|legally approved/i;
export const NO_ATTORNEY = "ASCENTRA never calls anything attorney-approved. Reword it.";
