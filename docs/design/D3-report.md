# D3 · Backdrop, app shell and Appearance (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Design only: no changes to data, auth, billing, roles, API handlers, SQL or claim
copy. Built on the D1/D2 primitives (tokens, `Icon`, `Glass`, `Button`, `Segmented`, effects); no second system.

## D2 open items

- **Account UI for Effects and Sound:** done (step 3).
- **Iris primary button contrast, measured:** white text sits on a translucent iridescent gradient, so its contrast
  depended on what was behind the button. The first measurement in the Account preview was **below 4.5:1**:
  about 2.2–2.5:1 in the lightest pixels, 3.6–4.2:1 at the median. That early method had sampling flaws, but the
  maths agrees: the brightest gradient stop over a dark panel is under 4.5:1.
  **Fix (tokens only):** the iridescent layer now sits on a solid dark base (`--button-base: #10122e`), its stops
  are 20% less opaque, and our specular highlight is softer.
  **After the fix**, measured in Chromium over the busy preview backdrop, behind the text band, with the highlight
  forced to full strength, over five samples of the drift
  ([`shots/primary-button-contrast.json`](shots/primary-button-contrast.json)):

  | Theme / glass | Ink | Worst (2nd–98th pct.) | Median |
  |---|---|---|---|
  | Iris / Frosted | white | **5.09:1** | 5.79:1 |
  | Iris / Liquid | white | **5.69:1** | 6.32:1 |
  | Mono / Frosted | #1a1408 on champagne | **9.83:1** | 12.19:1 |
  | Mono / Liquid | #1a1408 on champagne | **9.83:1** | 12.19:1 |

  In Liquid, headless Chromium repaints the SVG backdrop filter for one frame right after a scroll. That first frame
  is left out of the numbers; check it on real hardware.

## What was built

1. **Backdrop** (`app/ui/backdrop/`; Owner decision 1): one fixed, decorative layer behind every page except admin,
   drawn in CSS:
   - **Iris:** soft orbs, rising dust, a vignette and faint floor lines.
   - **Mono:** black to graphite, no floor, and one warm-white light (white core, champagne and amber falloff,
     rays, bloom) at 68% across and 13vh down (the test checks this).
   - **Motion:** the orbs lean toward the pointer through the one page-wide listener. Reduced motion (Reduced, Off,
     the device setting or a slow device) removes drift, dust, rays and parallax. Lite mode drops dust, rays and orb
     blur.
   - **Old scenes:** the D5 wallpaper (`app/env/env-root.tsx`, `env-gl.ts`, `env.css`) and the scene hero
     (`app/landing/world/*`) are **no longer loaded, and not deleted**. `html[data-scene]` is no longer set. Saved
     scenes (`reef`, `lake`, `mist`, `sun`, `hall`, or junk) are still read without error and silently get the new
     backdrop. No `/env/` photo is fetched (tested).
   - **Slow devices:** the `data-motion-auto` and `data-reduced` upkeep that lived in the D5 wallpaper moved into
     the backdrop, with the same rule.
2. **Hall as the only home hero:** `/` renders the Hall for visitors, unchanged: sky cycle, colours and copy are the
   same in both themes (screenshots). Signed-in visitors see Home. The bug fix that lets the server's answer win when
   Clerk lags (`AuthSwitch`) is kept. `.landing__rest` moved from `world.css` to `hall.css`.
3. **App shell HUD** (`app/ui/shell/app-hud.tsx`): sticky, etched glass (`.ds-glass--hud`, a crisp inner hairline,
   no textures).
   - **Brand:** a placeholder emblem and the ASCENTRA wordmark in the Ascentra font.
   - **Tabs:** icon tabs for the same links Home's account line already gives each role:
     - every signed-in role except Guardian: Home, Learn, My path, Progress;
     - Guardians: Home and Guardian Center.
   - **Admin:** the existing `StaffNav` sits inside the HUD **unchanged** (same `isStaff` check, same "Staff" nav, same
     `/admin` link). Note: today that link shows for the **Owner and staff roles** (Super Admin, Course Admin,
     Reviewer, Support), not only the Owner, and that is kept exactly.
   - **Buttons:** Account and Appearance icon buttons.
   - **Role switch:** none, because the real app has none.
   - **Where it shows:** shell pages only (`/learn`, `/account`, `/admin`, `/guardian`, `/community`, `/pro`, `/dev`,
     and `/` once signed in). Visitor and sign-in screens keep their own layout; staff still get their Admin link there.
   - **No layout shift:** the frame renders at once and the tabs fill in when the account loads (tested).
4. **Appearance on the Account page** (the existing panel, rebuilt with `Segmented`):
   - **Theme:** Iris or Mono.
   - **Glass:** Frosted or Liquid.
   - **Motion:** Full, Reduced or Off. Reduced is stored as `simple`.
   - **Effects:** Automatic or Always full.
   - **Sound:** interface sounds On or Off, in the existing sound preference.
   - **Preview:** a small live glass preview, `inert` so it can't be focused or clicked.
   - **Plumbing:** everything writes through `app/env/prefs.ts`. The Scene option is gone (decision 1); all other
     account functionality is untouched.
   - **Earth / cobe:** the app has **no Earth setting and no globe** (only the prototype did), so there was nothing
     to replace and `cobe` was **not** added. It comes with the Profile/globe stage.
