import type { UserJSON } from "@clerk/nextjs/server";

export function clerkUser(over: {
  id?: string;
  email?: string;
  verified?: boolean;
  passwordEnabled?: boolean;
  twoFactorEnabled?: boolean;
  passwordLastUpdatedAt?: number | null;
  updatedAt?: number;
} = {}): UserJSON {
  const emailId = "idn_1";
  return {
    object: "user",
    id: over.id ?? "user_1",
    first_name: "Olive",
    last_name: "Owner",
    username: null,
    image_url: "https://img.clerk.com/x",
    has_image: false,
    primary_email_address_id: emailId,
    primary_phone_number_id: null,
    primary_web3_wallet_id: null,
    password_enabled: over.passwordEnabled ?? false,
    two_factor_enabled: over.twoFactorEnabled ?? false,
    totp_enabled: false,
    backup_code_enabled: false,
    email_addresses: [
      {
        object: "email_address",
        id: emailId,
        email_address: over.email ?? "owner@example.com",
        verification: { status: (over.verified ?? true) ? "verified" : "unverified", strategy: "email_code", attempts: 1, expire_at: null },
        linked_to: [],
      },
    ],
    phone_numbers: [],
    web3_wallets: [],
    organization_memberships: null,
    external_accounts: [],
    enterprise_accounts: [],
    password_last_updated_at: over.passwordLastUpdatedAt ?? null,
    public_metadata: {},
    private_metadata: {},
    unsafe_metadata: {},
    external_id: null,
    last_sign_in_at: null,
    banned: false,
    locked: false,
    lockout_expires_in_seconds: null,
    verification_attempts_remaining: null,
    created_at: 1_700_000_000_000,
    updated_at: over.updatedAt ?? 1_700_000_000_000,
    last_active_at: null,
    create_organization_enabled: false,
    create_organizations_limit: null,
    delete_self_enabled: false,
    legal_accepted_at: null,
    locale: null,
  } as unknown as UserJSON;
}
