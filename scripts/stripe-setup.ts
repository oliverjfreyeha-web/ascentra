/**
 * One-time Stripe sandbox setup for ASCENTRA billing (B1). Run it on your own computer:
 *   npm run stripe:setup
 * It asks for your Stripe SANDBOX secret key (typing is hidden; it is never saved or printed), refuses a
 * live key, then creates, or finds if they already exist:
 *   - the products "ASCENTRA Basic" and "ASCENTRA Pro";
 *   - their monthly prices: $20.00 and $50.00 (USD), with lookup keys ascentra_basic_monthly / ascentra_pro_monthly;
 *   - a customer-portal configuration: cancel at period end, switch Basic ⇄ Pro (downgrades at renewal),
 *     update the payment method, see invoices.
 * and prints the three ids to paste into Vercel. Safe to run again: nothing is duplicated.
 */
import { createInterface } from "node:readline";
import Stripe from "stripe";

const PLANS = [
  { key: "basic", name: "ASCENTRA Basic", cents: 2000, lookup: "ascentra_basic_monthly" },
  { key: "pro", name: "ASCENTRA Pro", cents: 5000, lookup: "ascentra_pro_monthly" },
] as const;
const PORTAL_TAG = "ascentra_b1";

function fail(msg: string): never {
  console.error(`\n✖ ${msg}\n`);
  process.exit(1);
}

/** Reads a line without echoing it (works in PowerShell, Command Prompt and macOS/Linux terminals). */
function askHidden(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    let prompted = false;
    out._writeToOutput = (s: string) => {
      if (!prompted) { out.output.write(s); prompted = true; } else if (s.includes("\n")) out.output.write("\n");
    };
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function checkKey(key: string) {
  if (/^(sk|rk)_live_/.test(key)) fail("That is a LIVE key. This script only runs with a sandbox (test mode) key: sk_test_…. Nothing was changed.");
  if (!/^(sk|rk)_test_/.test(key)) fail("That doesn't look like a Stripe sandbox secret key (it should start with sk_test_). Nothing was changed.");
}

async function main() {
  const key = (process.env.STRIPE_SECRET_KEY ?? "").trim() || (await askHidden("Stripe sandbox secret key (sk_test_…, hidden): "));
  if (!key) fail("No key given. Nothing was changed.");
  checkKey(key);
  const stripe = new Stripe(key, { appInfo: { name: "ASCENTRA setup" } });

  // Belt and braces: the account behind the key must answer in test mode.
  const probe = await stripe.products.list({ limit: 1 }).catch((e: Error) => fail(`Stripe refused the key: ${e.message}`));
  if (probe.data.some((p) => p.livemode)) fail("Stripe answered in live mode. Nothing was changed.");

  const found = await stripe.prices.list({ lookup_keys: PLANS.map((p) => p.lookup), active: true, expand: ["data.product"], limit: 10 });
  const ids: Record<string, { price: string; product: string }> = {};
  for (const plan of PLANS) {
    let price = found.data.find((p) => p.lookup_key === plan.lookup);
    if (price) {
      const ok = price.unit_amount === plan.cents && price.currency === "usd" && price.recurring?.interval === "month" && price.recurring.interval_count === 1;
      if (!ok) fail(`The existing price "${plan.lookup}" isn't $${plan.cents / 100}.00/month in USD. Archive it in the Stripe dashboard and run this again.`);
      console.log(`✓ Found ${plan.name}: $${(plan.cents / 100).toFixed(2)}/month (${price.id})`);
    } else {
      const product = await stripe.products.create({ name: plan.name, metadata: { ascentra_plan: plan.key } });
      price = await stripe.prices.create({
        product: product.id, unit_amount: plan.cents, currency: "usd", recurring: { interval: "month", interval_count: 1 },
        lookup_key: plan.lookup, nickname: `${plan.name} monthly`, metadata: { ascentra_plan: plan.key },
      });
      console.log(`✓ Created ${plan.name}: $${(plan.cents / 100).toFixed(2)}/month (${price.id})`);
    }
    if (price.livemode) fail("Stripe created a live-mode price. Stop and check the key.");
    ids[plan.key] = { price: price.id, product: typeof price.product === "string" ? price.product : price.product.id };
  }

  const portals = await stripe.billingPortal.configurations.list({ active: true, limit: 100 });
  let portal = portals.data.find((c) => c.metadata?.ascentra === PORTAL_TAG);
  if (portal) {
    console.log(`✓ Found the customer-portal configuration (${portal.id})`);
  } else {
    portal = await stripe.billingPortal.configurations.create({
      business_profile: { headline: "ASCENTRA: manage your plan" },
      metadata: { ascentra: PORTAL_TAG },
      features: {
        customer_update: { enabled: true, allowed_updates: ["email", "address"] },
        invoice_history: { enabled: true },
        payment_method_update: { enabled: true },
        subscription_cancel: { enabled: true, mode: "at_period_end", proration_behavior: "none" },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ["price"],
          proration_behavior: "create_prorations",
          products: [
            { product: ids.basic.product, prices: [ids.basic.price] },
            { product: ids.pro.product, prices: [ids.pro.price] },
          ],
          // Pro → Basic takes effect at the next renewal; Basic → Pro at once.
          schedule_at_period_end: { conditions: [{ type: "decreasing_item_amount" }] },
        },
      },
    });
    console.log(`✓ Created the customer-portal configuration (${portal.id})`);
  }

  console.log("\nPaste these three into Vercel → Settings → Environment Variables (Production), then redeploy:\n");
  console.log(`  STRIPE_PRICE_BASIC   = ${ids.basic.price}`);
  console.log(`  STRIPE_PRICE_PRO     = ${ids.pro.price}`);
  console.log(`  STRIPE_PORTAL_CONFIG = ${portal.id}`);
  console.log("\nThese are ids, not secrets. The secret key was not saved or printed.\n");
}

main().catch((e: Error) => fail(e.message));
