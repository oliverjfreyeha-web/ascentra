# Items for counsel review

A running list of questions for a lawyer before launch. Nothing on the site claims attorney approval.

## Images and media
- D4 · The Hall and firefly images (AI-generated with Higgsfield): Higgsfield's commercial-use terms, and any duty to label AI-generated images (see `docs/ASSETS.md`).
- D5 · The four wallpaper images (reef, alpine lake, misty peak, sunrise): their provenance and commercial-use rights. They were provided by the Owner; the original source and license are not confirmed.
- D5 · Whether any of the four wallpapers is AI-generated, and if so how it must be labelled on the site and on `/credits`.

## Safety
- D4 / D5 · Photosensitivity risk for teen users (ages 14 to 17): the moving wallpaper, glints, window lights and fireflies. Current limits: nothing flashes more than 3 times a second, glints repeat no faster than every 6 seconds, and all motion stops with the device's reduced-motion setting or Motion "Off".

## Statements
- D5 · Any user-facing statements about performance or motion, for example "Motion is simplified on this device" in the Appearance panel and the Motion setting descriptions.

## Choose your path (L8)
- L8 · Business topics, side hustles, e-commerce and Amazon topics: confirm they carry no income, earnings or results claims. The site shows "Results vary. Nothing here promises income." on every screen that lists topics, and the topics admin refuses wording like "guaranteed", "passive income" or a dollar amount. Counsel to confirm the wording and whether more disclaimers are needed.
- L8 · Amazon (FBA), Shopify and online marketplaces have their own age rules and adult requirements for seller accounts. Amazon FBA, online reselling and flipping, and dropshipping are hidden from teens (14 to 17). Shopify stores and print on demand are shown to teens: counsel to confirm that is right, or whether they should also be hidden or carry an adult-account note.
- L8 · Affiliate marketing needs disclosure language (for example FTC endorsement rules) wherever it is taught. It is hidden from teens for now; counsel to supply the disclosure wording before a course is published.
- L8 · Teen visibility: five businesses are hidden from teens (online coaching and consulting, Amazon FBA, dropshipping, online reselling and flipping, affiliate marketing). Counsel to confirm this list, and the rule that a teen never sees or picks a hidden topic (the Owner can't assign one either).
- L8 · Whether a Guardian's Privacy Center download of a teen's data should include the teen's five answers and picks. For now it does not (the same rule as the L7 interview).

## Sign-up and sign-in (R1)
- R1 · Second factor is optional for learners and required for Owner, admins and Guardians. Learners (adults and teens 14 to 17) are now allowed in with a password alone; the app recommends an authenticator app on the Account page and once on the learner home, and never requires it. Counsel to confirm this is acceptable, in particular for teen accounts.
- R1 · Sign-up order is now: account → date of birth and US residence → the "Choose your path" questions and picks → plan and 14-day trial. The interview answers are collected before any plan or payment. Counsel to confirm nothing in the Automatic Renewal Terms or the privacy notices needs to change for this order.

## Course structure, videos and the Owner's review (C1)
- C1 · No income claims, enforced automatically. Every course version is checked for text that reads as a promise of income, earnings, profit or results (for example "earn $5,000 a month", "passive income", "guaranteed results", "quit your job", "six figures"), in lesson text, practice items, video briefs and transcripts. A lesson with any of these can't go to review, a module with any can't be approved, and the check shows the exact words and where they are. A price for a service ("charge $500 a month for the retainer") is not treated as a claim. Counsel to confirm the list of patterns (`lib/courses/income.ts`) and whether anything else should be blocked.
- C1 · "Reviewed by the Owner on {date}" appears under a lesson only when the database holds the Owner's recorded approval of that exact version (insert-only `module_reviews`, also in the audit log). Otherwise the lesson says "Reviewed by an ASCENTRA reviewer" (a Reviewer verified it) or nothing. Counsel to confirm the wording, and that neither label implies legal, professional or attorney review.
- C1 · Course videos are made and uploaded by the Owner; the app never generates video. Each video needs a transcript or captions before the Owner can approve it, and learners can read the transcript instead of watching. Counsel to confirm whether a full transcript is enough for accessibility law (for example ADA or WCAG captions), or whether timed captions are needed before launch.
- C1 · Practice spaces ("sandboxes") are simulated and labelled "Practice (simulated)": made-up data only, never a live service, account or real person's data. Counsel to confirm the label is clear enough, including for teens.
- C1 · Videos are stored privately and learners get links that work for ten minutes, only for a course they may open (teen-hidden and unpublished rules apply). Counsel to confirm nothing else is needed for teen learners watching videos that may show the Owner's face or voice.
