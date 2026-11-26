const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { database, asUser, ids } = require('./local-db.cjs');
const { server, openVisitor } = require('./runtime.cjs');
const { owner, seed, rpc } = require('../radio/station.cjs');

(async () => {
    const db = await database();
    const errors = [];
    let browser, uploadServer;
    try {
        await seed(db);
        const [reader, artist] = ids;
        await db.query("insert into articles(id,author,title,body,published) values($1,$2,'Rehearsal notes',repeat('Hello music. ',12),true)", [reader, artist]);
        await new Promise(done => server.listen(0,'127.0.0.1',done));
        const origin = 'http://127.0.0.1:' + server.address().port;
        const base = origin + '/html/';
        browser = await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
        const guest = await openVisitor(browser,db,errors,null,360);
        const phone = await openVisitor(browser,db,errors,reader,360);
        const desktop = await openVisitor(browser,db,errors,reader,1280);
        const button = (p,name) => p.getByRole('button',{name,exact:true});

        await guest.goto(base+'music.html');
        await guest.getByLabel('Song, artist or release').fill('@CrEaToR');
        await button(guest,'Search').click();
        await guest.locator('.record-row').first().waitFor();
        assert.equal(await guest.locator('.record-row').count(),3);
        await guest.locator('.record-name').first().click();
        await guest.goBack();
        assert.equal(await guest.getByLabel('Song, artist or release').inputValue(),'@CrEaToR');
        await guest.goto(base+'music.html?q=qa+release');
        await guest.locator('.record-row').first().waitFor();
        assert.equal(await guest.locator('.record-row').count(),3);
        await guest.goto(base+'music.html?q=%25');
        await guest.getByText(/No music matched/).waitFor();
        await button(guest,'Clear').click();
        await button(guest,'Play GrassCats Pop').click();
        await guest.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
        await button(guest,'Close player controls').click();
        await guest.getByLabel('Song, artist or release').fill('GrassCats');
        await button(guest,'Search').click();
        await guest.frameLocator('.player-page').locator('.record-name').getByText('GrassCats Pop').waitFor();
        assert(await guest.evaluate(()=>!document.querySelector('audio').paused));
        console.log('PASS mobile search by handle, release and title, literal wildcard, Back, clear and persistent playback');

        const detail = base+'article.html?id='+reader;
        await phone.goto(base+'account.html');
        const key='mc-bookmark:'+reader+':'+reader;
        await phone.evaluate(k=>localStorage.setItem(k,'1'),key);
        await phone.goto(detail);
        await button(phone,'Remove bookmark').waitFor();
        await desktop.goto(base+'articles.html');
        await desktop.getByText('Saved for later',{exact:true}).click();
        await desktop.locator('details[open]').getByRole('link',{name:'Rehearsal notes'}).click();
        await button(desktop,'Remove bookmark').click();
        await button(desktop,'Save for later').waitFor();
        await phone.evaluate(k=>localStorage.setItem(k,'1'),key);
        await phone.reload();
        await phone.locator('.article-views button[aria-pressed="false"]:enabled').first().waitFor();
        assert.equal(await phone.locator('.article-views button').first().innerText(),'Save for later');
        await button(phone,'Save for later').click();
        await button(phone,'Remove bookmark').waitFor();
        await desktop.reload();
        await button(desktop,'Remove bookmark').waitFor();
        const others = await asUser(db,artist,tx=>tx.query('select * from public.article_bookmarks'));
        assert.equal(others.rows.length,0);
        console.log('PASS legacy bookmark import, separate device contexts, explicit removal, re-save and account privacy');

        const admin=(action,args)=>rpc(db,owner,'radio_manage($1,$2)',[action,args]);
        await admin('enqueue',{id:reader,timing:'next'});
        const state=()=>rpc(db,null,'radio_state()');
        assert.equal((await state()).up_next,'Fixture recording 1');
        await phone.goto(base+'index.html');
        await phone.locator('.radio-widget').scrollIntoViewIfNeeded();
        await phone.locator('[data-up-next]').getByText('Up next: Fixture recording 1').waitFor();
        await phone.goto(base+'radio.html');
        await phone.locator('[data-up-next]').getByText('Up next: Fixture recording 1').waitFor();
        await button(phone,'Vote').first().click();
        await phone.getByText('1 total vote',{exact:true}).waitFor();
        assert(!/1 votes/.test(await phone.locator('[data-votes]').innerText()));
        const due=new Date(Date.now()+12000).toISOString();
        await admin('enqueue',{id:artist,timing:'exact',due});
        assert.equal((await state()).up_next,'Fixture recording 2');
        console.log('PASS upcoming broadcast on both receivers, scheduled interruption priority and single vote labels');

        // A slow local storage endpoint exercises native browser upload events.
        let received=0;
        uploadServer=http.createServer((req,res)=>{
            res.setHeader('Access-Control-Allow-Origin',origin);
            res.setHeader('Access-Control-Allow-Headers','authorization,content-type');
            if(req.method==='OPTIONS')return res.writeHead(204).end();
            assert.equal(req.headers.authorization,'Bearer local-test');
            req.on('data',chunk=>{received+=chunk.length;req.pause();setTimeout(()=>req.resume(),8);});
            req.on('end',()=>res.writeHead(200,{'Content-Type':'application/json'}).end('{"Key":"ok"}'));
        });
        await new Promise(done=>uploadServer.listen(0,'127.0.0.1',done));
        const target='http://127.0.0.1:'+uploadServer.address().port+'/upload';
        const upload=await desktop.evaluate(async target=>{
            const progress=[];
            songUploadProgress.set(target,value=>progress.push(value));
            const bytes=new Uint8Array(8*1024*1024);
            try{
                const response=await fetchWithSongProgress(target,{method:'POST',body:bytes,headers:{Authorization:'Bearer local-test'}});
                return {progress,status:response.status};
            }finally{songUploadProgress.delete(target);}
        },target);
        assert.equal(upload.status,200);
        assert.equal(received,8*1024*1024);
        assert(upload.progress.some(value=>value>0 && value<1));
        assert.equal(upload.progress.at(-1),1);
        assert.deepEqual(errors,[]);
        console.log('PASS real intermediate upload progress, bytes received, authorization header and completion');
    } finally {
        await browser?.close();
        uploadServer?.close();
        server.close();
        await db.close();
    }
})().catch(error=>{console.error(error);process.exitCode=1;});
