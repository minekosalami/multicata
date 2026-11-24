async function fillDialog(page,value){
 const dialog=page.locator('dialog[open]');
 await dialog.waitFor();
  if(value!==undefined)await dialog.locator('textarea').fill(value);
  await dialog.locator('button[value=accept]').click();
}
const {chromium}=require('playwright'),http=require('node:http'),path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const {database,ids:[a,b,c]}=require('./local-db.cjs');
const stage=process.argv[2];if(!['pass1','pass2','pass3','final'].includes(stage))throw Error('Choose a review pass');
const out=path.join(process.env.MULTICATA_REVIEW_DIR || __dirname,stage);fs.mkdirSync(out,{recursive:true});
const root=process.cwd(), checks=[];
const {server,openVisitor}=require('./runtime.cjs');
(async()=>{
 const db=await database();await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port+'/html/';
 const browser=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required']});
 const errors=[];
 const visitor=(id,width)=>openVisitor(browser,db,errors,id,width);
 const goto=(p,url)=>p.goto(base+url);
 const snap=(p,name)=>p.screenshot({path:path.join(out,name+'.png')});
 const act=(p,name)=>p.getByRole('button',{name,exact:true});
 const logged=msg=>{checks.push(msg);console.log(msg);};
 try{
  const listener=await visitor(a),artist=await visitor(b),outsider=await visitor(c);
  await goto(listener,'index.html');await listener.getByRole('combobox',{name:'Sort music'}).selectOption('liked');await listener.locator('.record-row').first().waitFor();
  await listener.locator('.record-name').filter({hasText:'Fixture recording 2'}).click();
  await act(listener,'Like · 0').click();await act(listener,'Like · 1').waitFor();
  await act(listener,'Dislike').click();await listener.waitForFunction(()=>document.querySelector('.reaction-bar button[aria-pressed=true]')?.textContent==='Dislike');
  await act(listener,'Like · 0').click();await act(listener,'Like · 1').waitFor();
  await act(listener,'♡ Favorite').click();await act(listener,'♥ Saved').waitFor();
  await listener.locator('.record-credit a').click();await act(listener,'Follow').click();await act(listener,'Unfollow').waitFor();
  await listener.locator('.discussion textarea').first().fill('A guestbook note for @third');await act(listener,'Sign guestbook').click();await listener.getByText('@third',{exact:true}).waitFor();
  await goto(artist,'profile.html?id='+b);await act(artist,'Reply').first().click();await artist.locator('.discussion textarea').first().fill('Thanks for visiting');await act(artist,'Send reply').click();await artist.locator('.reply').waitFor();
  await goto(listener,'notices.html');await listener.getByText('@creator replied').click();await listener.getByText('Thanks for visiting').waitFor();
  await goto(outsider,'notices.html');await outsider.getByText('@tester mentioned you').waitFor();
  logged('Track vote switched, genuine count checked, favorite saved, creator followed, guestbook signed and replied to; reply and mention led to the intended accounts.');
  await goto(listener,'posts.html');await listener.locator('#post-filter').selectOption('following');await listener.getByText('Disposable studio update').waitFor();
  await listener.locator('.post summary').first().click();await listener.locator('.post textarea').first().fill('Post comment');await act(listener,'Comment').click();await listener.getByText('Post comment',{exact:true}).waitFor();
  await goto(listener,'track.html?id='+a);await act(listener,'♡ Favorite').click();await act(listener,'♥ Saved').waitFor();
  await listener.locator('.comment-form textarea').fill('Track comment');await act(listener,'Comment').click();await listener.getByText('Track comment',{exact:true}).waitFor();
  await goto(listener,'favorites.html');await listener.locator('.record-row').nth(1).waitFor();await act(listener,'Shuffle favorites').click();
  await listener.waitForFunction(()=>document.querySelector('audio')?.currentTime>.1);
  await act(listener,'Next').click();await act(listener,'Previous').click();await act(listener,'Close player controls').click();
  await listener.locator('.site-nav a').filter({hasText:'Posts'}).click();const frame=listener.frameLocator('.player-page');await frame.locator('h1').waitFor();
  assert(await listener.locator('audio').evaluate(el=>!el.paused));await frame.locator('.player-toggle').click();
  await listener.reload();await listener.locator('.player-toggle').click();assert(await listener.locator('audio').evaluate(el=>el.paused));
  await goto(listener,'favorites.html');await act(listener,'Remove favorite').first().click();await listener.waitForFunction(()=>document.querySelectorAll('.record-row').length===1);
  logged('Following feed, post/track comments, two favorites, shuffle, Next/Previous, persistent playback, paused refresh and favorite removal passed.');
  await goto(artist,'account.html');await artist.getByText('Publish music',{exact:true}).click();await artist.locator('[name=title]').fill('Fixture upload');await artist.locator('[name=art]').setInputFiles('images/amanda.jpg');await artist.locator('[name=recording]').setInputFiles('audio/GrassCatsPopM.mp3');await act(artist,'Publish track').click();
  await artist.getByRole('link',{name:'View track on profile',exact:true}).click();await act(artist,'Play Fixture upload').waitFor();
  await artist.getByRole('link',{name:'Track details and comments'}).first().click();
  await artist.locator('.comment-form textarea').fill('Notes on my recording');await act(artist,'Comment').click();
  await artist.getByText('Notes on my recording').waitFor();
  await artist.waitForFunction(()=>document.querySelector('.record-row img')?.naturalWidth>0);
  logged('Optional release image decoded and a comment was saved on the published recording.');
  logged('MP3 publishing wrote a track under its owner; the registration trigger made it discoverable.');
  await goto(listener,'inbox.html?peer='+b);await listener.locator('#send textarea').fill('Private fixture conversation');await act(listener,'Send').click();await listener.getByText('Private fixture conversation',{exact:true}).waitFor();
  await goto(artist,'inbox.html?peer='+a);await artist.getByText('Private fixture conversation',{exact:true}).waitFor();
  await artist.locator('#send textarea').fill('Private fixture reply');await act(artist,'Send').click();await artist.getByText('Private fixture reply',{exact:true}).waitFor();
  await goto(listener,'inbox.html?peer='+b);await listener.getByText('Private fixture reply',{exact:true}).waitFor();
  logged('Two authenticated fixture identities exchanged private messages against participant RLS.');
  for(const width of [1280,360]){
   const p=await visitor(a,width);
   for(const [name,url,ready] of [
    ['home','index.html','.record-row'],['track','track.html?id='+a,'.comment'],['profile','profile.html?id='+b,'.reply'],
    ['posts','posts.html','.post'],['inbox','inbox.html?peer='+b,'#history li'],['upload','account.html','#editProfile:enabled'],
    ['favorites','favorites.html','.record-row'],['notices','notices.html','.notice']
   ]){
    await goto(p,url);if(name==="profile")await p.getByText("View replies (1)",{exact:true}).first().click();await p.locator(ready).first().waitFor({state:name==='inbox'?'attached':'visible'});
    if(name==='posts'){await p.locator('.post summary').first().click();await p.locator('.comment').first().waitFor();}
    if(name==='upload')await p.getByText('Publish music',{exact:true}).click();
    if(name==='profile'){
       await snap(p,'profile-top-'+width);
       await p.locator('.discussion').first().scrollIntoViewIfNeeded();
    }
    await snap(p,name+'-'+width);
    assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),name+' overflow at '+width);
   }
   await goto(p,'index.html');await p.locator('.record-row').first().waitFor();
   const sort=p.getByRole('combobox',{name:'Sort music'});await sort.focus();await p.keyboard.press('End');await p.keyboard.press('Enter');
   await p.locator('.record-row').first().waitFor();
   const row=p.locator('.record-row').first();if(width===360)await row.getByRole('button',{name:/^Queue /}).tap();else await row.getByRole('button',{name:/^Queue /}).click();
   await p.locator('.player-toggle').click();await p.locator('.player-panel summary').click();await snap(p,'player-'+width);
   await p.locator('.player-panel li button').first().click();await p.keyboard.press('Escape');assert(await p.locator('.player-panel').isHidden());
   await p.close();
  }
  await goto(listener,'index.html');
  await listener.locator('.member-menu summary').focus();await listener.keyboard.press('Enter');
  await listener.locator('.member-menu').getByText(/Notifications/).click();await listener.getByText('@creator replied').waitFor();
  await goto(listener,'index.html');const buttons=listener.locator('.record-row').getByRole('button',{name:/^Queue /});
  await buttons.nth(0).click();await buttons.nth(1).click();await listener.locator('.player-toggle').click();
  await listener.locator('.player-panel summary').click();const second=await listener.locator('.player-panel li>span').nth(1).innerText();
  await listener.getByRole('button',{name:/earlier$/}).first().click();assert.equal(await listener.locator('.player-panel li>span').first().innerText(),second);
  logged('Keyboard opened the menu and reached notifications. The second upcoming recording moved into first position.');
  await goto(artist,'profile.html?id='+b);await act(artist,'Remove').first().click();await fillDialog(artist);await artist.getByText('No guestbook entries yet.').waitFor();
  await goto(listener,'posts.html');await listener.locator('#postContent').fill('A studio update for @creator');await act(listener,'Post').click();
  const myPost=listener.locator('.post').filter({hasText:'A studio update for'});
  await myPost.locator('.post-content a').waitFor();await myPost.getByRole('button',{name:'Edit',exact:true}).click();await fillDialog(listener,'Updated studio note for @third');
  const edited=listener.locator('.post').filter({hasText:'Updated studio note for'});await edited.locator('.post-content a').click();
  await listener.locator('h1.username').getByText('@third').waitFor();
  await goto(outsider,'notices.html');await outsider.getByText('@tester mentioned you').first().click();
  await outsider.locator('.post').filter({hasText:'Updated studio note'}).waitFor();
  await goto(artist,'inbox.html?peer='+a);await act(artist,'Report').first().click();await fillDialog(artist,'Fixture report');await artist.getByText('Reported.',{exact:true}).waitFor();
  await act(artist,'Block').click();await act(artist,'Unblock').waitFor();
  await goto(listener,'track.html?id='+a);await listener.getByText('Recording unavailable.').waitFor();
  await goto(listener,'inbox.html?peer='+b);await listener.locator('#send').waitFor({state:'hidden'});
  await goto(artist,'inbox.html?peer='+a);await act(artist,'Unblock').click();await act(artist,'Block').waitFor();
  logged('Post creation and editing linked mentions to unified profiles; the mention notice returned to the edited post. A report and block stopped sends and removed blocked music from view.');
  const guest=await visitor(null,360);await goto(guest,'favorites.html');await guest.getByText('Sign in to view Favorite Music').waitFor();
  await goto(guest,'index.html');await guest.locator('.record-row').first().waitFor();await guest.locator('.record-name').first().click();await guest.getByText('Sign in to vote or save').waitFor();
  await goto(guest,'track.html?id=unavailable');await guest.getByText('Recording unavailable.').waitFor();
  await guest.setViewportSize({width:320,height:700});
  await goto(guest,'index.html');await guest.locator('.record-row').first().waitFor();
  await guest.keyboard.press('Tab');await guest.keyboard.press('Enter');assert(await guest.locator('main').evaluate(el=>el===document.activeElement));
  await guest.locator('.record-row').first().getByRole('button',{name:/^Play /}).click();
  await guest.waitForFunction(()=>document.querySelector('audio')?.currentTime>0.15);
  await guest.locator('.player-panel audio').evaluate(el=>el.volume=0.4);
  assert.equal(await guest.locator('.player-panel audio').evaluate(el=>el.volume),0.4);
  await act(guest,'Close player controls').click();
  await guest.locator('.record-row').nth(1).getByRole('button',{name:/^Queue /}).click();
  await guest.locator('.player-toggle').click();
  const current=await guest.locator('audio').evaluate(el=>el.src);
  await guest.locator('audio').evaluate(el=>{el.currentTime=el.duration-0.1;});
  await guest.waitForFunction(old=>document.querySelector('audio').src!==old && !document.querySelector('audio').paused,current);
  await guest.keyboard.press('Escape');assert(await guest.locator('.player-panel').isHidden());
  assert(await guest.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const dimensions=await guest.locator('#accountButton').evaluate(el=>({label:el.textContent,width:el.clientWidth,required:el.scrollWidth}));
  assert(dimensions.required<=dimensions.width,'Sign In label clipped at 320px');
  await guest.waitForFunction(()=>Array.from(document.querySelectorAll('.record-row .social-status')).every(e=>!e.textContent));
  await snap(guest,'home-320');
  fs.writeFileSync(path.join(out,'narrow-nav.json'),JSON.stringify(dimensions,null,2));
  logged('At 320px the keyboard skip link focused main. The transport accepted a volume change and near-end seek, advanced automatically to the queued recording, and dismissed with Escape.');
  assert.deepEqual(errors,[]);logged('Eight page families and player inspected at desktop and touch widths; empty, unavailable, guest, moderation, keyboard and queue-removal paths passed.');
 }catch(e){for(const ctx of browser.contexts())for(const p of ctx.pages())console.log(p.url(),(await p.locator("body").innerText()).slice(0,900));throw e;}finally{
  fs.writeFileSync(path.join(out,'journeys.json'),JSON.stringify({checks,errors},null,2));await browser.close();await db.close();server.close();
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
