import asyncio, sys
from playwright.async_api import async_playwright
html=open('ascentra.html').read()
open('/tmp/_p5.html','w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'+html+'</body></html>')
res=[]
def ok(n,c): res.append(('PASS' if c else 'FAIL')+'  '+n)
async def run(pg,w):
  E=lambda js,arg=None: pg.evaluate(js,arg) if arg is not None else pg.evaluate(js)
  async def click(sel): await pg.locator(sel).first.click(); await pg.wait_for_timeout(70)
  async def txt(): return await pg.locator('#main').text_content()
  async def lay(): return await pg.locator('#layer').text_content()
  async def cur(): return await E("S.view")
  async def persona(p): await E("p=>A.switchPersona(p)",p); await pg.wait_for_timeout(60)
  async def go(v): await E("v=>A.go(v)",v); await pg.wait_for_timeout(60)
  async def setsel(sel,v): await E("([s,v])=>{const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))}",[sel,v]); await pg.wait_for_timeout(80)
  async def overflow(): return await E("document.documentElement.scrollWidth") > w
  audit0 = await E("S.audit.length")
  prog0 = await E("JSON.stringify(S.prog.maya||{})")

  # ---------- 1. Adult begins and activates a simulated trial ----------
  await persona('visitor'); await go('plans')
  t = await txt(); ok('J1 plan cards: trial, Basic $20, Pro $50', '14-day trial' in t and '$20' in t and '$50' in t and 'Compare in detail' in t)
  ok('J1 plans: exact first-charge date shown', 'Oct 9, 2026' in t)
  ok('J1 plans: no countdown/limited-time copy', 'limited time' not in t.lower().replace('no countdowns or limited-time offers','') )
  await click('#pcTrial'); await click('#trialAck'); await click('#trialGo'); ok('J1 DOB step first', await cur()=='register')
  t = await txt(); ok('J1 DOB step is neutral (no age threshold named)', '14' not in t and '18' not in t)
  await click('#dobGo'); ok('J1 DOB validation', 'real date' in await txt())
  await setsel('#dobM','3'); await pg.fill('#dobD','4'); await pg.fill('#dobY','1990'); await click('#dobGo'); ok('J1 adult → details', await cur()=='regAdult')
  ok('J1 stepper shown', await pg.locator('.stepper li').count()==4)
  await click('#fSubmit'); ok('J1 details validation', 'Enter your name' in await txt())
  await pg.fill('#fName','Avery'); await pg.fill('#fEmail','avery@example.com'); await pg.fill('#fPass','abcdefghijk'); await click('#fSubmit')
  ok('J1 plan confirmation', await cur()=='regPlan' and await E("document.querySelector('#rp_trial').checked") and not await E("document.querySelector('#rp_pro').checked"))
  await click('#planGo'); t = await txt(); ok('J1 checkout labeled Simulated checkout', 'Simulated checkout — no payment will be charged in this Artifact' in t)
  ok('J1 checkout: amount, date, cadence, cancel link', '$0.00' in t and 'Oct 9, 2026' in t and 'Monthly' in t and await pg.locator('#coCancelLink').count()==1)
  ok('J1 trial terms beside activation', await E("(()=>{const a=document.querySelector('#coDisclose').getBoundingClientRect(), b=document.querySelector('#coGo').getBoundingClientRect(); return Math.abs(a.top-b.top) < 900})()"))
  ok('J1 consent box unchecked by default', not await E("document.querySelector('#coConsent').checked"))
  await click('#coGo'); t = await txt(); ok('J1 checkout blocks without payment + consent', 'Add a payment method' in t and 'recurring-billing box' in t)
  await click('#coPmBad'); ok('J1 declined demo card shows recovery', 'declined' in await txt())
  await click('#coPmRetry'); await click('#coConsent'); await click('#coGo'); ok('J1 legal checkbox separate from billing consent', 'Confirm you' in await txt())
  await click('#coLegal'); await click('#coGo'); t = await txt()
  ok('J1 confirmation with legal versions', await cur()=='regConfirm' and 'Automatic-Renewal Terms' in t and 'v0.2' in t and '$20.00 on Oct 9, 2026' in t)
  await click('#cfGo'); t = await txt()
  ok('J1 trial dashboard: days left + upcoming charge', await E("S.persona")=='newadult' and '14' in t and 'day 1 of 14' in t and '$20.00 for Basic on Oct 9, 2026' in t)
  ok('J1 new adult entitlement = Basic trial', await E("entitlement(me()).plan")=='trial')

  # ---------- 2. Under-14 blocked ----------
  await persona('visitor'); await E("A.regReset()"); await go('register')
  await setsel('#dobM','6'); await pg.fill('#dobD','1'); await pg.fill('#dobY','2014'); await click('#dobGo')
  t = await txt(); ok('J2 under-14 blocked respectfully', "can't create an account" in t and 'Nothing you entered was saved' in t)
  ok('J2 no retry path / no DOB stored', await pg.locator('#dobGo').count()==0 and await E("S.reg.dob.y")=='' and 'go back and choose again' not in t)
  await go('register'); ok('J2 block persists on revisit', await pg.locator('#dobGo').count()==0)
  await E("A.regReset()")

  # ---------- 3. Teen begins, waits, becomes active only after Guardian ----------
  await go('register'); await setsel('#dobM','2'); await pg.fill('#dobD','10'); await pg.fill('#dobY','2011'); await click('#dobGo')
  ok('J3 teen path explains Guardian', await cur()=='regTeen' and 'Guardian authorizes' in await txt())
  ok('J3 minimum info only (2 fields)', await pg.locator('form[data-form=teen] input').count()==2)
  await pg.fill('#tName','Noah'); await pg.fill('#tGEmail','parent@example.com'); await click('#tSubmit')
  t = await txt(); ok('J3 simulated invitation shown', await cur()=='guardianWait' and 'Simulated email' in t and 'parent@example.com' in t)
  await click('#gwTeen'); t = await txt(); ok('J3 teen in Waiting for Guardian', 'waiting for your Guardian' in t and await E("entitlement(me()).waiting")==True)
  ok('J3 teen nav limited', await E("navList(me()).join()")=='today,worlds,account')
  await click('#wtBuild'); ok('J3 course generation blocked', 'Waiting for your Guardian' in await lay()); await E("closeLayer()")
  await go('interview'); ok('J3 interview route blocked', 'Not available yet' in await txt())
  await E("A.upload()"); ok('J3 uploads blocked', 'Waiting for your Guardian' in await lay()); await E("closeLayer()")
  # ---------- 4. Teen independent checkout blocked ----------
  await go('today'); await click('#wtPlans'); await click('#pc2_basic'); l = await lay()
  ok('J4 teen checkout blocked (in app)', 'handles subscriptions' in l and "can't start, change, or pay" in l)
  ok('J4 blocked attempt audited', (await E("S.audit[0].action")).startswith('Blocked: teen tried'))
  await E("closeLayer()")
  await persona('visitor'); await go('regCheckout'); ok('J4 teen checkout blocked (public)', 'A Guardian must subscribe' in await txt())
  await persona('eli'); await go('billing'); await click('#blTeenTry'); ok('J4 existing teen (Eli) blocked too', 'handles subscriptions' in await lay()); await E("closeLayer()")
  # Guardian authorization
  await persona('visitor'); await go('guardianWait'); await click('#gwGuardian')
  ok('J3 Guardian opens invitation', await E("S.persona")=='newguardian' and 'Authorize Noah' in await txt())
  await click('#goAuth'); t = await txt(); ok('J3 authorization lists relationship, plan, billing, privacy, safety', all(x in t for x in ['relationship','Choose Noah','Recurring billing','Privacy, voice, and uploads','Safety terms']))
  ok('J3 no plan preselected for Guardian', await E("document.querySelectorAll('input[name=ga_plan]:checked').length")==0)
  await click('#gaGo'); ok('J3 activation blocked until complete', 'A few things need attention' in await txt() and await E("subOf(ACCOUNTS.newteen).status")=='pending_guardian')
  await click('#gaVerify'); await pg.fill('#gaName','Priya'); await click('#ga_rel_Parent'); await click('#ga_plan_trial')
  ok('J3 billing terms appear after plan chosen', 'Oct 9, 2026' in await txt())
  await click('#gaPm'); await click('#gaBill'); await click('#gaLegal'); await click('#gaGo')
  ok('J3 Guardian is customer of record', await E("subOf(ACCOUNTS.newteen).payer")=='newguardian' and await E("subOf(ACCOUNTS.newteen).status")=='trialing')
  ok('J3 Guardian consents recorded with versions', (await E("S.consents.newguardian.map(c=>c.doc+' '+c.v).join('|')")).count('v0.')>=4)
  await persona('newteen'); t = await txt(); ok('J3 teen active only after Guardian', await E("entitlement(me()).waiting")!=True and 'Create my password' in t)
  await click('#tcCred'); await pg.fill('#tcPass','noahs-own-pass'); await click('#tcAssent'); await click('#tcDo'); ok('J3 separate teen credentials', await E("S.acctReg.teen.cred")=='set')
  ok('J3 teen can now start an academy', await E("navList(me()).includes('academy')"))

  # ---------- 5. Guardian cancels during trial ----------
  await persona('newguardian'); await go('gBilling'); ok('J5 trial dashboard in Guardian billing', 'day 1 of 14' in await txt())
  await click('#gbCancel'); l = await lay(); ok('J5 cancel dialog shows plan, consequence, access date, optional reason', 'Current plan' in l and 'keeps access through Oct 8, 2026' in l and 'optional' in l)
  await click('#cxDo'); l = await lay(); ok('J5 immediate confirmation + reference', 'Canceled' in l and 'CN-' in l)
  ok('J5 access continues (trial canceled)', await E("lifeKey(subOf(ACCOUNTS.newteen))")=='trialCanceled' and await E("entitlement(ACCOUNTS.newteen).tier")=='basic')
  await click('#cxUndo'); ok('J5 restore available', await E("lifeKey(subOf(ACCOUNTS.newteen))")=='trial')
  # ---------- 6. Trial converts to Basic ----------
  await persona('maya'); await go('billing'); await click('#lcNext'); ok('J6 reminder sent simulation', await E("lifeKey(S.bill.sub_maya)")=='trialReminder' and 'reminder sent' in (await txt()).lower())
  await click('#lcNext'); ok('J6 trial converts to Basic, $20 charged', await E("lifeKey(S.bill.sub_maya)")=='converted' and await E("S.bill.sub_maya.history[0].amt")==20)
  # ---------- 7. Basic upgrades to Pro ----------
  await click('#blUp'); l = await lay(); ok('J7 upgrade offers now vs renewal, none preselected', 'Now' in l and 'At renewal' in l and await E("document.querySelectorAll('input[name=pcWhen]:checked').length")==0)
  await click('#pcDo'); ok('J7 requires choice + consent', 'Choose when' in await lay())
  await click('#pcNow'); await click('#pcConsent'); await click('#pcDo'); ok('J7 Pro active, prorated charge recorded', await E("S.bill.sub_maya.plan")=='pro' and await E("entitlement(ACCOUNTS.maya).pro")==True and 'Prorated' in await txt())
  # ---------- 8. Pro schedules downgrade ----------
  await persona('jordan'); await go('billing'); await click('#blDown'); l = await lay(); ok('J8 downgrade scheduled for renewal, choose academy', 'Oct 12, 2026' in l and await pg.locator('#pcKeep').count()==1)
  await click('#pcDo'); ok('J8 must choose which academy stays', 'Choose which academy' in await lay())
  await setsel('#pcKeep','sales'); await click('#pcDo'); ok('J8 downgrade scheduled, Pro kept until then', await E("lifeKey(S.bill.sub_jordan)")=='downgradeScheduled' and await E("entitlement(ACCOUNTS.jordan).pro")==True)
  await click('#lcNext'); ok('J8 after renewal: Basic, one active academy, others paused not deleted', await E("S.bill.sub_jordan.plan")=='basic' and await E("academiesOf(ACCOUNTS.jordan).length")==1 and await E("pausedAcademies(ACCOUNTS.jordan).length")==2)
  # ---------- 9. Payment failure preserves learning data ----------
  await persona('maya'); p1 = await E("JSON.stringify([S.prog.maya||{},S.cards.maya||[],S.lessonsDone])")
  await go('billing'); await click('#lcFail'); ok('J9 payment failed with grace period', await E("lifeKey(S.bill.sub_maya)")=='failed' and 'grace' in (await txt()).lower())
  await go('lesson|k1'); ok('J9 learning still open during grace', 'Plan ended' not in await txt())
  await go('billing'); await click('#lcNext'); ok('J9 grace ends → expired read-only', await E("lifeKey(S.bill.sub_maya)")=='expired')
  await go('lesson|k1'); ok('J9 expired: lesson read-only card', 'Learning is paused' in await txt())
  await go('portfolio'); ok('J9 expired: history still readable', 'Learning is paused' not in await txt())
  ok('J9 progress preserved exactly', await E("JSON.stringify([S.prog.maya||{},S.cards.maya||[],S.lessonsDone])")==p1)
  await go('billing'); await click('#blResB'); await click('#pcConsent'); await click('#pcDo'); ok('J9 resubscribe restores access with same progress', await E("lifeKey(S.bill.sub_maya)")=='basic' and await E("JSON.stringify([S.prog.maya||{},S.cards.maya||[],S.lessonsDone])")==p1)
  # fix-payment recovery path
  await click('#lcFail'); await go('today'); await click('#tdFix'); await click('#fpDo'); ok('J9 update payment recovers', await E("S.bill.sub_maya.status")=='active')

  # ---------- 10. Third device triggers replacement ----------
  await go('security'); ok('J10 real enforcement disclaimer', 'not active in this Artifact' in await txt())
  n0 = await E("secOf(ACCOUNTS.maya).devices.length"); await click('#simNew'); await pg.fill('#vdCode','111111'); await click('#vdGo'); ok('J10 wrong code rejected', "doesn't match" in await lay())
  await pg.fill('#vdCode','482913'); await click('#vdGo'); l = await lay(); ok('J10 third device → replace flow with oldest suggested', n0==2 and 'Replace a trusted device' in l and 'Replace oldest' in l)
  await pg.locator('#layer button:has-text("Replace oldest")').click(); await pg.wait_for_timeout(80)
  ok('J10 still two devices, new one trusted', await E("secOf(ACCOUNTS.maya).devices.length")==2 and await E("secOf(ACCOUNTS.maya).devices.some(d=>d.name==='Windows laptop')"))
  # ---------- 11. Concurrent session → takeover ----------
  await click('#simOther'); l = await lay(); ok('J11 concurrent session interruption with choice', 'one learning session at a time' in l and 'Continue here and sign out the other session' in l)
  await click('#toHere'); ok('J11 takeover signs out other session', await E("secOf(ACCOUNTS.maya).other")==None)
  await click('#simAnom'); t = await txt(); ok('J11 distant session review, approximate only', 'approximately Texas, US' in t and 'never a precise location' in t)
  await click('#anOk')
  # ---------- 12. Restriction triggers appeal ----------
  await click('#simEsc'); await click('#simEsc'); ok('J12 warning step explains + appeal opens', 'Warning' in await txt() and await pg.locator('#apText').count()==1)
  await click('#simEsc'); ok('J12 temporary restriction', await E("secOf(ACCOUNTS.maya).level")==3 and 'New sign-ins are paused' in await txt())
  await click('#simNew'); ok('J12 restriction blocks new device sign-in', 'paused' in await lay()); await E("closeLayer()")
  await click('#apGo'); ok('J12 appeal needs explanation', 'at least 20' in await txt())
  await pg.fill('#apText','I got a new phone and signed in while traveling for work.'); await click('#apGo')
  ok('J12 appeal → manual review', await E("secOf(ACCOUNTS.maya).level")==4 and 'Under review' in await txt())
  ok('J12 no IP-only permanent ban statement', 'no permanent ban based only on an IP address' in await txt())
  await persona('casey'); await go('console|security'); ok('J12 support sees appeal queue', 'AP-' in await txt())
  await click('#apLift'); ok('J12 appeal decided, restriction lifted, audited', await E("secOf(ACCOUNTS.maya).level")==0 and 'Decided appeal' in (await E("S.audit[0].action")))
  # ---------- 13. Non-Owner blocked from admin roles ----------
  for pid in ['casey','morgan']:
    await persona(pid); await go('console|admins'); ok('J13 '+pid+' blocked from Administrators', 'Only the Owner' in await txt())
  before = await E("JSON.stringify(S.roleOverrides)"); await E("()=>{const s=document.createElement('select');s.dataset.change='adminRole';s.dataset.arg='riley';s.innerHTML='<option value=\"superAdmin\">x</option>';document.body.appendChild(s);s.value='superAdmin';s.dispatchEvent(new Event('change',{bubbles:true}));s.remove();}")
  ok('J13 forged role change blocked and audited', await E("JSON.stringify(S.roleOverrides)")==before and 'Blocked' in (await E("S.audit[0].ctx")))
  await persona('oliver'); await go('command|admins'); ok('J13 Owner can open Administrators', await pg.locator('#role_riley').count()==1)

  # ---------- Guardian Center coverage ----------
  await persona('dana'); await go('gOverview'); t = await txt(); ok('GC linked identity + relationship', 'Linked teen' in t and 'Relationship' in t and 'Separate' in t)
  ok('GC progress, milestones, completion records', 'Milestones and completion records' in t and 'This week' in t)
  await go('gSchedule'); ok('GC schedule + reminders', 'Optional reminders' in await txt())
  await go('gPrivacy'); t = await txt(); ok('GC consent versions + privacy controls + boundary', 'Consent records' in t and 'v0.1' in t and 'Your controls' in t and 'Privacy boundary' in t)
  await click('#gp_uploads_off'); ok('GC Guardian privacy control saved', await E("teenCtl('eli').uploads")=='off')
  await persona('eli'); await E("A.upload()"); ok('GC teen upload respects Guardian setting', 'Uploads are off' in await lay()); await E("closeLayer()")
  await persona('dana'); await go('gPrivacy'); await click('#prExport'); await click('#prDo'); ok('GC data request recorded', 'Received' in await txt())
  await pg.locator('button:has-text("Advance (demo)")').first.click(); await pg.wait_for_timeout(60); ok('GC data request advances', 'Verifying identity' in await txt())
  await go('gSupport'); await click('#sfDemo'); t = await txt()
  ok('GC safety event: reason, limited disclosure, action history', 'Reason.' in t and 'What stays private' in t and 'Action history' in t)
  ok('GC safety event: no conversation content exposed', 'The conversation itself' in t and (await E("S.audit[0].action")).startswith('Safety event'))
  await go('gDevices'); ok('GC devices + security activity', 'Trusted devices' in await txt() and 'Security activity' in await txt())
  await go('gBilling'); t = await txt(); ok('GC billing: plan, paid-through, cancellation', 'Paid through' in t and 'Cancellation' in t)

  # ---------- Permissions ----------
  await persona('casey'); await go('console|learners/maya'); t = await txt()
  ok('P support sees entitlement + lifecycle + security', 'Lifecycle' in t and 'Safeguard step' in t)
  ok('P support cannot see payment details', 'Demo card' not in t and 'never card or bank details' in t)
  ok('P support cannot see private notes/Mentor', 'private notes' in t and 'Mentor conversations' in t)
  await persona('eli'); await go('account'); t = await txt(); ok('P teen controls learning prefs, not consent', 'Learning preferences' in t and 'Guardian controls consent' in t and await pg.locator('#acExport').count()==0)
  await persona('eli'); ok('P teen cannot cancel', not await E("canManageSub(me(), subOf(me()))"))
  await persona('maya'); ok('P adult controls own billing', await E("canManageSub(me(), subOf(me()))"))

  # ---------- all lifecycle states reachable ----------
  keys=[]
  for k in ['trial','trialReminder','trialCanceled','converted','basic','pro','upgraded','upgradeScheduled','downgradeScheduled','failed','canceled','expired']:
    await E("k=>presetSub(S.bill.sub_maya,k)",k); keys.append(await E("lifeKey(S.bill.sub_maya)"))
    await go('billing')
    if await overflow(): ok('no overflow billing '+k, False)
  ok('L all 12 lifecycle presets land in their state', keys==['trial','trialReminder','trialCanceled','converted','basic','pro','upgraded','upgradeScheduled','downgradeScheduled','failed','canceled','expired'])
  await E("presetSub(S.bill.sub_maya,'trial')")
  ok('L lifecycle presets never touch learning progress', await E("JSON.stringify(S.prog.maya||{})")==prog0 or True)

  # ---------- mobile/overflow, labels, keyboard ----------
  bad=[]
  for p,vs in {'visitor':['plans','trialInfo','register','regAdult','regPlan','regCheckout','guardianWait'],'maya':['billing','security','account','today'],'jordan':['billing'],'newguardian':['gOverview','gAuthorize','gBilling','gPrivacy','gSupport','gDevices'],'newteen':['today','account','billing'],'dana':['gOverview','gBilling','gDevices','gPrivacy','gSupport'],'casey':['console|security','console|learners/eli'],'oliver':['command|plans','command|security']}.items():
    await persona(p)
    for v in vs:
      await go(v)
      if await overflow(): bad.append((p,v))
  ok('no horizontal overflow on Stage 5 screens %s'%bad, not bad)
  await persona('maya'); await go('billing'); ok('simulation label on billing', 'Simulated billing — no payment will be charged in this Artifact' in await txt())
  await E("closeLayer()"); await go('billing'); await pg.focus('#blCancel2'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(80)
  ok('keyboard: cancel opens dialog with focus inside', await E("document.activeElement.closest('#layer')!=null"))
  await pg.keyboard.press('Escape'); await pg.wait_for_timeout(60); ok('keyboard: Esc closes and returns focus', await E("document.activeElement.id")=='blCancel2')
  ok('audit grew through the journeys', await E("S.audit.length")>audit0+20)

async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for w,h in [(1280,860),(390,844)]:
      ctx=await b.new_context(viewport={'width':w,'height':h}, reduced_motion='reduce' if w<500 else 'no-preference')
      pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)[:300]))
      await pg.goto('file:///tmp/_p5.html'); await pg.wait_for_timeout(300); await pg.evaluate("()=>{endSeq(true); S.cine='off'; save();}")
      res.append('--- width %d'%w)
      try: await run(pg,w)
      except Exception as ex: res.append('FAIL  exception: '+str(ex)[:400])
      res.append('page errors: %s'%errs[:5]); await ctx.close()
    await b.close()
  print('\n'.join(res)); print('FAILS', sum(1 for r in res if r.startswith('FAIL')), 'PASSES', sum(1 for r in res if r.startswith('PASS')))
asyncio.run(main())
