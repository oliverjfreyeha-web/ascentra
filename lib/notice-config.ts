/**
 * B4: when notices go out and when privacy requests are due.
 * COUNSEL ITEM: every value below is a PLACEHOLDER. The exact timings are for counsel to set; change them here
 * (code review + deploy), nowhere else.
 */
export const NOTICE_TIMINGS = {
  /** PLACEHOLDER: days before a free trial converts to Basic that the payer is emailed. */
  trialEndingDaysBefore: 3,
  /** PLACEHOLDER: days before a monthly renewal that the payer is emailed. */
  renewalReminderDaysBefore: 7,
} as const;

export const PRIVACY_TIMINGS = {
  /** PLACEHOLDER: days within which an export must be answered (exports are answered at once). */
  exportDueDays: 45,
  /** PLACEHOLDER: days within which a deletion request must be completed. */
  deletionDueDays: 45,
} as const;

export const TIMINGS_ARE_PLACEHOLDERS = true;
