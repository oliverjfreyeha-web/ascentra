# ASCENTRA design system (spec distilled from the approved prototype)

Mood: calm, premium, futuristic, glassy. Not cartoon, not AI-template, not bland. Quality bar: a polished product site.
Principles: depth through layers, light that comes from one place, motion that is soft and never on hover for HUDs,
nothing decorative that costs readability.

## Themes (set data-theme on the app root)
### Iris (default)
bg #080813, surface-1 #0F0F24, surface-2 #16162E, ink #F4F7FC, muted #B7C1D4, frost accent #A0BDDB, ok #7FD1A6, gold #F7C948 / #FFE08A,
violet #7B7FFF, cyan #59C5E8, purple #B07CFF, mint #34D399. Section cards cycle 5 accents (nth-child).
Background: scene of soft orbs, dust, vignette, faint perspective floor lines. Hall photo behind the home hero.
### Mono
Black to graphite (#050506 -> #2a2b30 gradient wall), ink #F4F7FC, one very bright warm-white light source at top right (~68% across, 13vh down):
white core, champagne/amber falloff, soft rays, bloom. No floor, no shards, no ghost lights. Panels graphite, rims warm-white.
Buttons that are NOT glass (toggle selected, icon buttons, Continue, rating buttons) use a warm champagne/amber gradient.
Widget accents are warm only in Mono: streak ember #FF9A4D, points gold #F3C76B, rank silver #DDE2EA, next reward amber #FFC28A.
Iris widget accents are cool: #9DB4FF, #BBA2FF, #A6DCFF, #9FB0FF.
The hall photo is NEVER recolored.

## Typography
- Headings and big numbers: "Ascentra Display" (original, caps-only, squircle forms). Letter-spacing ~.06-.08em on small caps labels.
- Body: system UI stack. Mono: ui-monospace stack. No Google Fonts, no third-party fonts.
- Headings are solid color (no gradient text). No small kicker line above h1.
- Minimum body contrast 4.5:1 (muted labels are #C3CCDD or lighter on glass).

## Glass (the signature)
Every panel uses class `g`. Shape: radius 20-30px, 1.25px rim made from a conic gradient that follows the pointer angle, inner highlights.
### Frosted
background linear-gradient(150deg, rgba(96,104,190,.46), rgba(30,32,78,.52)) (Mono: rgba(90,92,100,.46) -> rgba(18,18,21,.62)),
backdrop blur 40px (HUD/popovers) or 22px (other panels) + saturate 160%.
Shadows: inset 0 1.5px 0 rgba(255,255,255,.65); inset 1.5px 0 0 rgba(255,255,255,.2); inset 0 30px 50px -28px rgba(255,255,255,.26);
inset 0 -40px 60px -32px rgba(140,130,255,.34); outer 0 34px 60px -26px rgba(4,4,36,.8).
Gloss layer (::after): diagonal reflection, cool top wash, pointer spotlight, and a slow gloss sweep (see Motion).
### Liquid (Chromium only)
Light tint (about 10% white), light backdrop blur (about 5px, applied BEFORE the lens), then an SVG displacement lens so the edges of
whatever is behind the panel bend (convex bezel ~26px, scale ~32, three channels at 1 / .96 / .92 for slight dispersion), then saturate 1.5, brightness 1.08.
Crisp bright rim and top highlight. It must look like refracting glass, not tinted glass and not frosted glass.
The lens is attached to EVERY glass panel while Liquid is on and removed completely when Frosted is on.
Non-Chromium browsers: blur(9px) saturate(170%) fallback.
### Budgets
Blur is expensive. Keep it on the nav, popovers, and large panels only where it reads. Phones and low-power devices drop to Frosted/Lite automatically.

## Buttons
- Glass buttons use the panel recipe.
- Non-glass buttons: Iris = slow iridescent gradient (blue, violet, teal, pink, 5-9s loop, faster on hover); Mono = warm champagne/amber.
- Selected segmented control = pearl/champagne gradient with dark text.
- Press = scale .965, 120ms, springy. No lift or tilt on hover for HUD panels.

## Icons
Original 24px icon set (Icons.jsx): layers f (tint fill), l (main line), a (accent), gradient strokes. Draw-in on mount, subtle hover animations
(sway, pulse, spin) that are stronger than "barely visible". Never an emoji. Icon tiles are dark glass with accent glow.

## Motion
Easing: cubic-bezier(.16,1,.3,1) (no bounce/elastic). Durations: press 120ms, hover 200ms, entrances 700-900ms.
- Pages arrive in a staggered rise (translateY 26px, scale .965 -> 1), nav drops in.
- Glass gloss sweep: runs on a slow idle loop on HUD panels, faster on hover/focus. Panel itself does not move.
- Icons animate on hover of their parent control. Big numbers pulse a soft glow. Active tab pulses.
- Course tree: branch lines draw in, nodes pop in staggered, current node pulses ring.
- Sparkline draws in. Activity grid cells scale on hover.
- Scene: slow orb drift, dust, pointer parallax (small). Click spark burst on cards/buttons.
Reduced motion: `data-reduced=1` stops all of it; OS `prefers-reduced-motion` forces it.
Animate only transform and opacity (and gradient position via @property). Never animate width/height/top/left.

## Sound (opt-in, off by default for new users is acceptable)
Web Audio only, no files. Soft keyboard-style clicks (filtered noise burst + short sine thock, tiny random jitter, master gain .16).
Reward sound only when a reward is claimed. Never autoplay. Separate from motion setting.

## Components (names from the prototype)
Hud (nav), Stats strip, SectionCard, CourseCard (cover tile + title + progress), Review deck (flip card, rating Again/Good/Easy,
next-7-days bars, weak spots), Widget grid (Progress globe, Streak, Points, All-time rank, Next reward, Achievements, Activity,
Recent activity, Course map), ActivityGrid, CourseTree, Admin tiles, Account Appearance settings, popovers, segmented control.
### Activity grid (Week / Month / Year)
Colors: rest = light neutral, missed = red (#FF5A62), short = orange (#FF9F43), steady = light green (#9BE8AE), focused = green (#3DBE63),
grind = deep green (#17803A). Today = white ring. Legend always visible. Every cell has an aria-label (date + minutes + level). Hover shows a line of text.
### Course tree
One branch per course off a "You" node, nodes = sections. States: done (filled + check), now (glow + pulse), up next, locked (dim, dashed). Node = button.

## Accessibility
Focus ring 2px frost, visible on glass. All controls keyboard reachable. Contrast >= 4.5:1 for text (scan on screenshots).
`lang="en"` on html. Color is never the only signal (labels, icons, aria-labels). Heavy 3D and Liquid are optional upgrades with static fallbacks.

## Bans (from the craft review)
Gradient text, hard offset shadows, bounce easing, glass as pure decoration, same-size icon+heading card grids with no hierarchy,
progress rings as the main progress display, texture overlays on HUD panels (tried, rejected by the Owner), floor/shards in Mono.
