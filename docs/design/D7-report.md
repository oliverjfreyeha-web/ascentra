# D7 · Checks, then fixes (design rebuild)

Branch `claude/eloquent-euler-zqi2hs`. Checks first, then only what they found was fixed, one attempt each.

- **Nothing else changed:** no behaviour, permission, data, legal or safety copy, or label (Demo, Sandbox, Simulated,
  Disconnected) changed.
- **Reused harness:** the checks extend the existing one (`shell-harness.ts`, `design-routes.spec.ts`,
  `d6-routes.test.ts`, the `DESIGN_SHOTS=1` specs). The route list moved into one shared fixture
  (`e2e/components/fixtures/routes.ts`) and now also covers the D4 and D5 pages: 33 routes in all.

## Results

| # | Check | Result | Fixed? |
|---|---|---|---|
| 1 | Detector: gradient text | None found | Nothing to fix |
| 1 | Detector: bounce easing | `--ease-spring` overshot (`cubic-bezier(0.34, 1.56, 0.64, 1)`), used by checkboxes, radios, the sound toggle and the answer tick. Five icon hover keyframes undershot or swung past rest. | **Fixed** |
| 1 | Detector: hover movement on HUD panels | None (the HUD's position and transform stay the same under hover, tested) | Nothing to fix |
| 1 | Detector: purple-on-white | None | Nothing to fix |
| 1 | Detector: side-stripe borders | 2 seen live (`.c2-notice`, `.ui-act__doc`); 8 more in shared CSS (see below) | **Fixed** on restyled pages |
| 2 | axe (WCAG 2.0–2.2 A/AA plus best practice), 33 routes × 2 themes × 2 glass types | 1 serious rule: `target-size` on text-link buttons (sign-in "Use your password", welcome). No critical, moderate or minor findings. | **Fixed** (link buttons at least 24px tall) |
| 3 | Contrast from screenshots (glyph pixels only), 33 routes × 2 themes × 2 glass types | **Before:** 51 low samples in Iris and 54 in Mono (Frosted). **After:** 0 of 1,534 samples are below 4.5:1 (body) or 3:1 (large). | **Fixed** (see below) |
| 3 | Iris primary button on every page that has one (13 pages) | Lowest 6.17:1 (Iris Liquid) and 6.2:1 (Iris Frosted). Mono's dark ink: 8.8:1 or better. | Already passing |
| 4 | Only transform, opacity and gradient position animate | One real exception: the course progress fill animated `width` | **Fixed** (`transform: scaleX`). Remaining exceptions listed below. |
| 4 | Motion Reduced and Off stop everything | Under Off, still moving: meter fills, loading shimmer, and Home's lower sections and their reveals | **Fixed**. Backdrop, sparks, glow, globe and counters were already still (now tested). |
| 4 | Liquid detaches fully when switched to Frosted | Yes: no `data-lens`, no inline `--lg` and no lens filters left, on the real Account page | Nothing to fix (now tested) |
| 4 | Layout thrash | None: about one layout per pointer frame (Chrome's layout counter, 40 moves over glass). Some pages shift once when their data arrives (below). | Nothing to fix (reported) |
| 4 | Most expensive blurs | Backdrop orbs `blur(70px)` (Mono 80px) on ~630k, 410k and 317k-pixel layers that drift; frosted panels `blur(22px)` | **Reduced**: orbs to 36px, panels to 16px. Same look (below). |
| 5 | No sideways scroll at 390px and 768px, all 33 routes | None | Nothing to fix (768px now tested) |
| 6 | Theme switch on the Profile: globe colours | The globe kept the old theme's colours | **Fixed** (recolours at once, also while still; tested) |
| 7 | Dead code from the prototype port | `.ds-rise`, `.ds-drop` (and its keyframes) and the `.ds-hover` hook: nothing used them. No dead TypeScript (every flagged export is used in its own file). | **Removed**. Old scene code and `design-reference/` untouched. |
| 7 | No gradient text, no bounce, no HUD hover movement | Confirmed by the detector and a unit test | Done |
| 8 | Unrestyled leftovers listed | `/admin/style-guide`, `/dev/course-ui` and Clerk's own forms are in the D6 table and enforced by `d6-routes.test.ts`. Not restyled. | Confirmed |

## Details

### 1 · Detector

- **No detector installed:** the repo has no "impeccable" detector (no script, no package), and adding one would need
  the network.
- **Offline equivalent:** it runs in Chromium on computed styles across all 33 routes in both themes (in
  `design-routes.spec.ts`). It catches gradient text, side stripes (a thicker left or right border, or an inset side
  shadow), overshooting easing on any transition or animation, and purple text on a light background. It also hovers
  every HUD control and checks that the HUD doesn't move.
- **It can fail:** a positive-control test plants each pattern and expects all five to be reported.
- **Before** (the D6 commit): bounce easing on checkbox and radio inputs and the sound toggle, plus side stripes on
  `p.c2-notice` and `blockquote.ui-act__doc`.
- **After:** nothing in either theme.
- **Fixes:**
  - `--ease-spring` is now the glide curve (no overshoot).
  - Icon hover keyframes (pop, flap, sway, swing, jolt) go out and back once.
  - On restyled pages, every side stripe is a full border or a tint in the same colour: notes, the overlap note,
    practice quotes and source documents, graded activities (their solid frame and filled chip still say "graded"),
    state messages, table error rows, the targeted source, and toasts.
- **Static checks:** `tests/unit/d7-checks.test.ts` checks there's no overshooting `cubic-bezier`, no gradient text,
  and that the keyframe shapes stay as fixed.

### 2 · Accessibility

- **Coverage:** axe on every restyled route in both themes and both glass types (four permanent tests, about 7 minutes
  in all).
- **Result:** the only issue was the WCAG 2.2 `target-size` rule on small text-link buttons. They're now at least 24px
  tall, with no change to how they read.
- **Colour contrast:** axe can't judge text over glass and blur, so item 3 measures it from screenshots.

### 3 · Contrast

**Method** (`e2e/components/d7-contrast.spec.ts`, results in `shots/d7-contrast-{theme}-{glass}.json`):

- Each sampled text element is captured with and without its text. Only the pixels the glyphs cover count, and the
  ink is compared with the lightest and darkest background under them (2nd and 98th percentile).
- Samples are deduplicated by colour, size, weight and surface: 361–403 per combination. Disabled controls are left
  out (exempt).
- A text halo stays in the capture, so it counts as the background, as WCAG allows.
- A first pass measured the whole box (corners and borders included) and over-reported; it was replaced by this one.

**What failed:**

1. **Iris:** muted text on the brightest glass, where an orb shows through: Up next, the widget titles, the
   Appearance preview.
2. **Both themes:** the muted breadcrumbs (about 4.1–4.2:1) and an Iris HUD tab at 4.49:1.
3. **Mono:** page titles and HUD text sit in front of the warm-white light, at 68% across and 13vh down. Lowest 1.35:1.
4. **Liquid:** the Appearance preview's sample text over its busy sample backdrop.

**Fixes (tokens and scoped rules):**

- **Glass:**
  - a slightly darker glass fill;
  - a softer top wash and top-left reflection, which sat behind labels;
  - a brighter muted ink for text on glass and in the HUD (`--glass-ink-muted`).
- **Breadcrumbs:** use the brighter muted ink.
- **Mono halo:** a dark halo behind page-level text and HUD text. Buttons and fields keep their own ink, and the active
  tab is left out.
- **Appearance preview:** full ink with a shadow for its sample text, and its sample stripes at half strength (still
  busy enough to show the blur and the bend).

**Result:** 0 samples below threshold in Iris Frosted, Iris Liquid, Mono Frosted and Mono Liquid.

### 4 · Motion and performance

**What animates, by property:**

- **transform and opacity:**
  - entrance, stagger and reveals;
  - backdrop drift, dust, rays and the breathing light;
  - sparks;
  - the HUD tab pulse;
  - menus and toasts;
  - icon hovers;
  - the globe's poster;
  - meters and the course progress fill (now).
- **Gradient position:** the iridescent primary (`background-position`), the gloss sweep (`--ds-gl`), the loading
  shimmer and the glass sheen.

**Exceptions, each paint only (no layout):**

| What | Property | Why |
|---|---|---|
| Path and icon draw-in (`ds-draw`, `ds-ic-draw`) and the course ring | `stroke-dashoffset` | The only way to draw an SVG line in |
| Link underline draw-in | `background-size` of a gradient | The underline is a gradient |
| Glass rim turning toward the pointer | `--ds-ang` (a gradient angle) | A gradient property |
| Toast entrance | `filter: blur(2px)` with opacity | A 2px blur on a small box, once |
| Hover and focus feedback | `color`, `background-color`, `border-color`, `box-shadow` | State changes over 120–200ms, not animation; they stay under Reduced and Off |
| Style guide's demo dot (`sg-travel`) | `left` | Internal `/admin/style-guide`, which isn't restyled (item 8) |

**Reduced and Off:**

- One rule stops every animation, and every position or fade transition, inside restyled pages.
- With Home's reveals, this also covers the meter fills and the loading shimmer that still ran.
- A new test on six pages, for both levels, checks there are no running animations or transitions, no glow, no spark,
  no backdrop lean, a globe whose pixels don't change, and counters that show their final number at once.

**Layout:**

- **Pointer listener:** the one listener stays at about one layout per frame. A read-then-write rewrite measured the
  same and was not kept.
- **Content-arrival shifts:** some pages shift once when their data arrives. Highest layout-shift scores: Home signed in
  0.65 (the page under the HUD), Sources 0.27, Account 0.24, Audit 0.21; most others under 0.1.
- **Reported, not fixed:** fixing them means reserving space for content that may not come, which changes layout and
  behaviour.

**Blur cost (Frosted, 1280px):**

- **Biggest by blur × area:**
  - the backdrop orbs (70px over 630k, 410k and 317k pixels, drifting);
  - Library cards and Profile widgets (22px, up to 614k);
  - the HUD (40px, 68k);
  - sign-in card (26px, 168k).
- **Orbs:** now 36px. They're already soft gradients; against 70px the difference is 1 level out of 255 on average
  (8 at most).
- **Frosted panels:** now 16px. Against 22px the difference is 0.07 levels on average (1 at the 99th percentile),
  because the backdrop behind is smooth.
- **Kept:** the HUD and the sign-in card blur are unchanged (smaller areas, and the look depends on them).

### 6 · Globe

- **Fix:** the globe watches `data-theme` and passes the new colours to cobe's `update`, which redraws at once, also
  while motion is off. The observer is removed on unmount.
- **Test:** with motion off, the globe is cool in Iris, warm after switching to Mono, and the same again after switching
  back. Without the fix, the warm check fails.

## Tests and checks

- **New:**
  - `tests/unit/d7-checks.test.ts` (8 tests);
  - `e2e/components/d7-contrast.spec.ts` (screenshot-only, `DESIGN_SHOTS=1`, about 12 minutes);
  - `e2e/components/fixtures/routes.ts`.
- **Extended:**
  - `design-routes.spec.ts`: axe in 4 theme and glass combinations, the detector in 2 themes plus its positive control,
    768px, Reduced and Off stopping everything, and Liquid detaching;
  - `design-profile.spec.ts`: the globe on a theme switch;
  - `d6-routes.test.ts`: the scoping check allows the Mono halo rule.
- **Updated:** `design-primitives.spec.ts` pinned the old 22px panel blur; it now expects 16px.
- **Results:**
  - lint ✔
  - typecheck ✔
  - unit tests 63 files, 4271 passing ✔
  - build ✔
  - check:bundle ✔
  - component tests 168 passing (76 screenshot-only tests skipped) ✔
  - check:build-secrets not run (needs real secrets)

## Failures and fixes (one attempt each)

- **My own regression:** the first Mono halo also darkened the active HUD tab, which has dark ink on champagne. It now
  skips that tab.
- **Test-side:**
  - the detector first timed out by hovering every HUD control on every route (now four representative routes);
  - the first contrast pass measured whole boxes (replaced by the glyph-only method);
  - the globe test first compared bytes that included the backdrop (now only the canvas's own pixels, with a
    tolerance for rendering noise);
  - one contrast run hit its time limit with four runs sharing the CPU (limit raised).
