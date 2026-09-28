/**
 * Devices, sessions and the sharing tracker: every number in one place.
 * Plain constants, not environment variables: they are product rules, the same in every environment,
 * and changing one is a reviewed code change.
 */

/** Trusted devices per account. A device past this must replace one (after a second-factor check). */
export const DEVICE_LIMIT = 3;

/** How often an open, visible signed-in page sends a heartbeat. */
export const HEARTBEAT_SECONDS = 60;

/** A session with no heartbeat for this long is over (the tab closed, the laptop slept). */
export const SESSION_LIVE_SECONDS = 150;

/**
 * The sharing tracker. Signals add points; each kind's points are capped, so no single kind can reach
 * the threshold, and a flag also needs at least MIN_KINDS different kinds. An IP address is never a
 * signal: none is stored or compared.
 */
export const SHARING = {
  windowDays: 30,
  threshold: 5,
  minKinds: 2,
  capPerKind: 3,
  points: {
    device_replacement: 1,
    overlapping_sessions: 1,
    distant_sign_ins: 2,
  },
  /** Two sign-ins on different devices this far apart, faster than this, can't be one person. At most one per account per lookback. */
  travel: { minKm: 500, maxKmh: 900, lookbackHours: 24 },
  /** At most one overlapping-sessions signal per account in this many minutes (switching windows back and forth is one person). */
  overlapCooldownMinutes: 60,
} as const;

export type SignalKind = keyof typeof SHARING.points;

/** How long a Limit (no new devices, no replacements) lasts unless an appeal lifts it sooner. */
export const LIMIT_HOURS = 72;

/** Appeal text length, from the prototype ("at least 20 characters"). */
export const APPEAL_MIN = 20;
export const APPEAL_MAX = 2000;
