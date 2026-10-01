// Seeds a LOCAL development database with the prototype's demo world (Oliver, Maya, Jordan, Eli,
// Dana; the Home Services academy). It refuses to run anywhere else:
//   * before connecting: see scripts/seed-guard.mjs (local host only, not production, not Vercel);
//   * after connecting: if any account exists that this script did not create, it stops.
//
//   SEED_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:54322/postgres npm run db:seed
//
// Safe to re-run: rows are keyed by stable values and skipped when present.
import pg from "pg";
import { SEED_USER_PREFIX, refuseSeed } from "./seed-guard.mjs";

const reason = refuseSeed(process.env);
if (reason) {
  console.error(`Refusing to seed: ${reason}`);
  process.exit(1);
}

const client = new pg.Client({ connectionString: process.env.SEED_DATABASE_URL });
await client.connect();

try {
  const { rows } = await client.query(
    "select count(*)::int as n from public.accounts where clerk_user_id not like $1",
    [`${SEED_USER_PREFIX}%`],
  );
  if (rows[0].n > 0) {
    console.error(`Refusing to seed: this database has ${rows[0].n} real account(s). The seed only runs on a development database.`);
    process.exit(1);
  }

  await client.query("begin");
  const q = (text, values) => client.query(text, values);
  const one = async (text, values) => (await q(text, values)).rows[0]?.id;
  const ts = (d) => new Date(`${d}T12:00:00Z`).toISOString();

  // ---- People (prototype ACCOUNTS) ----
  const people = [
    ["oliver", "Oliver", "owner", false],
    ["maya", "Maya", "learner", false],
    ["jordan", "Jordan", "learner", false],
    ["eli", "Eli", "learner", true],
    ["dana", "Dana", "guardian", false],
  ];
  const acc = {};
  for (const [key, name, role, minor] of people) {
    await q(
      // A teen starts pending and becomes active once the Guardian link below is verified (B2).
      `insert into public.accounts (clerk_user_id, email, email_verified, role, is_minor, status, two_factor_enabled, clerk_updated_at)
       values ($1, $2, true, $3, $4, $5, true, now()) on conflict (clerk_user_id) do nothing`,
      [`${SEED_USER_PREFIX}${key}`, `${key}@example.com`, role, minor, minor ? "pending" : "active"],
    );
    acc[key] = await one("select id from public.accounts where clerk_user_id = $1", [`${SEED_USER_PREFIX}${key}`]);
    await q(
      `insert into public.profiles (account_id, display_name) values ($1, $2) on conflict (account_id) do nothing`,
      [acc[key], name],
    );
    await q(`insert into public.world_preferences (account_id) values ($1) on conflict (account_id) do nothing`, [acc[key]]);
    await q(`insert into public.notification_preferences (account_id) values ($1) on conflict (account_id) do nothing`, [acc[key]]);
  }

  // B3: a Guardian authorizes a teen only after passing the identity and adult check.
  await q(`update public.accounts set identity_status = 'verified', identity_verified_at = now() where id = $1 and identity_status <> 'verified'`, [acc.dana]);
  await q(
    `insert into public.guardian_relationships (guardian_account_id, teen_account_id, verification_status, authorized_at)
     values ($1, $2, 'verified', $3) on conflict do nothing`,
    [acc.dana, acc.eli, ts("2026-09-10")],
  );
  await q(`update public.accounts set status = 'active' where id = $1 and status = 'pending'`, [acc.eli]);

  // ---- Legal documents (prototype LEGAL_DOCS, all v0.1 drafts awaiting counsel) ----
  const docs = [
    "General Terms", "Privacy Policy", "Automatic Renewal Terms", "Trial Disclosure", "Cancellation and Refunds",
    "Acceptable Use", "Account Sharing", "AI Limitations", "Guardian Consent", "Teen Terms", "Minor Privacy Notice",
    "Transition at 18",
  ];
  const docId = {};
  for (const title of docs) {
    const key = title.toLowerCase().replace(/[^a-z0-9]+/g, "_");
    await q(
      `insert into public.legal_document_versions (document_key, title, version, status)
       values ($1, $2, 'v0.1', 'counsel_review') on conflict (document_key, version) do nothing`,
      [key, title],
    );
    docId[title] = await one("select id from public.legal_document_versions where document_key = $1 and version = 'v0.1'", [key]);
  }

  // ---- Billing (prototype SUBSCRIPTIONS) ----
  let mayaSub = await one("select id from public.subscriptions where processor_subscription_id = 'seed_sub_maya'");
  if (!mayaSub) {
    mayaSub = await one(
      `insert into public.subscriptions (payer_account_id, beneficiary_account_id, plan, status, started_at,
         trial_ends_at, first_charge_at, renews_at, processor_subscription_id)
       values ($1, $1, 'trial', 'trialing', $2, $3, $3, $4, 'seed_sub_maya') returning id`,
      [acc.maya, ts("2026-09-21"), ts("2026-10-05"), ts("2026-10-21")],
    );
    await q(
      `insert into public.trial_consents (subscription_id, account_id, disclosure_document_version_id, trial_ends_at,
         first_charge_at, first_charge_amount_cents, disclosed_at, reminder_scheduled_for)
       values ($1, $2, $3, $4, $4, 2000, $5, $6)`,
      [mayaSub, acc.maya, docId["Trial Disclosure"], ts("2026-10-05"), ts("2026-09-21"), ts("2026-10-02")],
    );
    await q(
      `insert into public.entitlements (account_id, source, subscription_id, tier, valid_from, valid_until)
       values ($1, 'subscription', $2, 'trial', $3, $4)`,
      [acc.maya, mayaSub, ts("2026-09-21"), ts("2026-10-05")],
    );
    // Consent records are insert-only, so they are written once, with the subscription.
    await q(
      `insert into public.consent_records (account_id, actor_account_id, relation, legal_document_version_id, status, method, consented_at)
       values ($1, $1, 'self', $2, 'given', 'Checkbox and Start trial button', $3),
              ($4, $5, 'guardian_for_teen', $6, 'given', 'Signed consent form', $7)`,
      [acc.maya, docId["Trial Disclosure"], ts("2026-09-21"), acc.eli, acc.dana, docId["Guardian Consent"], ts("2026-09-10")],
    );
  }

  // ---- Content: the Home Services academy (prototype mkt) ----
  await q(
    `insert into public.academies (slug, name, outcome, estimate, cadence, grouping)
     values ('mkt', 'Home Services Growth Academy',
       'Turn more inquiries into booked jobs with a clear offer, fast response, planned follow-up, and a cost per booked job you can defend.',
       '10 weeks', '4 sessions a week', 'module')
     on conflict (slug) do nothing`,
  );
  const mkt = await one("select id from public.academies where slug = 'mkt'");

  await q(
    `insert into public.courses (academy_id, version, status, summary, created_by_account_id, published_at)
     values ($1, 1, 'published', 'First published version', $2, $3),
            ($1, 2, 'draft', 'Adds the estimate follow-up lesson', $2, null)
     on conflict (academy_id, version) do nothing`,
    [mkt, acc.oliver, ts("2026-09-01")],
  );
  const course = await one("select id from public.courses where academy_id = $1 and version = 1", [mkt]);

  const modules = [["k1", "Offer and ideal customer"], ["k2", "Lead response"]];
  const mod = {};
  for (const [i, [code, title]] of modules.entries()) {
    await q(
      `insert into public.modules (course_id, position, code, title, stage) values ($1, $2, $3, $4, 'Foundations')
       on conflict (course_id, code) do nothing`,
      [course, i + 1, code, title],
    );
    mod[code] = await one("select id from public.modules where course_id = $1 and code = $2", [course, code]);
    await q(
      `insert into public.lessons (module_id, position, title, minutes) values ($1, 1, $2, 12)
       on conflict (module_id, position) do nothing`,
      [mod[code], title],
    );
    const lesson = await one("select id from public.lessons where module_id = $1 and position = 1", [mod[code]]);
    await q(
      `insert into public.learning_activities (lesson_id, position, activity_type, pass_threshold_percent)
       values ($1, 1, 'explainer', null), ($1, 2, 'quiz', 80) on conflict (lesson_id, position) do nothing`,
      [lesson],
    );
    await q(
      `insert into public.skills (course_id, module_id, key, name) values ($1, $2, $3, $4) on conflict (course_id, key) do nothing`,
      [course, mod[code], code === "k1" ? "offer" : "response", title],
    );
    await q(
      `insert into public.progress_records (account_id, module_id, status, percent)
       select $1, $2, $3, $4 where not exists (select 1 from public.progress_records where account_id = $1 and module_id = $2)`,
      [acc.maya, mod[code], code === "k1" ? "complete" : "in_progress", code === "k1" ? 100 : 40],
    );
  }

  const skill = await one("select id from public.skills where course_id = $1 and key = 'offer'", [course]);
  await q(
    `insert into public.mastery_records (account_id, skill_id, exposure, recall, application, retention, independence)
     values ($1, $2, 58, 50, 34, 44, 12) on conflict (account_id, skill_id) do nothing`,
    [acc.maya, skill],
  );
  await q(
    `insert into public.schedules (account_id, academy_id, sessions_per_week, minutes_per_session, target_finish_on)
     values ($1, $2, 4, 45, '2026-12-04') on conflict (account_id, academy_id) do nothing`,
    [acc.maya, mkt],
  );

  // ---- Sources and the prototype's conflict c1 ----
  if (!(await one("select id from public.source_conflicts where academy_id = $1", [mkt]))) {
    const lessonK2 = await one("select id from public.lessons where module_id = $1", [mod.k2]);
    const sA = await one(
      `insert into public.sources (academy_id, title, source_type, published_year, health, indicators, is_sample)
       values ($1, 'Inbound lead response study (sample)', 'Secondary · industry research summary', 2019, 'dated',
               '{Large sample,Mixed industries,Older}', true) returning id`,
      [mkt],
    );
    const sB = await one(
      `insert into public.sources (academy_id, title, source_type, published_year, health, indicators, is_sample)
       values ($1, 'Home services booking benchmark (sample)', 'Primary · operator survey', 2025, 'current',
               '{Home services only,Measures booked jobs,Newer}', true) returning id`,
      [mkt],
    );
    const cA = await one(
      `insert into public.source_claims (source_id, lesson_id, claim, state) values ($1, $2, 'Respond within 5 minutes.', 'proposed') returning id`,
      [sA, lessonK2],
    );
    const cB = await one(
      `insert into public.source_claims (source_id, lesson_id, claim, state) values ($1, $2, 'Respond within 1 hour with a useful first reply.', 'proposed') returning id`,
      [sB, lessonK2],
    );
    await q(
      `insert into public.source_conflicts (academy_id, lesson_id, claim_a_id, claim_b_id, reasons, recommended_claim_id, recommendation_rationale)
       values ($1, $2, $3, $4, '{They studied different leads,They measured different outcomes,They are six years apart}', $4,
               'Source B studies home service businesses and measures booked jobs, which is the course outcome.')`,
      [mkt, lessonK2, cA, cB],
    );
  }

  // ---- Operations: every external service starts Disconnected ----
  for (const service of ["supabase", "clerk", "stripe", "email", "storage", "ai"]) {
    await q(`insert into public.connection_statuses (service) values ($1) on conflict (service) do nothing`, [service]);
  }

  await q(
    `insert into public.audit_events (actor_account_id, actor_label, action, context)
     values ($1, 'Oliver (Owner)', 'Development database seeded', 'scripts/seed-dev.mjs')`,
    [acc.oliver],
  );

  await q("commit");
  console.log("Seeded the development database: 5 accounts, 1 academy, 2 course versions, 2 modules, sources and a conflict.");
} catch (err) {
  await client.query("rollback").catch(() => {});
  throw err;
} finally {
  await client.end();
}
