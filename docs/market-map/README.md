# Market Map (standalone, not wired into the app)

`market-map.html` is a self-contained page: competition map by niche and region, every factor per niche
(meters / gauges / 1–10), best openings with a "What fits me" panel, an industry breakdown inside vertical AI,
giant-owned niches, an idea tester, first hires and team size per niche, and a pre-seed/seed investment scale
with search, filters and how-to-invest labels (crowdfunding vs private).

It is not routed in the Next.js app. To bring it into Ascentra later, port the data arrays (`N`, `R`, `INDS`, `HIRE`, `TYPES`, `REAL`)
and render functions into a client component under `app/`.

All scores and counts are estimates (October 2026), not verified data, and not financial advice.
