const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { chromium } = require('playwright');
const { database, ids } = require('../next/local-db.cjs');
const { server, openVisitor } = require('../next/runtime.cjs');

async function main() {
    const round = process.argv[2] || 'local';
    if (!/^[\w-]+$/.test(round)) throw Error('Use a simple round name');
    const out = path.join(__dirname,round);
    fs.mkdirSync(out,{recursive:true});
    const db = await database();
    const browser = await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
    const errors=[], checks=[], layout=[], links=new Set();
    const evidence={round,browser:browser.version(),node:process.version,os:os.release(),checks,layout,errors};
    const record=(name,pass,observed)=>checks.push({name,pass,observed});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port+'/html/';
    try {
        const id=ids[1], title='QA listening notes';
        await db.query('insert into articles(id,author,title,body,published) values($1,$2,$3,$4,true)',[id,ids[0],title,'Local listening notes. '.repeat(15)]);
        const guest=await openVisitor(browser,db,errors,null,360);
        // Independently fail only the auxiliary vote service after the public article query succeeds.
        await guest.route('**/js/backend.js',async route=>{
            const response=await route.fetch();
            await route.fulfill({response,body:await response.text()+
                "\nconst fixtureRpc=supabaseClient.rpc;supabaseClient.rpc=(name,args)=>name==='writing_vote_counts'?Promise.resolve({error:{message:'QA offline'}}):fixtureRpc(name,args);"});
        });
        await guest.goto(base+'article.html?id='+id);
        await guest.waitForFunction(()=>document.body.innerText.includes('could not be loaded')||document.querySelector('.discussion'));
        const articleText=await guest.locator('#article-detail').innerText();
        record('Public article survives vote service outage',articleText.includes(title)&&articleText.includes('Local listening notes'),articleText.slice(0,180));
        await guest.screenshot({path:path.join(out,'article-outage.jpg')});
        await guest.unroute('**/js/backend.js');
        const writer=await openVisitor(browser,db,errors,ids[0],390);
        await writer.goto(base+'writing.html');
        await writer.getByLabel('Title',{exact:true}).fill('First unfinished idea');
        await writer.reload();
        await writer.getByText('Restore unfinished writing').waitFor();
        await writer.getByLabel('Title',{exact:true}).fill('Replacement idea');
        await writer.getByLabel('Article text').fill('This is a disposable draft. '.repeat(5));
        await writer.getByRole('button',{name:'Save draft',exact:true}).click();
        await writer.getByText('Read article',{exact:true}).waitFor();
        const stale=await writer.getByText('Restore unfinished writing').count();
        record('Successful save retires stale recovery prompt',!stale,{stale});
        await writer.screenshot({path:path.join(out,'editor-saved.jpg')});
        // Enumerate actual rendered page links and check static local destinations.
        for(const route of fs.readdirSync('html').filter(f=>f.endsWith('.html'))){
            await guest.goto(base+route);
            for(const href of await guest.locator('a[href]').evaluateAll(a=>a.map(el=>el.href)))links.add(href);
        }
        evidence.brokenLinks=[...links].filter(href=>{const u=new URL(href);return u.origin===new URL(base).origin&&!fs.existsSync(path.join(process.cwd(),decodeURIComponent(u.pathname)));});
        record('Local link destinations exist',!evidence.brokenLinks.length,evidence.brokenLinks);
        for(const width of [320,360,390,768,1024,1280,1920]){
            await guest.setViewportSize({width,height:850});
            for(const route of ['index.html','articles.html','music.html','characters.html','profile.html?id='+ids[1]]){
                await guest.goto(base+route);
                const overflow=await guest.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
                layout.push({width,route,overflow});
            }
        }
        await guest.setViewportSize({width:768,height:850});
        await guest.goto(base+'index.html');
        await guest.evaluate(()=>document.documentElement.style.zoom='200%');
        evidence.zoomOverflow=await guest.evaluate(()=>document.documentElement.scrollWidth-innerWidth);
        await guest.screenshot({path:path.join(out,'home-zoom.jpg')});
        await guest.goto(base+'index.html');await guest.screenshot({path:path.join(out,'home.jpg')});
        await guest.goto(base+'music.html');await guest.getByRole('button',{name:'Play GrassCats Pop',exact:true}).click();
        await guest.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
        await guest.getByRole('button',{name:'Close player controls'}).click();
        await guest.evaluate(()=>{const a=document.querySelector('audio');window.trace={audio:a,start:a.currentTime,events:[]};for(const e of ['loadstart','emptied','pause','seeking','stalled','error'])a.addEventListener(e,()=>window.trace.events.push(e));});
        await guest.locator('.site-nav a').filter({hasText:'Home'}).click();
        const frame=guest.frameLocator('.player-page');
        const cdp=await guest.context().newCDPSession(guest);
        await cdp.send('Performance.enable');
        await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
        await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:300000,uploadThroughput:125000});
        const requests=[];guest.on('request',r=>requests.push(new URL(r.url()).pathname));
        const metrics=async()=>Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));
        const before=await metrics(), nav=[];
        const duration=Number(process.env.MC_LISTEN_SECONDS||65);
        const deadline=Date.now()+duration*1000;
        for(let i=0;Date.now()<deadline;i++){
            const article=i%2===0;
            const start=Date.now();
            await frame.locator('.site-nav a').getByText(article?'Articles':'Home',{exact:true}).click();
            await frame.locator(article?'[data-article-list] .article-list article':'.record-row').first().waitFor();
            nav.push(Date.now()-start);
            await guest.waitForTimeout(1250);
        }
        const after=await metrics();
        const playback=await guest.evaluate(()=>{const a=document.querySelector('audio');return {advance:a.currentTime-trace.start,same:a===trace.audio,events:trace.events,paused:a.paused};});
        evidence.performance={cycles:nav.length,medianNavigationMs:nav.sort((a,b)=>a-b)[Math.floor(nav.length/2)],requests:requests.length,wallSeconds:after.Timestamp-before.Timestamp,taskSeconds:after.TaskDuration-before.TaskDuration,heapMiB:[before.JSHeapUsedSize,after.JSHeapUsedSize].map(n=>Math.round(n/1048576)),listeners:[before.JSEventListeners,after.JSEventListeners],playback};
        record('Sustained audio while navigating',playback.same&&!playback.paused&&playback.advance>=duration*.9&&!playback.events.length,playback);
        // Compare live resources after explicit GC, rather than treating detached documents awaiting GC as a leak.
        await cdp.send('HeapProfiler.collectGarbage');
        evidence.postCollection=await cdp.send('Memory.getDOMCounters');
        if(layout.some(x=>x.overflow>1)||errors.length||checks.some(c=>!c.pass))process.exitCode=1;
    }finally{
        fs.writeFileSync(path.join(out,'observations.json'),JSON.stringify(evidence,null,2));
        await browser.close();server.close();await db.close();
    }
}
main().catch(e=>{console.error(e);process.exitCode=1});
