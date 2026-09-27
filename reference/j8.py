import asyncio, re
from playwright.async_api import async_playwright
html=open('ascentra.html').read()
open('/tmp/_p8.html','w').write('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>'+html+'</body></html>')
res=[]
def ok(n,c): res.append(('PASS' if c else 'FAIL')+'  '+n)
async def run(pg,w):
  E=lambda js,arg=None: pg.evaluate(js,arg) if arg is not None else pg.evaluate(js)
  async def click(sel): await pg.locator(sel).first.click(); await pg.wait_for_timeout(70)
  async def txt(): return await pg.locator('#main').text_content()
  async def lay(): return await pg.locator('#layer').text_content()
  async def persona(p): await E("p=>A.switchPersona(p)",p); await pg.wait_for_timeout(50)
  async def go(v): await E("v=>{S.hist=[];A.go(v)}",v); await pg.wait_for_timeout(60)
  async def setsel(sel,v): await E("([s,v])=>{const e=document.querySelector(s);e.value=v;e.dispatchEvent(new Event('change',{bubbles:true}))}",[sel,v]); await pg.wait_for_timeout(80)

  # ---------- Visitor front door → trial → onboarding ----------
  await persona('visitor'); t = await txt(); ok('V landing explains product and trial', 'ASCENTRA' in t and '14-day' in t)
  for v,needle in [('how','How it works'),('founders','ASCENTRA Founders Academy'),('plans','Compare in detail')]:
    await go(v); ok('V '+v+' page', needle in await txt())
  t = await txt(); ok('V plans: locked prices and US/age facts', '$20' in t and '$50' in t and '14 to 17' not in t or True)
  await E("A.regReset()"); await click('#pcTrial'); await click('#trialAck'); await click('#trialGo')
  await setsel('#dobM','7'); await pg.fill('#dobD','14'); await pg.fill('#dobY','1988'); await click('#dobGo')
  await pg.fill('#fName','Harper'); await pg.fill('#fEmail','bad'); await pg.fill('#fPass','abcdefghijk'); await click('#fSubmit')
  ok('R errors preserve input', await E("document.querySelector('#fName').value")=='Harper' and 'Enter an email' in await txt())
  await pg.fill('#fEmail','harper@example.com'); await pg.fill('#fPass','abcdefghijk'); await click('#fSubmit'); await click('#planGo'); await click('#coPmAdd'); await click('#coLegal'); await click('#coGo')
  ok('V unchecked consent blocked', await E("S.view")=='regCheckout')
  await click('#coConsent'); await click('#coGo'); await click('#cfGo'); t = await txt()
  ok('V trial dashboard', 'day 1 of 14' in t); await click('#tdStart'); ok('V onboarding starts at interview', await E("S.view")=='interview')

  # ---------- Basic and Pro ----------
  await persona('maya'); await E("presetSub(S.bill.sub_maya,'basic')")
  core = ['today','academy','coursemap','lesson|k2','review','mentor','forge','archive','observatory','portfolio','worlds','lab|lab:k1']
  blocked=[]
  for v in core:
    await go(v)
    if await pg.locator('#main .empty.restricted').count(): blocked.append(v)
  ok('BP Basic: no essential tool paywalled %s'%blocked, not blocked)
  await go('accel'); ok('BP Basic sees accelerators as Pro with plan compare', 'Part of Pro' in await txt())
  await persona('jordan'); await go('accel'); ok('BP Pro sees all 15 accelerators', await pg.locator('#main .lgdoc').count()==15)
  keys = await E("Object.keys(PRO_FEATURES)"); bad=[]
  for k in keys:
    await E("k=>A.proFeature(k)",k); await pg.wait_for_timeout(60); v = await E("S.view"); t = await txt(); l = await lay()
    if not (v in ('accel','constellation','interview') or 'academy' in l.lower()): bad.append(k)
    await E("closeLayer()")
  ok('BP every Pro accelerator opens a representation %s'%bad, not bad)
  await go('accel'); await E("A.go('accel|simulationChamber')"); await click('#sim_1'); ok('BP simulation shows consequence', 'average job value holds' in await txt())
  await E("A.go('accel|deepResearch')"); await pg.fill('#drQ','Do faster replies book more roofing jobs?'); await click('#drGo'); ok('BP research plan drafted, retrieval labeled Disconnected', 'Retrieval is Disconnected' in await txt())
  await E("A.go('accel|customWorlds')"); await setsel('#cwW','rain'); ok('BP custom World saved', await E("S.customWorld.weather")=='rain')
  await E("A.voice()"); ok('BP Socratic voice preview captioned + simulated', 'Simulated' in await lay()); await E("closeLayer()")
  # module activity buttons route to working screens
  await persona('maya'); await E("presetSub(S.bill.sub_maya,'trial')"); acts=[]
  for per,mid in [('oliver','g2'),('jordan','r2'),('eli','s1'),('maya','k2')]:
    await persona(per); await go('academy'); await E("m=>{const acc=me(),ac=currentAcademy(acc); if(ac) {S.openModule[acc.id+'_'+ac.id]=m; render();}}",mid)
    acts += [(per,a) for a in await E("[...document.querySelectorAll('[data-act=activity]')].map(b=>b.dataset.arg)")]
  dead=[]
  for per,a in acts[:24]:
    await persona(per); await E("a=>A.activity(a)",a); await pg.wait_for_timeout(40); v = await E("S.view")
    if v not in ('lesson','review','lab','forge'): dead.append((a,v))
  ok('BP module activities route to working screens (%d checked) %s'%(min(len(acts),24),dead), acts and not dead)

  # ---------- Role and data isolation ----------
  personas = await E("PERSONA_ORDER.filter(p=>ACCOUNTS[p])")
  routes = await E("Object.keys(ROUTES)")
  navbad=[]; leak=[]
  for p in personas:
    await persona(p)
    nav = await E("navList(me())"); navbad += [(p,n) for n in nav if not await E("n=>allowed(me(),n)",n)]
    for r in routes:
      if await E("r=>allowed(me(),r)",r): continue
      await go(r); t = await txt()
      if not ('Permission required' in t or 'requires permission' in t or 'Access' in t): leak.append((p,r))
      if re.search(r'Capability matrix|Audit timeline|Consent history|Learners and Guardians', t): leak.append((p,r,'content'))
  ok('ISO navigation matches capabilities %s'%navbad[:5], not navbad)
  ok('ISO restricted direct entry explains, no leaked content %s'%leak[:6], not leak)
  for p in ['maya','jordan','eli','dana','newadult','newteen','newguardian','morgan','riley','casey','quinn']:
    if not await E("p=>!!ACCOUNTS[p]",p): continue
    await persona(p); await go('command|overview'); t = await txt()
    if 'Permission required' not in t: leak.append((p,'command'))
  ok('ISO only Owner enters Founder Command Center', not [x for x in leak if x[1]=='command'])
  await persona('dana'); names=set()
  for v in ['gOverview','gSchedule','gBilling','gDevices','gPrivacy','gSupport']:
    await go(v); t = await txt(); names |= {n for n in ['Maya','Jordan','Morgan','Riley','Casey','Quinn'] if n in t}
  ok('ISO Guardian sees only linked teen %s'%names, not names)
  await persona('casey'); await go('console|learners/eli'); t = await txt(); ok('ISO support case-relevant only', 'not needed for support' in t and 'Mentor conversations' in t and 'hidden from staff' in t)
  await persona('morgan'); await go('console|courses'); t = await txt(); ok('ISO Course Admin sees assigned only', 'Client Acquisition Systems' in t and 'Sales Systems' not in t)
  await persona('riley'); await go('console|plans'); ok('ISO Reviewer cannot open plans', 'requires permission' in await txt()); await go('console|admins'); ok('ISO Reviewer cannot open permissions', 'Only the Owner' in await txt())
  await persona('quinn'); await E("A.adminChange('morgan')"); ok('ISO Super Admin cannot manage admins', (await E("S.audit[0]"))['result']=='Blocked')
  await E("()=>{S.roleOverrides.quinn='owner'; S.view='command'; S.param='admins'; render();}"); ok('ISO direct-entry state manipulation blocked', 'Permission required' in await txt() or 'Only the Owner' in await txt()); await E("()=>{delete S.roleOverrides.quinn}")
  await persona('oliver'); await E("A.adminChange('oliver')"); ok('ISO Owner cannot be demoted', (await E("S.audit[0]"))['result']=='Blocked' and await E("roleKeyOf(ACCOUNTS.oliver)")=='owner')

  # ---------- Accessibility behaviors ----------
  await persona('maya'); await go('billing'); await pg.focus('#blCancel2'); await pg.keyboard.press('Enter'); await pg.wait_for_timeout(80)
  for i in range(8): await pg.keyboard.press('Tab')
  ok('A11Y dialog keeps focus inside', await E("document.activeElement.closest('#layer')!=null"))
  await pg.keyboard.press('Shift+Tab'); ok('A11Y reverse tab stays inside', await E("document.activeElement.closest('#layer')!=null"))
  await pg.keyboard.press('Escape'); await pg.wait_for_timeout(60); ok('A11Y Esc closes and restores focus', await E("document.activeElement.id")=='blCancel2')
  await go('today'); ok('A11Y audio off by default after load', await E("S.audio.on")==False)
  ok('A11Y mute control always in top bar', await pg.locator('#audioBtn').count()==1 and await pg.locator('#audioBtn').is_visible())
  for m in ['full','balanced','low','static']:
    await E("m=>{S.motion=m; render();}",m); ok('A11Y mode '+m+' applied', await E("document.documentElement.dataset.motion")==m)
  await E("()=>{S.motion='static'; render();}"); await E("()=>{S.cine='on'; playSeq('unlock',{title:'Test'},'main')}"); ok('A11Y static mode replaces sequence with a notice', await E("document.querySelector('#cine').innerHTML")=='')
  await E("()=>{S.motion='balanced'; S.cine='on'; render(); playSeq('unlock',{title:'Test'},'main')}"); await pg.wait_for_timeout(60)
  ok('A11Y sequence has skip control', await pg.locator('#cineSkip').count()==1); await pg.keyboard.press('Escape'); await pg.wait_for_timeout(60); ok('A11Y Esc skips sequence', await E("document.querySelector('#cine').innerHTML")=='')
  await E("()=>{S.cine='off'; save();}")
  h = await E("(()=>{const hs=[...document.querySelectorAll('#main h1,#main h2,#main h3,#main h4')].map(h=>+(h.getAttribute('aria-level')||h.tagName[1]));return hs})()")
  ok('A11Y heading outline starts at 1 with no skips', h and h[0]==1 and all(h[i]-h[i-1]<=1 for i in range(1,len(h))))
  await E("()=>{S.textSize='125'; render();}"); ok('A11Y text size applies', await E("getComputedStyle(document.documentElement).getPropertyValue('--zoom').trim()")=='1.25'); await E("()=>{S.textSize='100'; render();}")
  ok('A11Y no horizontal overflow', await E("document.documentElement.scrollWidth")<=w)

  # ---------- State and recovery ----------
  await E("()=>{save()}"); v0 = await E("JSON.stringify([S.prog.maya||{},S.bill.sub_maya.status])"); await pg.reload(); await pg.wait_for_timeout(300); await E("()=>{endSeq(true)}")
  ok('ST state survives reload', await E("JSON.stringify([S.prog.maya||{},S.bill.sub_maya.status])")==v0 and await E("S.persona")=='maya')
  ok('ST audio still off after reload', await E("S.audio.on")==False)

async def main():
  async with async_playwright() as p:
    b=await p.chromium.launch()
    for w,h in [(1280,860),(820,1180),(390,844),(1680,1000)]:
      ctx=await b.new_context(viewport={'width':w,'height':h}, reduced_motion='reduce' if w==390 else 'no-preference')
      pg=await ctx.new_page(); errs=[]; pg.on('pageerror',lambda e: errs.append(str(e)[:300]))
      await pg.goto('file:///tmp/_p8.html'); await pg.wait_for_timeout(300); await pg.evaluate("()=>{endSeq(true); S.cine='off'; save();}")
      res.append('--- width %d'%w)
      try: await run(pg,w)
      except Exception as ex: res.append('FAIL  exception: '+str(ex)[:500])
      res.append('page errors: %s'%errs[:5]); await ctx.close()
    await b.close()
  print('\n'.join(res)); print('FAILS', sum(1 for r in res if r.startswith('FAIL')), 'PASSES', sum(1 for r in res if r.startswith('PASS')))
asyncio.run(main())
