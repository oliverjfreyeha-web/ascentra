# Market Map (standalone, not wired into the app)

`market-map.html` is a self-contained page: competition map by niche and region, every factor per niche
(meters / gauges / 1–10), best openings, giant-owned niches, an idea tester, and a pre-seed/seed investment scale.

It is not routed in the Next.js app. To bring it into Ascentra later, port the data arrays (`N`, `R`, `TYPES`, `REAL`)
and render functions into a client component under `app/`.

All scores and counts are estimates (October 2026), not verified data, and not financial advice.
