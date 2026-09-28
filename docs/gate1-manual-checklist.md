# Gate 1 · manual checklist (what only a person can do)

About 15 minutes. You need the Owner's devices, and the Support Admin's second Gmail account.

1. **Support Admin adds a second factor.** Signed in as the Support Admin (second Gmail) at
   <https://ascentra-omega.vercel.app/account>, add an **authenticator app** under Sign-in methods. Sign out, then sign in
   again with password and code. The home page should say "Signed in as … (Support Admin)".
2. **Support Admin is refused at /admin.** Still as the Support Admin, open `/admin`: it must say
   *"Only the Owner can do this. Support Admin can't."* Open `/admin/audit`: refused too. `/admin/security` opens.
3. **Owner replaces a device.** With your three browsers already trusted (PC, Incognito, phone), open a
   **new** Incognito window (or another browser) and sign in as the Owner. You should see
   *"Replace a trusted device?"*. Pick one, enter your authenticator code, and the home page opens.
4. **Owner's audit view shows those events.** As the Owner, open `/admin/audit` and search the Action field for, in turn:
   `admins.activate` (the Support Admin's role going live), `admins.view` (the Support Admin's refusal, result Blocked),
   `devices.replace` (step 3). Each one should be there, with its device.
5. **Owner verifies the chain.** On the same page, click **Verify the chain now**: it must say *Intact*.
6. **Retry a passkey.** As the Owner at `/account` → Sign-in methods → Passkeys → Add. If Clerk says
   *"There are too many unverified contacts for this user"*, wait about 10 minutes and try once more.
   Then sign out and sign in with **Sign in with a passkey**.
7. **After a live smoke run**, search `/admin/audit` Actor for `TEST ASCENTRA smoke`: the test learners'
   events are there and clearly marked; nothing names you.
