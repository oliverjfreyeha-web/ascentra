import "server-only";
import type { Account } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { refused, type Result } from "@/lib/courses/common";

/**
 * C2: the Owner's community links (a Discord link and the Owner's social links), on a plain Community page for everyone.
 * Shown to teens unless the Owner hides them from teens. Every link is an outside link and opens in a new tab. No chat,
 * stickers, profile links or messages between users are built here.
 */
type Row = { discord_url: string | null; social_links: { label: string; url: string }[]; hide_from_teens: boolean; updated_at: string };

async function settings(): Promise<Row> {
  return ((await getDb().from("community_settings").select("discord_url, social_links, hide_from_teens, updated_at").eq("id", 1).maybeSingle()).data as Row | null)
    ?? { discord_url: null, social_links: [], hide_from_teens: false, updated_at: new Date(0).toISOString() };
}

export async function community(actor: Account) {
  const s = await settings();
  const hidden = actor.isMinor && s.hide_from_teens;
  const links = hidden ? [] : [
    ...(s.discord_url ? [{ label: "Discord", url: s.discord_url }] : []),
    ...(s.social_links ?? []),
  ];
  return {
    links, hidden,
    note: hidden ? "Community links aren't shown on teen accounts." : links.length ? "These are outside links: they open other websites in a new tab. ASCENTRA doesn't run them." : "No community links yet.",
    ...(actor.roleKey === "owner" ? { settings: { discordUrl: s.discord_url, socialLinks: s.social_links ?? [], hideFromTeens: s.hide_from_teens } } : {}),
  };
}

const httpsUrl = (v: unknown) => typeof v === "string" && /^https:\/\/[^\s<>"]{3,300}$/.test(v.trim()) ? v.trim() : null;

/** The Owner sets the links. Body: { discordUrl, socialLinks: [{ label, url }], hideFromTeens }. Audited. */
export async function setCommunity(actor: Account, body: Record<string, unknown>): Promise<Result> {
  const A = "community.settings";
  if (actor.roleKey !== "owner") return refused(403, "Only the Owner sets the community links.", A);
  const discord = body.discordUrl === null || body.discordUrl === "" ? null : httpsUrl(body.discordUrl);
  if (body.discordUrl && !discord) return refused(400, "The Discord link starts with https://.", A);
  const socials: { label: string; url: string }[] = [];
  for (const l of Array.isArray(body.socialLinks) ? body.socialLinks.slice(0, 8) : []) {
    const o = (l && typeof l === "object" ? l : {}) as Record<string, unknown>;
    const label = typeof o.label === "string" ? o.label.trim().slice(0, 40) : "";
    const url = httpsUrl(o.url);
    if (!label || !url) return refused(400, "Each social link needs a name and an https:// link.", A);
    socials.push({ label, url });
  }
  if (typeof body.hideFromTeens !== "boolean") return refused(400, "Choose whether teens see the links.", A);
  const before = await settings();
  const { error } = await getDb().from("community_settings").update({ discord_url: discord, social_links: socials, hide_from_teens: body.hideFromTeens, updated_by_account_id: actor.id }).eq("id", 1);
  if (error) throw new Error(`community settings failed: ${error.message}`);
  return {
    ok: true, body: await community(actor),
    event: {
      action: A, result: "Completed", target: { type: "community_settings", id: "1" },
      previous: `${before.discord_url ? "Discord" : "no Discord"}, ${before.social_links?.length ?? 0} social link(s), ${before.hide_from_teens ? "hidden from teens" : "shown to teens"}`,
      next: `${discord ? "Discord" : "no Discord"}, ${socials.length} social link(s), ${body.hideFromTeens ? "hidden from teens" : "shown to teens"}`,
      context: "The Owner changed the community links.",
    },
  };
}
