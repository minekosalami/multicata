const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {chromium}=require('playwright');
const {database,ids}=require('../next/local-db.cjs'),{server,openVisitor}=require('../next/runtime.cjs');
(async()=>{
 const stage=process.argv[2],out=path.join(__dirname,stage),results=[],errors=[];
 fs.mkdirSync(out,{recursive:true});const db=await database();
 const browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/html/';
 const rec=(key,value)=>results.push({key,value});
 try{
 for(const width of [1280,360]){
 const p=await openVisitor(browser,db,errors,ids[0],width);
 const go=file=>p.goto(base+file+'.html');
 const snap=name=>p.screenshot({path:path.join(out,name+'-'+width+'.jpg'),quality:80});
 await go('index');await p.locator('.record-row').first().waitFor();
 rec('home '+width,await p.evaluate(()=>({headerMarks:[...document.querySelectorAll('.station>header')].map(n=>getComputedStyle(n,'::before').content),links:[...document.querySelectorAll('.station>header a')].map(a=>({name:a.textContent,height:a.offsetHeight})),overflow:document.documentElement.scrollWidth-innerWidth})));
 rec('interaction order '+width,await p.locator('.portal-grid .station').evaluateAll(stations=>({dom:stations.map(s=>s.id),visual:stations.slice().sort((a,b)=>a.offsetTop-b.offsetTop).map(s=>s.id)})));
 const art=p.locator('.art-link[target="_blank"]');rec('art behavior '+width,{text:await art.innerText(),target:await art.getAttribute('target')});
 await snap('home');
 await p.locator('.contents a[href="#directory"]').click();await p.locator('.art-link').first().scrollIntoViewIfNeeded();
 await p.locator('.art-link').first().click();await p.getByRole('button',{name:'Nart',exact:true}).click();
 await p.locator('#character-info h2').filter({hasText:'Nart'}).waitFor();
 await p.getByRole('button',{name:'Amanda',exact:true}).click();await p.locator('#character-info h2').filter({hasText:'Amanda'}).waitFor();
 await p.locator('.member-menu summary').click();rec('menu '+width,await p.locator('.member-menu').innerText());
 await p.keyboard.press('Escape');await p.locator('[data-back-button]').click();await p.locator('#directory').waitFor();
 for(const [label,file] of [['Private messages','inbox'],['Community chat','chat']]){
 await p.locator('#chats footer').getByRole('link',{name:label}).click();await p.waitForURL('**/'+file+'.html');await p.goBack();await p.locator('#chats footer').waitFor();
 }
 if(stage==='after'){
   const artPage=p.waitForEvent('popup');await p.locator('.art-link[target="_blank"]').click();
   const artTab=await artPage;await artTab.waitForLoadState();assert(await artTab.locator('img').evaluate(i=>i.naturalWidth>0));await artTab.close();
   await p.locator('.member-menu summary').click();await p.locator('.member-menu').getByRole('link',{name:'Characters',exact:true}).click();
   await p.getByRole('button',{name:'Nart',exact:true}).click();await p.locator('#character-info h2').filter({hasText:'Nart'}).waitFor();
   await p.locator('.member-menu summary').click();await p.locator('.member-menu').getByRole('link',{name:'All Music',exact:true}).click();
   await p.locator('.record-row').first().waitFor();
 }
 await go('posts');await p.locator('#post-filter').selectOption('following');await p.locator('.no-posts').waitFor();rec('following filter '+width,await p.locator('.no-posts').innerText());
 if(stage==='after'){
   await p.getByRole('button',{name:'Show all posts'}).click();await p.waitForFunction(()=>document.querySelector('#post-filter')?.value==='all' && !!document.querySelector('.post'));
 }
 await go('favorites');await p.getByText(/No favorites yet/).waitFor();
 const shuffle=p.getByRole('button',{name:'Shuffle favorites'});rec('empty favorites '+width,{enabled:await shuffle.isEnabled(),link:await p.locator('.catalogue-tools a').getAttribute('href')});
 if(await shuffle.isEnabled())await shuffle.click();await snap('favorites');
 await go('index');await p.getByRole('link',{name:'All Music',exact:true}).click();await p.locator('.record-row').first().waitFor();
 await p.locator('.record-credit a').first().click();await p.locator('.profile-page').waitFor();await p.goBack();await p.locator('.record-row').first().waitFor();
 await p.getByRole('button',{name:'Play GrassCats Pop',exact:true}).click();await p.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
 await p.locator('.player-panel summary').click();rec('empty queue '+width,await p.locator('.player-panel details').innerText());
 const dial=p.getByRole('slider',{name:'Slow playback speed'});await dial.focus();await dial.press('Home');assert.equal(await dial.getAttribute('aria-valuenow'),'0.50');
 rec('dial '+width,{visibleHelp:await p.locator('.slow-control').innerText(),tooltip:await dial.getAttribute('title')});
 await snap('player');await p.keyboard.press('Escape');
 await p.locator('.record-row').first().getByRole('button',{name:/^Queue /}).click();
 const articleLink=p.locator('.site-nav a').filter({hasText:'Articles'});await articleLink.click();
 const frame=p.frameLocator('.player-page');await frame.getByRole('heading',{name:'All Articles',exact:true}).waitFor();await frame.getByText('Write your articles here!').waitFor();
 await frame.locator('.site-nav a').filter({hasText:'Posts'}).click();await frame.getByRole('heading',{name:'All Posts'}).waitFor();
 await p.goBack();await frame.getByRole('heading',{name:'All Articles'}).waitFor();await p.goForward();await frame.getByRole('heading',{name:'All Posts'}).waitFor();
 assert(await p.locator('audio').evaluate(a=>!a.paused && a.playbackRate===.5));
 await frame.locator('.player-toggle').click();await p.locator('.player-panel summary').filter({hasText:'Queue · 1'}).waitFor();
 await p.context().close();
 }
 const guest=await openVisitor(browser,db,errors,null,360);
 for(const file of ['inbox','chat','posts','favorites','writing']){
 await guest.goto(base+file+'.html');await guest.locator('main a[href*="account.html"]').first().waitFor();rec('guest '+file,await guest.locator('main a[href*="account.html"]').first().innerText());
 }
 if(stage==='after'){
   for (const {key,value} of results) {
     if(key.startsWith('home '))assert(value.overflow===0 && value.headerMarks.every(v=>v==='none') && value.links.every(a=>a.height>=44));
     if(key==='interaction order 360')assert.deepEqual(value.dom,value.visual);
     if(key.startsWith('empty favorites'))assert(!value.enabled && value.link==='music.html');
     if(key.startsWith('dial '))assert.match(value.visibleHelp,/Turn left/);
     if(key.startsWith('empty queue'))assert.match(value,/beside a track/);
   }
 }
 assert.deepEqual(errors,[]);console.log(JSON.stringify(results));
 }finally{fs.writeFileSync(path.join(out,'visit.json'),JSON.stringify({results,errors},null,2));await browser.close();server.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
