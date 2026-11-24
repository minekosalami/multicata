const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const engines=require('playwright'),{database,ids}=require('../next/local-db.cjs');
const {openVisitor,server}=require('../next/runtime.cjs');
(async()=>{
    const label=process.argv[2]||'local';
    if(!/^[\w-]+$/.test(label))throw Error('Invalid round name');
    const out=path.join(__dirname,label);
    fs.mkdirSync(out,{recursive:true});
    const db=await database(), results=[];
    await new Promise(r=>server.listen(0,'127.0.0.1',r));
    const base='http://127.0.0.1:'+server.address().port+'/html/';
    try{
        for(const n of [1,2])await db.query("insert into articles(title,author,body,published) values($1,$2,repeat('Local QA. ',15),true)",['QA article '+n,ids[n]]);
        for(const name of (process.env.MC_ENGINES||'chromium,firefox,webkit').split(',')){
            const checks=[],errors=[],result={name,checks,errors};results.push(result);
            let browser;
            try{
                browser=await engines[name].launch({timeout:20000,...(name==='chromium'?{channel:'chrome'}:{})});
                result.version=browser.version();
                const p=await openVisitor(browser,db,errors,null,390);
                async function check(task,fn){
                    try{const observation=await fn();checks.push({task,pass:true,observation});}
                    catch(e){checks.push({task,pass:false,message:e.message.slice(0,450)});process.exitCode=1;}
                }
                await check('Guest gallery, articles, keyboard menu and reduced motion',async()=>{
                    await p.emulateMedia({reducedMotion:'reduce'});await p.goto(base+'index.html');
                    assert.equal(await p.locator('.rotor').first().evaluate(el=>getComputedStyle(el).animationName),'none');
                    await p.locator('.member-menu summary').focus();await p.keyboard.press('Enter');
                    await p.getByRole('link',{name:'Characters',exact:true}).click();
                    await p.getByRole('button',{name:'Nart',exact:true}).click();
                    await p.goBack();await p.locator('.site-nav a').filter({hasText:'Articles'}).click();
                    await p.locator('.article-list h3 a').first().click();await p.locator('.article-prose').waitFor();
                    return await p.locator('h1').innerText();
                });
                await check('Streaming MP3 after a failed source',async()=>{
                    // Native WebKit media loads can bypass browser request routing.
                    // Supply real loopback URLs for both the 404 and the playable MP3.
                    await p.route('**/js/backend.js',async r=>{
                        const response=await r.fetch();
                        const setup="\nconst assetBucket=supabaseClient.storage.from;supabaseClient.storage.from=name=>{const bucket=assetBucket(name);if(name==='creator-music')bucket.getPublicUrl=()=>({data:{publicUrl:new URL('../audio/qa-missing.mp3',location.href).href}});return bucket;};";
                        await r.fulfill({response,body:await response.text()+setup});
                    });
                    await p.goto(base+'music.html');
                    await p.locator('.record-row').nth(1).getByRole('button',{name:/^Play /}).click();
                    await p.getByText('Recording could not be loaded.',{exact:true}).waitFor();
                    await p.getByRole('button',{name:'Close player controls'}).click();
                    await p.getByRole('button',{name:'Play GrassCats Pop',exact:true}).click();
                    await p.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1,null,{timeout:6000});
                    return 'Advanced on second track';
                });
                const writer=await openVisitor(browser,db,errors,ids[1],360);
                await check('Invalid upload retains title and enables retry',async()=>{
                    await writer.goto(base+'account.html');await writer.getByText('Publish music',{exact:true}).click();
                    await writer.locator('[name=title]').fill('QA rejected recording');
                    await writer.locator('[name=recording]').setInputFiles({name:'sample.mp3',mimeType:'audio/mpeg',buffer:Buffer.from('invalid audio')});
                    await writer.getByRole('button',{name:'Publish track'}).click();
                    await writer.getByText('The file contents do not match the .mp3 extension.',{exact:true}).waitFor();
                    assert.equal(await writer.locator('[name=title]').inputValue(),'QA rejected recording');
                    assert(await writer.getByRole('button',{name:'Publish track'}).isEnabled());
                });
                await check('Retry article list after second author lookup fails',async()=>{
                    await p.context().close();
                    const q=await openVisitor(browser,db,errors,null);
                    await q.route('**/js/backend.js',async r=>{
                        const res=await r.fetch();
                        const fault="\nconst from=supabaseClient.from;let authorLookups=0;supabaseClient.from=(t)=>{const c=from(t);if(t==='profiles' && ++authorLookups===2)c.maybeSingle=async()=>({error:{message:'QA interrupted lookup'}});return c;};";
                        await r.fulfill({response:res,body:await res.text()+fault});
                    });
                    await q.goto(base+'articles.html');await q.getByText('Try loading articles again',{exact:true}).click();
                    await q.waitForFunction(()=>document.querySelector('.article-list')?.textContent.includes('QA article 1')&&document.querySelector('.article-list')?.textContent.includes('QA article 2'));
                    const titles=await q.locator('.article-list h3').allTextContents();
                    assert.equal(titles.length,2,titles.join(', '));return titles;
                });
            }catch(e){result.blocked=e.message.slice(0,450);process.exitCode=1;}
            finally{fs.writeFileSync(path.join(out,name+'.json'),JSON.stringify(result,null,2));if(browser)await browser.close();}
        }
    }finally{fs.writeFileSync(path.join(out,'engines.json'),JSON.stringify(results,null,2));server.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
