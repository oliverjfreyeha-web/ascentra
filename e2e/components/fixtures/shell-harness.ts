/**
 * Design rebuild D3: opens the app shell (fixtures/shell-entry.tsx) at a path, for a role, theme, glass and motion,
 * with the real stylesheets, the real pre-paint script and the Ascentra font. Shared by design-shell.spec.ts and the
 * D3 screenshots.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { build } from "esbuild";
import type { Page } from "@playwright/test";
import { prefsBootScript } from "../../../app/env/prefs";

const CSS_FILES = ["app/styles/tokens.css", "app/styles/components.css", "app/globals.css", "app/styles/polish.css", "app/styles/glass.css",
  "app/styles/design.css", "app/styles/primitives.css", "app/ui/shell/shell.css", "app/ui/backdrop/backdrop.css", "app/landing/hall/hall.css",
  "app/account/appearance.css", "app/learn/c2.css"];

export async function buildShell(): Promise<string> {
  const stubs = resolve("e2e/components/fixtures/c2-stubs.tsx");
  const out = await build({
    entryPoints: ["e2e/components/fixtures/shell-entry.tsx"], bundle: true, write: false, format: "iife", jsx: "automatic", platform: "browser",
    tsconfig: "tsconfig.json", define: { "process.env.NODE_ENV": '"production"', "process.env.VERCEL_ENV": "undefined" }, logLevel: "silent",
    loader: { ".css": "empty", ".webp": "empty", ".avif": "empty", ".png": "empty", ".jpg": "empty" },
    alias: { "@clerk/nextjs": stubs, "next/link": stubs, "next/navigation": stubs },
  });
  return out.outputFiles[0].text;
}

export type ShellOpts = {
  path?: string;
  role?: string | null;        // null: a visitor (signed out)
  saved?: Record<string, string>; // localStorage before the page loads (as a returning visitor)
  width?: number;
  reducedOs?: boolean;
  meDelayMs?: number;
};

export async function openShell(page: Page, bundle: string, o: ShellOpts = {}) {
  const { path = "/learn", role = "learner", saved = {}, width = 1280, reducedOs = false, meDelayMs = 0 } = o;
  const css = CSS_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
  const font = readFileSync("public/fonts/AscentraSemi.woff2");
  await page.setViewportSize({ width, height: width < 600 ? 844 : 900 });
  await page.emulateMedia({ reducedMotion: reducedOs ? "reduce" : "no-preference" });
  // A capable desktop (8 cores, 8 GB), so the slow-device and Lite rules don't depend on the machine running the tests.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "hardwareConcurrency", { get: () => 8 });
    Object.defineProperty(navigator, "deviceMemory", { get: () => 8 });
  });
  await page.addInitScript((s) => { for (const [k, v] of Object.entries(s)) localStorage.setItem(k, v); (window as unknown as { __clerkSignedIn: boolean }).__clerkSignedIn = true; }, saved);
  if (role === null) await page.addInitScript(() => { (window as unknown as { __clerkSignedIn: boolean }).__clerkSignedIn = false; });
  await page.route("https://ascentra.test/fonts/AscentraSemi.woff2", (r) => r.fulfill({ body: font, contentType: "font/woff2" }));
  // The Hall's pictures, from public/ (so screenshots show the real hero).
  await page.route("https://ascentra.test/art/**", (r) => {
    const file = `public${new URL(r.request().url()).pathname}`;
    try { r.fulfill({ body: readFileSync(file), contentType: file.endsWith(".avif") ? "image/avif" : file.endsWith(".png") ? "image/png" : "image/webp" }); }
    catch { r.fulfill({ status: 404, body: "" }); }
  });
  await page.route("**/api/**", async (route) => {
    const p = new URL(route.request().url()).pathname;
    const json = (status: number, b: unknown) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(b) });
    if (p === "/api/v1/me") {
      if (meDelayMs) await new Promise((r) => setTimeout(r, meDelayMs));
      if (role === null) return json(401, { error: "unauthorized" });
      return json(200, { account: { id: "00000000-0000-4000-8000-000000000009", roleKey: role, role, displayName: "Test person", email: "test@example.com", assignedCourses: [] } });
    }
    if (p === "/api/registration") return json(200, { state: role === null ? "signed_out" : "ready" });
    if (p === "/api/v1/session") return json(200, { device: { trusted: true }, heartbeatSeconds: 60, deviceLimit: 3, enforcement: {}, session: null });
    return json(404, { error: "not_found", reason: "Not in this test." });
  });
  await page.route(`https://ascentra.test${path}`, (r) => r.fulfill({ status: 200, contentType: "text/html",
    body: `<!doctype html><html lang="en"><head><title>Test</title><script>${prefsBootScript()}</script>`
      + `<script>window.__shifts=0;new PerformanceObserver(l=>{for(const e of l.getEntries())if(!e.hadRecentInput)window.__shifts+=e.value}).observe({type:"layout-shift",buffered:true})</script>`
      + `<style>:root{--font-geist:Arial,sans-serif;--font-geist-mono:ui-monospace,monospace;--font-instrument-serif:Georgia,serif}${css}</style></head><body><div id="root"></div></body></html>` }));
  await page.goto(`https://ascentra.test${path}`);
  await page.addScriptTag({ content: bundle });
}
