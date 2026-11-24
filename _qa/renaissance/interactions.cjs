const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {database,ids:[reader,writer,admin]}=require('../next/local-db.cjs');
const {server,openVisitor}=require('../next/runtime.cjs');
(async()=>{
 const db=await database();
 const browser=await chromium.launch({channel:process.env.MULTICATA_BROWSER || 'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/html/',errors=[],checks={},out=process.env.MULTICATA_INTERACTIONS_DIR || path.join(__dirname,'final');
 fs.mkdirSync(out,{recursive:true});
 const snap=(p,file)=>p.screenshot({path:path.join(out,file+'.png')});
 const act=(p,name)=>p.getByRole('button',{name,exact:true});
 try{
 await db.query('insert into article_moderators values($1)',[admin]);
 const w=await openVisitor(browser,db,errors,writer),a=await openVisitor(browser,db,errors,admin),r=await openVisitor(browser,db,errors,reader),g=await openVisitor(browser,db,errors,null);
 await w.goto(base+'writing.html');await w.getByLabel('Title',{exact:true}).fill('Local editorial proof');
 await w.getByLabel('Article text').fill('## Listening notes\n\nA **loud** opening and a _quiet_ ending. [Catalogue](https://example.test/). <em>Literal markup</em>');
 await act(w,'Save draft').click();await w.getByText('Read article',{exact:true}).waitFor();
 const edit=w.url(),article=await w.getByText('Read article',{exact:true}).getAttribute('href');
 await g.goto(base+article);await g.getByText('Article unavailable.').waitFor();
 await w.getByText('Add an image',{exact:true}).click();await w.getByLabel('Image description').fill('Existing character artwork');await w.getByLabel('Image file').setInputFiles('images/nart.jpeg');
 await w.getByLabel('Article text').press('Control+End');await act(w,'Insert image').click();await w.getByText('Image inserted. Save your changes.').waitFor();
 await act(w,'Preview').click();await w.locator('.article-prose img').waitFor();await snap(w,'writing-desk');
 await act(w,'Publish').click();await act(w,'Unpublish').waitFor();
 await a.goto(base+'articles.html');await act(a,'Approve').click();await a.getByText('Featured',{exact:true}).waitFor();
 await g.goto(base+'articles.html?view=featured');await g.getByRole('link',{name:'Local editorial proof'}).waitFor();
 await g.goto(base+article);await g.getByRole('heading',{name:'Local editorial proof'}).waitFor();
 assert.equal(await g.locator('.article-prose strong').textContent(),'loud');assert.equal(await g.locator('.article-prose em').count(),1);await g.getByText('<em>Literal markup</em>',{exact:false}).waitFor();await g.waitForFunction(()=>document.querySelector('.article-prose img')?.naturalWidth>0);
 await snap(g,'published-article');await g.goto(base+'articles.html');await g.getByRole('link',{name:'Local editorial proof'}).waitFor();
 await g.goto(base+'index.html');await g.locator('.article-thumb').scrollIntoViewIfNeeded();await g.waitForFunction(()=>document.querySelector('.article-thumb')?.naturalWidth>0);
 await r.goto(base+'index.html');const firstTrack=r.locator('.record-row').first();
 await act(firstTrack,'Like · 0').click();await act(firstTrack,'Like · 1').waitFor();
 await act(firstTrack,'♡ Favorite').click();await act(firstTrack,'♥ Saved').waitFor();
 checks.home='Published image decoded in the homepage preview. Inline Like and Favorite persisted and repainted.';
 await r.goto(base+article);await r.getByLabel('Your message').fill('Disposable reader comment');await act(r,'Comment').click();await act(r,'Reply').waitFor();
 assert.equal(await r.getByText(/^View replies/).count(),0);
 const articleVote=r.locator('#article-detail > .reaction-bar');
 await articleVote.getByRole('button',{name:/^Like/}).click();await articleVote.getByRole('button',{name:/Like.*1/}).waitFor();
 await articleVote.getByRole('button',{name:/^Dislike/}).click();await articleVote.getByRole('button',{name:/Dislike.*1/}).waitFor();
 await articleVote.getByRole('button',{name:/^Dislike/}).click();await articleVote.getByRole('button',{name:/Dislike.*0/}).waitFor();
 await w.goto(base+article);await act(w,'Reply').click();await w.locator('.comment-form textarea').fill('Disposable author reply');await act(w,'Send reply').click();await w.locator('.reply').waitFor();
 await r.goto(base+'notices.html');await r.getByText('@creator replied').click();await r.getByText('Disposable author reply').waitFor();
 await r.locator('.reply').getByRole('button',{name:/^Like/}).click();
 await r.locator('.reply').getByRole('button',{name:/Like.*1/}).waitFor();
 await r.reload();await r.getByText("View replies (1)").waitFor();
 await w.goto(edit);await act(w,'Unpublish').click();await act(w,'Publish').waitFor();await g.goto(base+article);await g.getByText('Article unavailable.').waitFor();
 await g.goto(base+'articles.html?view=featured');await g.getByText('No featured articles yet.').waitFor();
 checks.editorial='Draft, publish, approve, featured listing, images, comments and unpublishing passed.';
 await g.goto(base+'music.html');await g.locator('.player-toggle').click();
 const deskDial=g.getByRole('slider',{name:'Slow playback speed'}),bounds=await deskDial.boundingBox();
 const dx=bounds.x+bounds.width/2,dy=bounds.y+bounds.height/2;
 await g.mouse.move(dx+16,dy);await g.mouse.down();
 for(const angle of [65,40,15,-10,-35,-60,-90])await g.mouse.move(dx+17*Math.sin(angle*Math.PI/180),dy-17*Math.cos(angle*Math.PI/180));
 await g.mouse.up();assert(Math.abs(Number(await deskDial.getAttribute('aria-valuenow'))-.67)<.025);
 await g.mouse.click(dx,dy-19);assert.equal(await deskDial.getAttribute('aria-valuenow'),'0.75');
 await deskDial.dblclick();assert.equal(await deskDial.getAttribute('aria-valuenow'),'1.00');
 checks.mouse='Desktop counterclockwise drag reduced rate to approximately 0.67, and tapping twelve o’clock selected 0.75.';
 const p=await openVisitor(browser,db,errors,reader,360);
 await p.goto(base+'music.html');const rows=p.locator('.record-row');await rows.nth(1).getByRole('button',{name:/^Queue /}).tap();await rows.first().getByRole('button',{name:/^Play /}).tap();
 await p.waitForFunction(()=>document.querySelector('audio')?.currentTime>.15);
 await p.evaluate(()=>{window.testLoads=0;document.querySelector('audio').addEventListener('loadstart',()=>window.testLoads++);});
 const dial=p.getByRole('slider',{name:'Slow playback speed'});await dial.focus();await dial.press('Home');assert.equal(await dial.getAttribute('aria-valuenow'),'0.50');await dial.press('ArrowUp');assert.equal(await dial.getAttribute('aria-valuenow'),'0.51');
 await dial.press('End');const box=await dial.boundingBox(),cx=box.x+box.width/2,cy=box.y+box.height/2;
 const cdp=await p.context().newCDPSession(p);
 for(const [i,angle] of [135,90,45,0,-45,-90,-135].entries()){
 const rad=angle*Math.PI/180;await cdp.send('Input.dispatchTouchEvent',{type:i?'touchMove':'touchStart',touchPoints:[{x:cx+Math.sin(rad)*19,y:cy-Math.cos(rad)*19,id:1}]});
 }
 await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await p.waitForFunction(()=>document.querySelector('audio').playbackRate===.5);
 assert.equal(await p.evaluate(()=>document.querySelector('audio').preservesPitch),false);
 const elapsed=await p.evaluate(async()=>{const audio=document.querySelector('audio'),t=audio.currentTime,clock=performance.now();await new Promise(r=>setTimeout(r,800));return (audio.currentTime-t)/((performance.now()-clock)/1000);});
 assert(Math.abs(elapsed-.5)<.12);assert.equal(await p.evaluate(()=>window.testLoads),0);
 await snap(p,'slow-dial-touch');await act(p,'Next').tap();await p.waitForFunction(()=>document.querySelector('audio').currentTime>.1);
 assert.equal(await p.locator('audio').evaluate(el=>el.playbackRate),.5);
 await act(p,'Close player controls').tap();await p.locator('.site-nav a').filter({hasText:'Articles'}).tap();await p.frameLocator('.player-page').getByRole('heading',{name:'All Articles',exact:true}).waitFor();
 assert.equal(await p.locator('audio').evaluate(el=>el.playbackRate),.5);
 await p.reload();await p.locator('.player-toggle').tap();assert.equal(await p.locator('audio').evaluate(el=>el.playbackRate),.5);
 // A temporary calibration tone measures rendered pitch. It never enters the catalogue.
 const tonal=await p.evaluate(async()=>{
    const a=document.querySelector('audio'),rate=48000,n=rate*8,bytes=new ArrayBuffer(44+n*2),v=new DataView(bytes);
    function label(i,t){for(const ch of t)v.setUint8(i++,ch.charCodeAt(0));}
    label(0,'RIFF');v.setUint32(4,36+2*n,true);label(8,'WAVE');label(12,'fmt ');v.setUint32(16,16,true);
    v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    label(36,'data');v.setUint32(40,n*2,true);
    for(let i=0;i<n;i++)v.setInt16(44+i*2,Math.round(6000*Math.sin(2*Math.PI*440*i/rate)),true);
    const object=URL.createObjectURL(new Blob([bytes],{type:'audio/wav'}));
    const ac=new AudioContext(),analyser=ac.createAnalyser();analyser.fftSize=8192;analyser.smoothingTimeConstant=0;
    ac.createMediaElementSource(a).connect(analyser);analyser.connect(ac.destination);
    try{
       a.src=object;await ac.resume();await a.play();
       const hz=async key=>{
         const d=document.querySelector('.slow-dial');d.dispatchEvent(new KeyboardEvent('keydown',{key,bubbles:true}));
         await new Promise(done=>setTimeout(done,460));
         const levels=new Float32Array(analyser.frequencyBinCount);analyser.getFloatFrequencyData(levels);
         const bin=levels.indexOf(Math.max(...levels));return bin*ac.sampleRate/analyser.fftSize;
       };
       return {normalHz:await hz('End'),slowHz:await hz('Home')};
    }finally{a.pause();URL.revokeObjectURL(object);await ac.close();}
 });
 assert(Math.abs(tonal.normalHz-440)<7&&Math.abs(tonal.slowHz-220)<7);
 checks.slow={tonal,touchArcDegrees:270,observedMediaSecondsPerSecond:elapsed,loadsWhileTurning:0,rateAfterNextAndReload:.5,preservesPitch:false};
 await r.goto(base+'index.html');const field=r.locator('.rotor').first();
 const motion=()=>field.evaluate(n=>getComputedStyle(n).animationName);
 assert.equal(await motion(),'revolve');await r.locator('.member-menu summary').click();await act(r,'Reduce effects').click();assert.equal(await motion(),'none');await r.reload();assert.equal(await motion(),'none');
 await r.locator('.member-menu summary').click();await act(r,'Reduce effects').click();await r.keyboard.press('Escape');await r.emulateMedia({reducedMotion:'reduce'});assert.equal(await motion(),'none');
 await r.emulateMedia({reducedMotion:'no-preference'});await r.locator('.member-menu summary').focus();await r.keyboard.press('Enter');await r.keyboard.press('Escape');assert(await r.locator('.member-menu summary').evaluate(n=>n===document.activeElement));
 checks.motion='Enabled, disabled, persisted and OS-reduced modes; Escape restored menu focus.';
 for(const enabled of [true,false]){
 await r.emulateMedia({reducedMotion:enabled?'no-preference':'reduce'});
 checks['frames'+(enabled?'Animated':'Still')]=await r.evaluate(()=>new Promise(resolve=>{
 const times=[];let last;function frame(now){if(last)times.push(now-last);last=now;if(times.length<90)requestAnimationFrame(frame);else{times.sort((a,b)=>a-b);resolve({medianMs:times[45],p95Ms:times[85],maxMs:times[89]});}}requestAnimationFrame(frame);
 }));
 }
 assert.deepEqual(errors,[]);console.log(checks);
 }finally{fs.writeFileSync(path.join(out,'interaction-results.json'),JSON.stringify({checks,errors},null,2));await browser.close();server.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
