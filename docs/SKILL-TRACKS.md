# Skill tracks (S1)

A **skill** (a topic of kind `skill`) is learned as one **track**: **3 Rounds × 5 sections**. Rounds 2 and 3 go over the
same 5 sections again, harder. Businesses and side hustles are unchanged: they keep modules, size tiers, rank gates and
the capstone.

A track has **no size tier, module count, rank gates or capstone**. Finishing a Round shows **"Round complete"**, never
"Course complete".

## Where things are

| What | Where |
|---|---|
| Every number below (Rounds, sections, multipliers, plan access) | `lib/progress/config.ts` (the one config file) |
| The unlock and access rules (pure) | `lib/progress/tracks.ts`, tested in `tests/unit/tracks.test.ts` |
| A learner's track and library | `lib/progress/track-view.ts`; `GET /api/v1/learn/tracks/{slug}` and `/library` |
| Learner pages | `/learn/track/{slug}` (track view) and `/learn/track/{slug}/library` (library view) |
| The import format (version 2) | [COURSE-IMPORT.md](COURSE-IMPORT.md#format-version-2-a-skill-track) |
| The database change | `db/migrations/0023_skill_tracks.sql` (SQL Editor bundle `db/apply/S1.sql`) |

## The data model, and why

A track is stored in the **same tables as every course**. Nothing is duplicated, and there are no parallel tables:

- `courses.is_track` (true for a track; a track never has a `size_tier`).
- `modules.round` (1 to 3). **A section is a module row.** Round *r*'s sections sit at positions 5(*r*−1)+1 to 5*r*.
- Round labels, goals and section difficulties are kept in the approved import record (`academy_blueprints.plan`).

This is the smallest change that keeps everything else working:

- lessons, items, video slots, attempts, the Notebook, streaks, labels, review and approval all already work per module;
- a published version is never edited (a new Draft version is made, as for any course);
- courses without a track keep exactly their current behavior (`is_track` is false and `round` is empty).

## Progression (STARTER numbers, all in `lib/progress/config.ts`)

| Setting | Value |
|---|---|
| `TRACK_ROUNDS` | 3 |
| `SECTIONS_PER_ROUND` | 5 (the importer refuses any other count) |
| `ROUND_MULTIPLIER` | Round 1 ×1, Round 2 ×1.5, Round 3 ×2 |
| `ROUNDS_BY_PLAN` | no plan 0, trial 1 (half of it, below), Basic 2, Pro 3 |
| `ROUND_PLANS` (for the locked labels) | Round 1: every plan and the free trial; Round 2: Basic and Pro; Round 3: Pro |
| Item points (unchanged, from C2) | Should know 1, Important 2, Very important 3 |

**Unlock rules:**

- Round 1 section 1 is open.
- Within a Round, the C2 half-open rule applies between sections. When half of section *k* is done, the first half of
  section *k*+1 opens (rounded up). When all of section *k* is done, all of section *k*+1 opens.
- Round *r*+1 opens when every item of Round *r* is done.

**Points:** each item earns its points once per Round: item points × the Round's multiplier. Each Round has its own items
(their own rows), so an item can't earn twice.

Points are stored as whole numbers. Each item's points are rounded to the nearest whole number, with halves rounding up,
and are never below the item's base points (`trackPoints` in `lib/progress/tracks.ts`):

| Item | Round 1 (×1) | Round 2 (×1.5) | Round 3 (×2) |
|---|---|---|---|
| Should know (1) | 1 | 2 (1.5 rounds up) | 2 |
| Important (2) | 2 | 3 | 4 |
| Very important (3) | 3 | 5 (4.5 rounds up) | 6 |

**Plan access:**

- **Free trial:** the first half of Round 1's items, in order, rounded up. The rest is labelled "The rest of Round 1 is
  part of Basic and Pro."
- **Basic:** Rounds 1 and 2. Round 3 is labelled "Round 3 is part of Pro."
- **Pro:** all 3 Rounds.
- Progress is kept when the plan changes: done items stay done, and a Round the new plan doesn't include is only locked.
- There is no module-3 trial bonus for skills.

**Unchanged:** the streak, the Notebook, importance labels, the leaderboard and the teen rules.

## Effect on rank pace (estimate)

The rank thresholds are the C2 STARTER values: for example Operator 45, Architect 135 and Ascendant 260.

Take a typical section: 5 items averaging about 2 points, so about 10 points. A Round of 5 sections is then about 50
points before the multiplier. Rounding halves up adds a little in Round 2 (Should know and Very important items gain
half a point each), so Round 2 is about 75 to 85 points.

| Done | Points (about) | Rank reached |
|---|---|---|
| Round 1 (×1) | 50 | Operator (45) |
| Rounds 1 and 2 (×1.5) | 50 + about 80 = about 130 | Closer (100), just short of Architect (135) |
| All 3 Rounds (×2) | 130 + 100 = about 230 | FINAL FOUNDER (220), short of Ascendant (260) |

So one whole skill track reaches rank 9 of 10, about the same as one Standard business course (about 160 points plus 40
for the capstone, about 200). The top rank needs more than one track or course. To change the pace, edit
`ROUND_MULTIPLIER` in the config. No other change is needed.

## Learner views

- **Track view** (`/learn/track/{slug}`):
  - Pick a Round, then see its 5 sections.
  - Each step shows the short lesson, then its tasks.
  - Shows the Round's progress (done of total).
  - A locked Round or section says exactly why, including which plan includes it.
- **Library view** (`/learn/track/{slug}/library`):
  - Every unlocked lesson, by Round and section. Searchable and read-only.
  - Locked lesson text is never sent to the browser.
- Practice spaces are labelled "Practice (simulated)", as everywhere else.

## Owner admin

- **Course editor:** a track shows its Rounds and sections. The size picker and adding, removing or reordering sections are
  replaced by a note: a Round's sections come from importing that Round.
- **Review checklist:** sections are listed as "Round *r* · Section *k*". Approval is still per section. Each Round shows
  its status: Draft, Review or Published.
- **/admin/topics:** skill rows show "Track (3 Rounds)" instead of the size picker. A track is made by importing it.
- **Publish:** every present Round needs its 5 sections, and Round *r* needs Round *r*−1.
- **A new version** (from an import or "new version") copies the earlier sections as Drafts. The Owner approves them again.
