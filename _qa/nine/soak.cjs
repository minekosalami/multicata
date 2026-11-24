const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright'),{database}=require('../next/local-db.cjs'),{server,openVisitor}=require('../next/runtime.cjs');
(async()=>{
    const db=await database(),browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
    const seconds=Number(process.env.MC_SOAK_SECONDS||300),errors=[],samples=[];
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    try{
        const p=await openVisitor(browser,db,errors,null,390);
        await p.goto('http://127.0.0.1:'+server.address().port+'/html/music.html');
        const rows=p.locator('.record-row');
        for(let i=0;i<Math.ceil(seconds/100);i++)await rows.nth(1+i%2).getByRole('button',{name:/^Queue /}).click();
        await p.getByRole('button',{name:'Play GrassCats Pop',exact:true}).click();
        await p.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
        await p.evaluate(()=>{
            const a=document.querySelector('audio');window.soak={a,start:a.currentTime,finished:0,events:[]};
            for(const event of ['pause','emptied','loadstart','seeking','ended','error','stalled']){
                a.addEventListener(event,()=>{soak.events.push({event,at:performance.now(),time:a.currentTime});if(event==='ended')soak.finished+=a.duration;},true);
            }
            // Capture the duration before the player's target listener selects the next source.
        });
        await p.getByRole('button',{name:'Close player controls'}).click();
        await p.locator('.site-nav a').filter({hasText:'Home'}).click();
        const view=p.frameLocator('.player-page'),start=Date.now();
        for(let i=0;Date.now()-start<seconds*1000;i++){
            const name=i%2?'Home':'Articles';
            await view.locator('.site-nav a').getByText(name,{exact:true}).click();
            await view.locator(i%2?'.record-row':'[data-article-list] .article-list').first().waitFor();
            await p.waitForTimeout(4800);
            samples.push(await p.evaluate(()=>({t:soak.a.currentTime,wall:performance.now(),src:soak.a.currentSrc,paused:soak.a.paused,same:soak.a===document.querySelector('audio')})));
        }
        const stats=await p.evaluate(()=>({events:soak.events,advanced:soak.finished+soak.a.currentTime-soak.start}));
        const wall=(Date.now()-start)/1000;
        fs.writeFileSync(path.join(__dirname,'soak.json'),JSON.stringify({wall,stats,samples,errors},null,2));
        assert(samples.every(s=>s.same&&!s.paused));assert(stats.advanced>=wall*.98);
        assert(!stats.events.some(e=>['error','stalled','seeking'].includes(e.event)));assert.deepEqual(errors,[]);
    }finally{await browser.close();server.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
