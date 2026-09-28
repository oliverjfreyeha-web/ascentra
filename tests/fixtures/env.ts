// Well-formed values for every required variable. None is a real credential.
export const TEST_ENV = {
  SUPABASE_URL: "https://ascentra-test.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "wrong-supabase-service-role-key",
  CLERK_SECRET_KEY: "sk_test_wrong_clerk_secret_key",
  CLERK_WEBHOOK_SIGNING_SECRET: "whsec_" + Buffer.from("ascentra-test-webhook-signing-secret").toString("base64"),
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_" + Buffer.from("ascentra-test.clerk.accounts.dev$").toString("base64"),
  OWNER_EMAIL: "owner@example.com",
  CRON_SECRET: "test-cron-secret-0123456789abcdefghij",
} as const;
