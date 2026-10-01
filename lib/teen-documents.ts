/**
 * B3: the documents a Guardian agrees to for a teen's account, each recorded as its own consent_records row
 * (relation guardian_for_teen) with this version. Published word for word by db/migrations/0010_guardians.sql;
 * the consent route refuses if the stored text differs, so what was agreed is what was shown.
 * Source: reference/ascentra.html LEGAL_DOCS (TEEN, MINORPRIV, v0.2), without the items left to counsel.
 */
export type TeenDocKey = "teen_terms" | "minor_privacy_notice";

export const TEEN_DOCUMENTS: Record<TeenDocKey, { title: string; version: string; body: string }> = {
  teen_terms: {
    title: "Teen Terms of Use",
    version: "v0.2",
    body:
      "You need to be at least 14, and a parent or guardian sets up your plan with you. Your account is yours. " +
      "Don't share your sign-in, and don't use anyone else's. Mentor helps you learn. It won't do your graded work, " +
      "and it will tell you when it's not sure. There's no public profile and no chat with other learners. If " +
      "something worries us, we might tell your Guardian what happened and why, but not share your private " +
      "conversations. Your Guardian agrees to these terms for your account before it starts.",
  },
  minor_privacy_notice: {
    title: "Minor Privacy Notice",
    version: "v0.2",
    body:
      "What we keep: your name, that you're a teen, your learning progress, your notes, your Mentor chats, and " +
      "which devices you use. Your notes and Mentor chats are private, even from your Guardian. Your Guardian sees " +
      "your progress, finished work, schedule, billing, and devices. We never sell or share your information, show " +
      "you ads based on what you do, make you findable publicly, track your precise location, or identify you by " +
      "your face or voice. You can ask to see or fix your data. Your Guardian handles export and deletion.",
  },
};

export const TEEN_DOC_KEYS = Object.keys(TEEN_DOCUMENTS) as TeenDocKey[];
export const GUARDIAN_CONSENT_METHOD = "Separate checkbox for each document in the Guardian authorization";

/** The protections every teen account has (reference TEEN_DEFAULTS). Shown to the Guardian before they agree. */
export const TEEN_DEFAULTS = [
  "No sale or sharing of personal information",
  "No behavioral advertising",
  "Not publicly discoverable",
  "No precise location",
  "No biometric identification",
  "Uploads private by default",
  "Voice recordings off by default",
  "Age-appropriate explanations",
  "Clear reporting and safety controls",
];
