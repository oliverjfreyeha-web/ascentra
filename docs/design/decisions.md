# Design decisions

Owner decisions on the D0 questions (`docs/design/D0-audit.md` §7), recorded word for word at the start of D1.

1. Iris/Mono REPLACE the five scenes (Reef, Lake, Mist, Sunrise, Hall). The Hall photo stays only as the home hero, as in the prototype. Keep the scene WebGL code in the repo, unloaded. Do not delete it yet and do not remove data-scene yet (that happens in D3).
2. Headings, big numbers and small-caps labels use the Ascentra font. Body text stays Geist (self-hosted).
3. Default glass is Frosted. Liquid is an option in Account.
4. The middle motion level is shown to people as "Reduced". The stored value stays "simple" so saved preferences need no migration.
5. Licences: use cobe for the globe (no textures). Drop the prototype CountUp and use the app's own. Write our own Aurora and SpecularButton effects; do not copy the prototype code for those.
6. Tilt: no tilt on the HUD and widgets. Only a small tilt (7 to 9 degrees) on clickable tiles and section cards, off when motion is Reduced or Off.
7. Demo-only widgets (trophies, coins, badges, Next reward, positional rank, Review deck) stay HIDDEN until real data exists. Show the real rank tier and leaderboard instead.
8. Activity grid uses points per day (real data). Extending the API from 30 to 365 days is a later stage (D5), not now.