5. **Cursor glow and click spark** (`app/ui/shell/cursor-fx.tsx`):
   - **Glow:** a soft glow behind the content follows the pointer over cards and buttons only. It's placed by the
     same single pointer listener.
   - **Spark:** clicking a card or button gives eight tiny lights (transform and opacity only), at most four bursts
     at once, removed after 0.7s.
   - **When they're off:** touch, keyboard clicks, and whenever `data-reduced="1"` (Reduced, Off, the device setting
     or a slow device).
6. **Phones (560px and below):**
   - **HUD:** the emblem only, icon-only tabs (names kept for screen readers), and a tighter rim.
   - **Overflow:** none on `/learn`, `/account` and `/` at 390px (tested).
   - **Hall:** its words sit over its existing dark scrim.

## Screenshots (`docs/design/shots/`)

Rendered in Chromium from the real components and stylesheets (the app server can't start here: no secrets):

- **Appearance** (Account), at 390 and 1280, both themes, both glass types (8):
  `account-appearance-{iris|mono}-{frost|liquid}-{1280|390}.jpg`
- **Visitor landing (the Hall)**, both themes, 390 and 1280. The Hall keeps its colours in Mono:
  `landing-hall-visitor-{iris|mono}-{1280|390}.jpg`
- **HUD and backdrop** on `/learn`, signed in as Owner (shows the Admin link), Iris floor and Mono light:
  `learn-hud-backdrop-{iris|mono}-{1280|390}.jpg`
- **Regenerate:** `DESIGN_SHOTS=1 npx playwright test -c playwright.components.config.ts design-shots` (skipped
  otherwise, so CI never runs it).

## Tests and checks

- **New Chromium spec** `e2e/components/design-shell.spec.ts` (15 tests; stable over repeated runs), checking:
  - tabs per role (Learner, Guardian, Owner, where the Admin link sits in the HUD, unchanged);
  - visitor landing shows the Hall and no HUD; signed-in Home shows the HUD; no HUD on sign-in;
  - backdrop: Iris floor, Mono light at 68% / 13vh, still under Reduced;
  - old saved scenes load cleanly with no scene photo;
  - 390px: no overflow on three pages, and the Hall fits;
  - Appearance writes through the preferences module (Reduced is stored as `simple`; sound goes to the sound
    preference; no Scene control);
  - glow and spark only on buttons and cards, off under Reduced;
  - the HUD and heading don't move while the account loads.
  The harness pins an 8-core, 8 GB device, so slow-device and Lite rules don't depend on the machine.
- **Updated tests:**
  - `tests/unit/env-prefs.test.ts`: no `data-scene`, plus a D3 test that browsers saved before D1 (any scene, even
    the Hall or junk) load cleanly.
  - `e2e/components/owner-nav.spec.ts`: its browser bundle now defines `process.env.VERCEL_ENV`, because Home now
    includes the Hall, a server component that reads it. The tests themselves are unchanged.
- **Results:**
  - lint ✔
  - typecheck ✔
  - unit tests 59 files, 4240 passing ✔
  - build ✔
  - component tests 132 passing (17 screenshot tests skipped) ✔
  - check:bundle ✔
  - check:build-secrets not run (needs real secrets)

## Failures and fixes (one attempt each)

- **owner-nav component tests:** 4 failed because Home now renders the Hall, a server component that reads
  `process.env.VERCEL_ENV`, which the test's browser bundle didn't define. Fixed in the test's bundle config; all 9
  pass.
- **Final typecheck and build:** both failed on one typing error in the new preferences test (indexing with a
  string). Fixed with a type annotation; both pass.

## Files

- **New:**
  - `app/ui/backdrop/{backdrop.tsx,backdrop.css}`
  - `app/ui/shell/{app-hud.tsx,cursor-fx.tsx,shell.css}`
  - `app/account/appearance.css`
  - `e2e/components/{design-shell,design-shots}.spec.ts`
  - `e2e/components/fixtures/{shell-entry.tsx,shell-harness.ts}`
  - `docs/design/shots/*`
- **Changed:**
  - `app/layout.tsx`: Backdrop, CursorFx and AppHud replace EnvRoot and StaffNav (StaffNav now renders inside the HUD).
  - `app/page.tsx`: the Hall only.
  - `app/env/prefs.ts`: `data-scene` is no longer set.
  - `app/account/appearance-panel.tsx`
  - `app/ui/spotlight.tsx`: parallax and glow.
  - `app/styles/tokens.css`: button base, gentler iridescence.
  - `app/styles/primitives.css`: the primary button's base layer, softer specular.
  - `app/landing/hall/hall.css`: `.landing__rest`.
  - The two tests above.

## Noted for later stages

- The existing D5 panels (`.ui-block`, `.ui-panel`) keep their dark-blue glass shade in Mono, because their colour
  is hard-coded in `glass.css`. Moving them onto the theme tokens belongs to the page restyle stages.
- `ui-page-in` (the D3-era page entrance) still follows only the device setting, not Motion Reduced/Off.
- Nothing in product UI now points to the world hero's scene picker (`WorldDock`) or `HallSlot`; they remain in
  `app/landing/world/world-controls.tsx` until the scene code is deleted.
