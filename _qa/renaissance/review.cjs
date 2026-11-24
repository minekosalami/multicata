const {chromium}=require('playwright');
const {database,ids}=require('../next/local-db.cjs');
const {server,openVisitor}=require('../next/runtime.cjs');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
(async()=>{
 const stage=process.argv[2],out=path.join(process.env.MULTICATA_REVIEW_DIR || __dirname,stage);
 fs.mkdirSync(out,{recursive:true});
 const db=await database();
 const browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/html/',errors=[],report=[];
 try {
 for(const width of [1280,360]){
 const p=await openVisitor(browser,db,errors,ids[0],width);
 for(const file of [...fs.readdirSync('html').filter(f=>f.endsWith('.html')),'../secrets/hell.html','../secrets/secret.html']){
 const slug=file.replace('../secrets/','hidden-').replace('.html','');
 await p.goto(base+file+(slug==='profile'||slug==='track'?'?id='+ids[1]:''));
 await p.evaluate(()=>document.fonts.ready);await p.waitForTimeout(100);
 if(slug==='index'){
 await p.locator('.record-row').first().waitFor();
 await p.locator('select[aria-label="Sort music"]').selectOption('liked');await p.locator('.record-row').first().waitFor();
 }
 report.push(await p.evaluate(({slug,width})=>({slug,width,overflow:document.documentElement.scrollWidth-innerWidth,h:document.documentElement.scrollHeight,forms:document.forms.length}),{slug,width}));
 await p.screenshot({path:path.join(out,slug+'-'+width+'.jpg'),type:'jpeg',quality:75,fullPage:slug==='index'});
 }
 await p.context().close();
 }
 fs.writeFileSync(path.join(out,'checks.json'),JSON.stringify({report,errors},null,2));
 console.log('Rendered',report.length,'pages. Overflow:',report.filter(x=>x.overflow>1),'Page errors:',errors);
 assert(report.every(page=>page.overflow<=1),'Page exceeds viewport width');
 assert.deepEqual(errors,[]);
 } finally {await browser.close();server.close();await db.close();}
})().catch(e=>{console.error(e);process.exit(1);});
