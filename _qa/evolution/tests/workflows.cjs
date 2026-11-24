async function fillDialog(page,value){
 const dialog=page.locator('dialog[open]');
 await dialog.waitFor();
  if(value!==undefined)await dialog.locator('textarea').fill(value);
  await dialog.locator('button[value=accept]').click();
}
const {chromium}=require('playwright');
const fs=require('fs'), path=require('path'), http=require('http'), assert=require('node:assert/strict');
const root=process.cwd();
const server=http.createServer((req,res)=>{const p=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));if(!fs.existsSync(p)||!fs.statSync(p).isFile()){res.writeHead(404).end();return;}
const type={'.js':'application/javascript','.html':'text/html; charset=utf-8','.css':'text/css','.mp3':'audio/mpeg','.png':'image/png','.jpg':'image/jpeg'}[path.extname(p)]||'application/octet-stream';
res.writeHead(200,{'content-type':type,'content-length':fs.statSync(p).size});fs.createReadStream(p).pipe(res);});
(async()=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port+'/html/';
const browser=await chromium.launch({channel:'chrome',headless:true,args:['--autoplay-policy=no-user-gesture-required']});
try{
for(const width of [390,1280]){
const page=await browser.newPage({viewport:{width,height:850}});const errors=[];
page.on('pageerror',e=>{errors.push(e.message);console.log(e.message)});
await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'text/javascript',body:fs.readFileSync(path.join(__dirname,'fixture.js'),'utf8')}));
for(const name of ['account','posts','profile','chat','inbox','characters','index','lliosette','dorianhallow','secret']){
await page.goto(base+name+'.html');assert(await page.locator('h1,.chat-title').count()||name==='profile');
const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);assert(overflow<=1,name+' overflows at '+width+' by '+overflow);
if(name==='characters'){await page.getByRole('button',{name:'Amanda'}).click();await page.locator('#character-info img').waitFor({timeout:3000});}
}
await page.goto(base+'lliosette.html');await page.getByText('Play GrassCats Pop',{exact:true}).click();
await page.waitForFunction(()=>document.querySelector('audio')?.currentTime>0.1);
const frame=page.frameLocator('.player-page');
await page.getByRole('link',{name:'Posts',exact:true}).click();await frame.getByText('Sign in to view posts.').waitFor();
const t=await page.locator('audio').evaluate(a=>a.currentTime);await page.waitForFunction(t=>document.querySelector('audio').currentTime>t+0.15,t);
await frame.getByRole('button',{name:/Player/}).click();await page.getByText('Close player controls').click();await frame.getByRole('button',{name:/Player/}).click();assert(await page.locator('audio').isVisible());
await page.goBack();await frame.getByText('Play GrassCats Pop',{exact:true}).waitFor();assert.deepEqual(errors,[]);await page.close();
console.log('Passed navigation, guest states, playback continuity and history at width '+width);
}

const page=await browser.newPage({viewport:{width:390,height:844}});const err=[];
page.on('pageerror',e=>err.push(e.message));
await page.route('https://cdn.jsdelivr.net/**',r=>r.fulfill({contentType:'application/javascript',body:fs.readFileSync(path.join(__dirname,'fixture.js'),'utf8')}));
await page.goto(base+'account.html');await page.locator('#email').fill('tester@example.test');await page.locator('#password').fill('example-password');await page.locator('#logInButton').click();
await page.getByText('Edit Profile',{exact:true}).click();await page.locator('#bio').fill('Test biography');await page.locator('#social_links').fill('https://example.test/artist');
await page.locator('#profilePictureFile').setInputFiles(path.join(root,'images/nart.jpeg'));await page.locator('#banner_path').setInputFiles(path.join(root,'images/amanda.jpg'));
await page.locator('#saveProfileButton').click();await page.getByText('Profile saved!',{exact:true}).waitFor();await page.getByText('Publish music',{exact:true}).click();
await page.locator('[name=title]').fill('Test recording');await page.locator('[name=releaseName]').fill('Test release');await page.locator('[name=credits]').fill('Test credits');
await page.locator('[name=recording]').setInputFiles(path.join(root,'audio/GrassCatsPopM.mp3'));await page.getByText('Publish track',{exact:true}).click();await page.getByText('Published on your profile.',{exact:false}).first().waitFor();
await page.locator('#viewProfileButton').click();await page.getByText('Test biography').waitFor();await page.getByText('Test release').waitFor();await page.getByText('Test credits').waitFor();await page.getByText('Share in a post').click();await page.waitForFunction(()=>document.querySelector('#postTrack')?.selectedOptions[0]?.textContent==='Test recording');
await page.locator('#postContent').fill('Test update');await page.locator('#postImage').setInputFiles(path.join(root,'images/amanda.jpg'));await page.locator('#postButton').click();await page.locator('.post-content').getByText('Test update').waitFor();await page.locator('.attached-image').waitFor();
await page.getByRole('button',{name:'Edit',exact:true}).click();await fillDialog(page,'Edited update');await page.locator('.post-content').getByText('Edited update').waitFor();
await page.locator('.post a').filter({hasText:'Test recording'}).click();await page.getByRole('button',{name:'Play Test recording'}).waitFor();await page.locator('.post-content').getByText('Edited update').waitFor();
await page.getByRole('button',{name:'Delete',exact:true}).click();await fillDialog(page);await page.waitForFunction(()=>JSON.parse(localStorage.posts).length===0);
await page.goto(base+'account.html');await page.locator('#logOutButton').click();await fillDialog(page);await page.locator('#logInButton').waitFor();assert.deepEqual(err,[]);await page.close();console.log('Passed signed-in browser flows with fixture auth, storage, and rows');


const dm=await browser.newPage();await dm.route('https://cdn.jsdelivr.net/**',r=>{const fixture=fs.readFileSync(path.join(__dirname,'fixture.js'),'utf8')
.replace('let op=', "let op=")
.replace('const q={select()', 'const q={or(){return q},select()')
.replace('from,storage:', "rpc:async(name)=>({data:name==='can_message'?!read('message_blocks').length:[{peer:'00000000-0000-4000-8000-000000000002',unread:1}]}),from,storage:");
return r.fulfill({contentType:'application/javascript',body:fixture})});
await dm.goto(base+'inbox.html');await dm.evaluate(()=>{localStorage.auth='1';localStorage.private_messages=JSON.stringify([{sender:'00000000-0000-4000-8000-000000000002',recipient:'00000000-0000-4000-8000-000000000001',id:crypto.randomUUID(),body:'Private fixture',is_read:false,created_at:new Date().toISOString()}])});await dm.goto(base+'inbox.html?peer=00000000-0000-4000-8000-000000000002');
await dm.getByText('Private fixture').waitFor();await dm.waitForFunction(()=>JSON.parse(localStorage.private_messages)[0].is_read);
await dm.getByRole('textbox',{name:'Message'}).fill('Reply');await dm.getByRole('button',{name:'Send',exact:true}).click();await dm.getByText('Reply',{exact:true}).waitFor();
await dm.getByRole('button',{name:'Report'}).click();await fillDialog(dm,'Test reason');await dm.getByText('Reported.').waitFor();
await dm.getByRole('button',{name:'Block',exact:true}).click();await dm.getByRole('button',{name:'Unblock'}).waitFor();await dm.locator('#send').waitFor({state:'hidden'});
await dm.getByRole('button',{name:'Unblock'}).click();await dm.locator('#send').waitFor();await dm.close();console.log('Passed inbox read, send, report, block and unblock flows');


}finally{await browser.close();server.close();}
})().catch(e=>{console.error(e);server.close();process.exitCode=1});
