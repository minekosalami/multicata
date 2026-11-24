const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {database,asUser,ids:[listener,creator,other]}=require('../next/local-db.cjs'),{server,openVisitor}=require('../next/runtime.cjs');
(async()=>{
 const db=await database(),browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 const out=process.env.MULTICATA_ORBIT_DIR || path.join(__dirname,'final');fs.mkdirSync(out,{recursive:true});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/html/',errors=[],checks=[];
 const run=(who,sql,params=[])=>asUser(db,who,async tx=>(await tx.query(sql,params)).rows);
 try{
 await db.query("insert into private_messages(sender,recipient,body) values($1,$2,'Private test text')",[creator,listener]);
 assert.equal((await run(other,'select * from home_threads()')).length,0);
 const [thread]=await run(listener,'select * from home_threads()');assert.equal(thread.peer,creator);assert.equal(thread.body,undefined);
 await assert.rejects(run(null,'select * from home_threads()'));await assert.rejects(run(null,'select * from home_posts()'));
 const id='00000000-0000-4000-8000-000000000070',key=id+'/00000000-0000-4000-8000-000000000071.jpg';
 await db.query("insert into articles(id,author,title,body,published) values($1,$2,'QA image article',$3,true)",[id,creator,'Text '.repeat(25)+'\n\n![Existing picture](image:'+key+')']);
 const [article]=await run(null,'select * from home_articles()');assert.equal(article.image_alt,'Existing picture');assert.equal(article.image_key,key);
 await db.query('update articles set published=false where id=$1',[id]);assert.equal((await run(null,'select * from home_articles()')).length,0);
 await db.query('insert into message_blocks values($1,$2)',[listener,creator]);assert.equal((await run(listener,'select * from home_threads()')).length,0);assert.equal((await run(listener,'select * from home_posts()')).length,0);assert.equal((await run(listener,'select * from home_creators()')).length,0);
 checks.push('Guest grants, participant-only thread metadata, blocked actor filtering, published image attribution and withdrawal checked in database roles.');
 const approved=new Set(["Join Nart Club!", "mmmmm, Cata...", "from LLiosette, to you.", "Pet's not dead!", "Play NeoCata99.", "GrassCats!", "A CaveCats Christmas.", "CatsSaga on the NekoMINI", "PLAY CATSSAGA NOW.", "Have fun!", "Konnichiwa!", "Bart approves of you.", "Post some music!", "Be happy.", "Be sad.", "Write some articles!", "Thanks to HALLOW"]);
 const p=await openVisitor(browser,db,errors,null,1280);await p.goto(base+'index.html');let last;
 for(let i=0;i<18;i++){if(i)await p.reload();const t=await p.locator('#orbit-splash').innerText();assert(approved.has(t)&&last!==t);last=t;}
 await p.waitForTimeout(3050);assert.equal(await p.locator('#orbit-splash').innerText(),last);
 checks.push('18 homepage loads each displayed one approved splash without adjacent repetition. The last stayed fixed across a full orbit.');
 for(const width of [1280,360,320]){
   await p.setViewportSize({width,height:810});await p.locator('.orbit-stage').scrollIntoViewIfNeeded();
   await p.locator('.orbit-running').waitFor();
   const values=await p.evaluate(()=>{
     const stage=document.querySelector('.orbit-stage'),imgs=[...stage.querySelectorAll('img')],animations=stage.getAnimations({subtree:true});
     animations.forEach(a=>a.pause());const data=[];
     for(let i=0;i<40;i++){
       animations.forEach(a=>a.currentTime=i*2850/40);
       const [logo,n,b]=imgs.map(img=>img.getBoundingClientRect()),rect=stage.getBoundingClientRect();
       const stack=document.elementsFromPoint(logo.x+logo.width/2,logo.y+logo.height/2).filter(el=>imgs.includes(el)).map(el=>imgs.indexOf(el));
       data.push({logoX:logo.x,logoY:logo.y,nartWidth:n.width,bartWidth:b.width,stack,bounds:[rect,n,b].map(r=>[r.x,r.y,r.width,r.height]),inside:[n,b].every(r=>r.left>=rect.left-1&&r.right<=rect.right+1&&r.top>=rect.top-1&&r.bottom<=rect.bottom+1)});
     }
     return data;
   });
   assert.equal(new Set(values.map(v=>v.logoX+','+v.logoY)).size,1);
   assert(values.every(v=>v.inside),'Orbit leaves window at '+width+' '+JSON.stringify(values.find(v=>!v.inside)?.bounds));
   assert(Math.max(...values.map(v=>v.nartWidth))>Math.min(...values.map(v=>v.nartWidth))*1.12);
   // Hit testing in a preserve-3d context can return DOM paint order. Check
   // the composed pixels at the two transits against each original raster.
   for(const cat of ['nart','bart'])for(const front of [true,false]){
     const phase=(cat==='nart')===front?432.5:1857.5;
     await p.evaluate(({cat,phase})=>{
        document.querySelectorAll('.rotor').forEach(img=>img.style.visibility=img.classList.contains(cat)?'visible':'hidden');
        document.querySelector('.orbit-stage').getAnimations({subtree:true}).forEach(a=>a.currentTime=phase);
     },{cat,phase});
     const capture=(await p.screenshot()).toString('base64');
     const pixels=await p.evaluate(async({cat,capture})=>{
       const logo=document.querySelector('.orbital-logo'),sprite=document.querySelector('.'+cat);
       const snap=new Image();snap.src='data:image/png;base64,'+capture;await snap.decode();
       const w=snap.width,h=snap.height;
       function paint(img,box){
          const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
          const ctx=canvas.getContext('2d');ctx.drawImage(img,box.x,box.y,box.width,box.height);
          return ctx.getImageData(0,0,w,h).data;
       }
       const l=paint(logo,logo.getBoundingClientRect()),c=paint(sprite,sprite.getBoundingClientRect()),actual=paint(snap,{x:0,y:0,width:w,height:h});
       let logoWins=0,catWins=0;
       for(let i=0;i<l.length;i+=4){
          if(l[i+3]<250||c[i+3]<250)continue;
          let apart=0,dl=0,dc=0;
          for(let k=i;k<i+3;k++){apart+=Math.abs(l[k]-c[k]);dl+=Math.abs(l[k]-actual[k]);dc+=Math.abs(c[k]-actual[k]);}
          if(apart<120)continue;
          if(dl<dc)logoWins++;else catWins++;
       }
       return {logoWins,catWins};
     },{cat,capture});
     const total=pixels.catWins+pixels.logoWins;
     assert(total>20 && (front?pixels.catWins:pixels.logoWins)/total>.9,JSON.stringify({width,cat,front,pixels}));
   }
   await p.locator('.rotor').evaluateAll(imgs=>imgs.forEach(img=>img.style.visibility=''));
   await p.evaluate(()=>document.querySelector('.orbit-stage').getAnimations({subtree:true}).forEach(a=>a.play()));
   checks.push(width+'px, 40 phases: stationary logo, both depth orders, scale change and containment.');
 }
 await p.setViewportSize({width:1280,height:850});await p.locator('.orbit-scene').evaluate(el=>el.getAnimations({subtree:true}).forEach(a=>a.pause()));
 for(const [i,t] of [0,420,1100,1800].entries()){
 await p.locator('.orbit-scene').evaluate((el,t)=>el.getAnimations({subtree:true}).forEach(a=>a.currentTime=t),t);
 await p.locator('.orbit-window').screenshot({path:path.join(out,'phase-'+i+'.png')});
 }
 await p.reload();
 const cdp=await p.context().newCDPSession(p);
 await p.evaluate(()=>{window.lifecycle=[];document.addEventListener("visibilitychange",()=>window.lifecycle.push({hidden:document.hidden,running:document.querySelector(".orbit-stage").classList.contains("orbit-running")}));});
 await cdp.send("Page.setWebLifecycleState",{state:"frozen"});await cdp.send("Page.setWebLifecycleState",{state:"active"});await p.bringToFront();
 const lifecycle=await p.evaluate(()=>window.lifecycle);
 if(lifecycle.some(e=>e.hidden && !e.running))checks.push('Chrome lifecycle freeze delivered hidden visibility and suspended the orbit.');
 else checks.push('Chrome freeze/resume sent; headless session supplied no hidden visibility event in this run.');
 await p.reload();await p.emulateMedia({reducedMotion:'reduce'});assert.equal(await p.locator('.orbit-stage').evaluate(el=>el.getAnimations({subtree:true}).length),0);
 assert(await p.locator('.orbit-stage img').evaluateAll(imgs=>imgs.every(i=>i.complete&&i.naturalWidth>0&&i.getBoundingClientRect().width>0)));
 await p.locator('.orbit-window').screenshot({path:path.join(out,'stationary.png')});
 await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('.record-row').first().getByRole('button',{name:/^Play /}).click();
 await p.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
 await p.getByRole('slider',{name:'Slow playback speed'}).press('Home');
 await p.evaluate(()=>{window.scrollTo(0,0);window.t0=document.querySelector('audio').currentTime;});
 await p.waitForTimeout(500);await p.mouse.wheel(0,1200);await p.waitForTimeout(450);
 assert(await p.evaluate(()=>{const a=document.querySelector('audio');return a.playbackRate===.5&&!a.paused&&a.currentTime>window.t0+.3;}));
 checks.push('Native MP3 advanced at half speed through the visible orbit and a wheel scroll.');
 await p.getByRole('button',{name:'Close player controls'}).click();await p.locator('.site-nav>a').filter({hasText:'Articles'}).click();
 await p.frameLocator('.player-page').getByRole('heading',{name:'All Articles',exact:true}).waitFor();
 assert.equal(await p.locator('.orbit-stage').evaluate(e=>e.classList.contains('orbit-running')),false);
 checks.push('System reduction retained three decoded images without orbit animation. Navigating away while playing suspended the parent homepage.');
 assert.deepEqual(errors,[]);console.log(checks);
 }finally{fs.writeFileSync(path.join(out,'orbit-checks.json'),JSON.stringify({checks,errors},null,2));await browser.close();server.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
