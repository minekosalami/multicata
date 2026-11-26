const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,firefox,webkit}=require('playwright');
const {database,ids}=require('../next/local-db.cjs');
const {server,openVisitor}=require('../next/runtime.cjs');
const {owner,bundled,seed,rpc}=require('./station.cjs');
const out=process.env.RADIO_QA_DIR||__dirname;
(async()=>{
 const db=await database(),results={},errors=[],browsers=[];
 try{
  await seed(db);
  const admin=(action,args)=>rpc(db,owner,'radio_manage($1,$2)',[action,args]);
  await admin('enqueue',{id:bundled,timing:'now'});
  await db.exec("update mc_radio.history set started=started-interval '36 seconds',ends=ends-interval '36 seconds'");
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/html/';
  const chrome=await chromium.launch({channel:'chrome',args:['--autoplay-policy=no-user-gesture-required','--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream']});browsers.push(chrome);
  const presence=new Map(), clients=new Set(), recordings=new Map();let traffic=0,notices=0;
  async function visitor(browser,id,width,offset=0){
    const p=await openVisitor(browser,db,errors,id,width);clients.add(p);
    await p.exposeFunction('qaAnnBytes',(key,mime,data)=>{recordings.set(key,{mime,bytes:Buffer.from(data,'base64')});});
    await p.context().route('**/storage/v1/object/public/radio-announcements/**',async r=>{
        const entry=recordings.get(r.request().url().split('/radio-announcements/')[1]);
        if(!entry)return r.fulfill({status:404});
        const match=/^bytes=(\d+)-(\d*)$/.exec(r.request().headers().range||'');
        const start=Number(match?.[1]||0),end=Math.min(Number(match?.[2]||entry.bytes.length-1),entry.bytes.length-1);
        return r.fulfill({status:match?206:200,contentType:entry.mime,body:entry.bytes.subarray(start,end+1),
            headers:{'access-control-allow-origin':'*','accept-ranges':'bytes',...(match?{'content-range':'bytes '+start+'-'+end+'/'+entry.bytes.length}:{})}});
    });
    await p.exposeFunction('announceRadioUpdate',async()=>{
        notices++;await Promise.all([...clients].filter(c=>!c.isClosed()).map(c=>c.evaluate(()=>window.qaStationChange?.()).catch(()=>{})));
    });
    await p.exposeFunction('announcePresence',async(key,active)=>{
        traffic++;if(active)presence.set(key,[{listening:true}]);else presence.delete(key);
        await Promise.all([...clients].filter(c=>!c.isClosed()).map(c=>c.evaluate(data=>window.qaPresence?.(data),Object.fromEntries(presence)).catch(()=>{})));
    });
    await p.addInitScript(shift=>{
        const original=Date.now;Date.now=()=>original()+shift;
        window.metrics={streams:[],contexts:[],filters:[],requests:0};
        const NativeAudio=Audio;window.Audio=class extends NativeAudio{constructor(...args){super(...args);window.metrics.streams.push(this);}};
        if(window.AudioContext){const Native=AudioContext;window.AudioContext=class extends Native{
            constructor(...args){super(...args);window.metrics.contexts.push(this);}
            createBiquadFilter(){const f=super.createBiquadFilter();window.metrics.filters.push(f);return f;}
        };}
    },offset);
    await p.context().route('**/js/backend.js',r=>r.fulfill({contentType:'application/javascript',body:
      fs.readFileSync('js/backend.js','utf8')+`
      const oldRPC=supabaseClient.rpc;supabaseClient.rpc=async(name,args)=>{if(name==="radio_state")metrics.requests++;
        const result=await oldRPC(name,args);if(!result.error && (name==="radio_vote" || name==="radio_manage" && args.action!=="list"))await announceRadioUpdate();return result;};
      supabaseClient.channel=(_,options)=>{
        let listeners={},members={};const key=options.config.presence.key;
        const c={on(type,filter,fn){listeners[type+filter.event]=fn;return c;},
        subscribe(fn){window.qaPresence=data=>{members=data;listeners.presencesync?.()};window.qaStationChange=()=>listeners.postgres_changesUPDATE?.();queueMicrotask(()=>{fn('SUBSCRIBED');announcePresence(key,false)});return c;},
        presenceState:()=>members,track:()=>announcePresence(key,true),untrack:()=>announcePresence(key,false)};return c;
      };supabaseClient.removeChannel=c=>c.untrack();
      supabaseClient.functions={invoke:async(_,req)=>await window.qaVerify(req.body.path)};
      const oldBucket=supabaseClient.storage.from;supabaseClient.storage.from=name=>{
        const bucket=oldBucket(name);if(name==="radio-announcements"){const original=bucket.upload;
          bucket.upload=async(path,file,options)=>{const result=await original(path,file,options);
            if(!result.error){const encoded=await new Promise(done=>{const reader=new FileReader();reader.onload=()=>done(reader.result);reader.readAsDataURL(file);});
              await qaAnnBytes(path,file.type,encoded.split(",")[1]);}return result;};}return bucket;};
      `}));
    await p.exposeFunction('qaVerify',async file=>{if(id!==owner)return {error:{message:'Unauthorized'}};await db.query('select radio_verify_object($1)',[file]);return {error:null};});
    return p;
  }
  const a=await visitor(chrome,ids[0],1280), b=await visitor(chrome,null,360,7200000);
  let audioRequests=0, transfer=0;
  const isRecording=r=>/\/audio\/|\/storage\/v1\/object\/public\/(creator-music|radio-announcements)\//.test(r.url());
  a.on('request',r=>{if(isRecording(r))audioRequests++;});
  a.on('requestfinished',async r=>{if(isRecording(r))try{transfer+=(await r.sizes()).responseBodySize;}catch{}});
  await a.goto(url+'index.html');await a.locator('.radio-widget').scrollIntoViewIfNeeded();await a.locator('[data-air].on').waitFor();assert.equal(audioRequests,0);results.homeAudioRequests=audioRequests;
  await a.getByText('Customize homepage',{exact:true}).waitFor();
  await a.evaluate(async()=>{
    const station=await multiCataPlayer.getRadio(),rpc=supabaseClient.rpc;
    await station.refresh();
    try {
      supabaseClient.rpc=(name,args)=>name==='radio_state'?Promise.resolve({error:{message:'Fixture outage'}}):rpc(name,args);
      await station.refresh();
      if(!document.querySelector('[data-feedback]').textContent.includes('unavailable'))throw Error('Missing connection status');
    } finally {supabaseClient.rpc=rpc;}
    await station.refresh();
    if(document.querySelector('[data-feedback]').textContent)throw Error('Station error persisted after recovery');
  });
  const aligned=await a.evaluate(()=>{
    const bounds=selector=>document.querySelector(selector).getBoundingClientRect();
    const radio=bounds('.radio-widget'), reference=bounds('.flight-deck'), music=bounds('#music'), posts=bounds('#posts');
    return music.top===posts.top && radio.top>=Math.max(music.bottom,posts.bottom) &&
        Math.abs(radio.left-reference.left)<1 && Math.abs(radio.right-reference.right)<1 && Math.abs(radio.height-reference.height)<1;
  });
  assert(aligned,'Radio should match the wide reference row beneath Music and Posts');
  await a.locator('.radio-widget').screenshot({path:path.join(out,'widget.png')});
  await a.getByRole('button',{name:'Radio power'}).click();
  const playing=p=>p.waitForFunction(()=>window.metrics.streams.some(m=>!m.paused&&m.currentTime>1));
  await playing(a);await b.goto(url+'index.html');await b.locator('.site-nav').getByRole('link',{name:'Radio',exact:true}).click();
  await b.locator('[data-air].on').waitFor();assert.equal(await b.locator('.site-nav [aria-current=page]').innerText(),'Radio');
  await b.getByRole('button',{name:'Radio power'}).click();await playing(b);
  const sample=p=>p.evaluate(()=>window.metrics.streams.find(m=>!m.paused).currentTime);
  let samples=[];for(let i=0;i<5;i++){await new Promise(r=>setTimeout(r,220));const ts=await Promise.all([sample(a),sample(b)]);samples.push(Math.abs(ts[0]-ts[1]));}
  assert(Math.max(...samples)<1.25);results.syncDeltaSeconds=samples;results.joinPosition=await sample(b);
  const preset=(page,name)=>page.getByRole('group',{name:'Radio sound presets'}).getByRole('button',{name,exact:true});
  const bassDial=a.getByLabel('Radio bass');
  await a.getByLabel('Radio volume').press('ArrowLeft');
  for(const [name,bass,treble] of [['Bass boost',6,0],['Bright',0,5],['Warm',3,-3]]){
    await preset(a,name).click();
    assert.equal(await preset(a,name).getAttribute('aria-pressed'),'true');
    assert.equal(await a.getByLabel('Radio volume').inputValue(),'74');
    await a.waitForFunction(([bass,treble])=>Math.round(metrics.filters[0].gain.value)===bass && Math.round(metrics.filters[1].gain.value)===treble,[bass,treble]);
  }
  await bassDial.scrollIntoViewIfNeeded();const dial=await bassDial.boundingBox();
  const x=dial.x+dial.width/2,y=dial.y+dial.height/2;
  await a.mouse.move(x,y);await a.mouse.down();assert.equal(await bassDial.inputValue(),'3');
  await a.mouse.move(x,y-36,{steps:6});await a.mouse.up();
  assert.equal(await bassDial.inputValue(),'9');assert.equal(await preset(a,'Warm').getAttribute('aria-pressed'),'false');
  await preset(a,'Reset').click();
  assert.equal(await a.getByLabel('Radio volume').inputValue(),'75');
  assert.equal(await bassDial.inputValue(),'0');assert.equal(await a.getByLabel('Radio treble').inputValue(),'0');
  await preset(b,'Bass boost').tap();const touchKnob=b.getByLabel('Radio bass');await touchKnob.scrollIntoViewIfNeeded();
  const touchBox=await touchKnob.boundingBox(), touch=await b.context().newCDPSession(b);
  const finger={x:touchBox.x+touchBox.width/2,y:touchBox.y+touchBox.height/2};
  await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[finger]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:finger.x-48,y:finger.y}]});
  await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  assert.equal(await touchKnob.inputValue(),'-2');
  await a.getByLabel('Radio bass').focus();await a.keyboard.press('End');await a.getByLabel('Radio treble').focus();await a.keyboard.press('Home');
  await a.waitForFunction(()=>Math.round(metrics.filters[0].gain.value)===12 && Math.round(metrics.filters[1].gain.value)===-12);
  await a.getByLabel('Radio volume').focus();await a.keyboard.press('ArrowLeft');
  const beforeMore=await sample(a);
  await a.evaluate(()=>{window.radioAudioBeforeMore=metrics.streams.find(m=>!m.paused);});
  await a.locator('.radio-widget').getByRole('link',{name:'More about mCata Radio'}).click();
  const stationPage=a.frameLocator('.player-page');
  await stationPage.locator('[data-power][aria-pressed=true]').waitFor();
  const receiver=await stationPage.locator('.receiver').boundingBox();
  const readout=await stationPage.locator('.radio-screen').boundingBox();
  const volume=await stationPage.locator('.radio-knob').filter({has:stationPage.getByLabel('Radio volume')}).boundingBox();
  assert(receiver.width>=1000 && readout.height>=160 && volume.width>=90,`Unexpected station dimensions: receiver ${receiver.width}, display height ${readout.height}, volume ${volume.width}`);
  results.desktopReceiverWidth=receiver.width;
  assert.equal(await stationPage.getByLabel('Radio bass').inputValue(),'12');
  assert.equal(await stationPage.getByLabel('Radio treble').inputValue(),'-12');
  assert.equal(await stationPage.getByLabel('Radio volume').inputValue(),'74');
  assert(await a.evaluate(()=>metrics.streams.length===1 && metrics.streams[0]===window.radioAudioBeforeMore && !metrics.streams[0].paused));
  assert(await sample(a)>=beforeMore);
  await stationPage.getByRole('button',{name:'Vote',exact:true}).first().click();
  await stationPage.getByRole('button',{name:'Selected'}).waitFor();
  await stationPage.getByRole('button',{name:'Favorite',exact:false}).click();
  await stationPage.getByRole('button',{name:'♥ Saved'}).waitFor();
  await stationPage.locator('[data-count]').getByText('2 listeners').waitFor();
  await a.screenshot({path:path.join(out,'desktop.png')});await b.screenshot({path:path.join(out,'mobile.png')});
  assert(await b.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
  const before=await sample(a);await stationPage.locator('.site-nav a').filter({hasText:'Articles'}).first().click();
  await a.frameLocator('.player-page').locator('h1').first().waitFor();await a.goBack();await a.frameLocator('.player-page').locator('[data-power]').waitFor();
  await a.goForward();await a.frameLocator('.player-page').locator('h1').first().waitFor();assert(await sample(a)>=before);
  results.host=await a.evaluate(()=>({contexts:metrics.contexts.length,streams:metrics.streams.length,stateRequests:metrics.requests,heap:performance.memory?.usedJSHeapSize}));
  assert.equal(results.host.contexts,1);assert.equal(results.host.streams,1);
  await a.context().setOffline(true);await a.context().setOffline(false);await a.evaluate(()=>window.dispatchEvent(new Event('online')));await playing(a);
  if(process.env.RADIO_SOAK){
    const duration=Number(process.env.RADIO_SOAK)*1000;
    const begin=Date.now(),first=await a.evaluate(async()=>(await multiCataPlayer.getRadio()).state.current.id);
    const initial=await a.evaluate(()=>({heap:performance.memory.usedJSHeapSize,requests:metrics.requests}));
    const cdp=await a.context().newCDPSession(a);
    await cdp.send('Page.setWebLifecycleState',{state:'frozen'});await new Promise(r=>setTimeout(r,2500));
    await cdp.send('Page.setWebLifecycleState',{state:'active'});
    let worst=0,samples=0;
    while(Date.now()-begin<duration){
      await new Promise(r=>setTimeout(r,5000));
      const [x,y]=await Promise.all([sample(a),sample(b)]);worst=Math.max(worst,Math.abs(x-y));samples++;
    }
    const end=await a.evaluate(async()=>({id:(await multiCataPlayer.getRadio()).state.current.id,heap:performance.memory.usedJSHeapSize,
       requests:metrics.requests,contexts:metrics.contexts.length}));
    assert(end.id>first);assert.equal(end.contexts,1);
    results.soak={seconds:(Date.now()-begin)/1000,samples,worstDelta:worst,transitions:end.id-first,stateRequests:end.requests-initial.requests,
       heapStart:initial.heap,heapEnd:end.heap};
  }
  await a.locator('.radio-mini button').click();await b.getByRole('button',{name:'Radio power'}).click();
  await a.evaluate(()=>window.multiCataPlayer.openPlayer(true));await a.waitForFunction(()=>!document.querySelector('.player-panel audio').paused);
  assert(await a.evaluate(()=>metrics.streams.every(m=>m.paused)));
  const ctl=await visitor(chrome,owner,1000);await ctl.goto(url+'radio-control.html');await ctl.getByText('4 songs in rotation',{exact:false}).waitFor();
  await ctl.evaluate(()=>{const input=document.querySelector('#upload'),data=new DataTransfer();
    data.items.add(new File([new Uint8Array(52428801)],'large.wav',{type:'audio/wav'}));input.files=data.files;input.dispatchEvent(new Event('change'));});
  await ctl.getByRole('link',{name:'Save recording to this device'}).waitFor();assert(await ctl.locator('#save').isDisabled());
  await ctl.locator('#search').fill('Fixture recording 1');await ctl.locator('#catalog button').click();await ctl.getByText('3 songs in rotation',{exact:false}).waitFor();
  await ctl.locator('#upload').setInputFiles('audio/GrassCatsPopM.mp3');await ctl.waitForFunction(()=>!document.querySelector('#save').disabled);
  await ctl.locator('#announcement-title').fill('Local file check');await ctl.locator('#save').click();await ctl.getByText('Announcement saved.',{exact:false}).waitFor();
  await ctl.locator('#record').click();await ctl.waitForFunction(()=>document.querySelector('#record-time').textContent.includes('Recording'));
  await new Promise(r=>setTimeout(r,2100));await ctl.locator('#stop').click();await ctl.waitForFunction(()=>!document.querySelector('#save').disabled);
  await ctl.locator('#record').click();await new Promise(r=>setTimeout(r,6500));await ctl.locator('#stop').click();
  await ctl.waitForFunction(()=>!document.querySelector('#save').disabled && /0:0[6-8]/.test(document.querySelector('#file-info').textContent));
  await ctl.locator('#announcement-title').fill('Local microphone check');await ctl.locator('#save').click();await ctl.getByText('Announcement saved.',{exact:false}).waitFor();
  await ctl.locator('#schedule button').click();await ctl.getByText('Broadcast saved.').waitFor();
  await ctl.screenshot({path:path.join(out,'control.png')});
  const due=new Date(Date.now()+4000).toISOString();
  await ctl.evaluate(async due=>{const result=await MC.rpc("radio_manage",{action:"list"}),item=result.assets.find(a=>a.title==="Local microphone check");
    await MC.rpc("radio_manage",{action:"enqueue",args:{id:item.id,timing:"exact",due}});},due);
  await ctl.close();await b.waitForFunction(()=>document.querySelector('[data-title]').textContent==="Local microphone check",null,{timeout:12000});
  const live=await rpc(db,null,'radio_state()');assert.equal(Date.parse(live.current.started),Date.parse(due));
  await b.locator('[data-power]').click();await b.waitForFunction(()=>metrics.streams.some(m=>m.currentSrc.includes('radio-announcements')&&!m.paused&&m.currentTime>.15));
  await b.getByLabel('Radio bass').focus();await b.keyboard.press('Home');
  await b.waitForFunction(()=>Math.round(metrics.filters[0].gain.value)===-12);
  await b.locator('[data-power]').click();
  await b.goto(url+'radio-control.html');await b.getByText('Only @lliosette can edit the station.').waitFor();assert(await b.locator('#controls').isHidden());
  results.audioRequests=audioRequests;results.transferredBytes=transfer;results.fixturePresenceCalls=traffic;results.fixtureStateSignals=notices;
  await admin('enqueue',{id:bundled,timing:'now'});
  const slow=await visitor(chrome,null,320), slowCDP=await slow.context().newCDPSession(slow);
  await slowCDP.send('Network.enable');
  await slowCDP.send('Network.emulateNetworkConditions',{offline:false,latency:150,downloadThroughput:256*1024,uploadThroughput:128*1024});
  await slowCDP.send('Emulation.setCPUThrottlingRate',{rate:4});
  await slow.goto(url+'radio.html');await slow.locator('[data-air].on').waitFor();
  const startSlow=Date.now();await slow.locator('[data-power]').click();
  await slow.waitForFunction(()=>metrics.streams.some(m=>!m.paused&&m.currentTime>0.1),null,{timeout:20000});
  results.throttledPowerToObservedPlaybackMs=Date.now()-startSlow;
  assert(await slow.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await slow.close();
  for(const [name,engine] of [['firefox',firefox],['webkit',webkit]]){
    try{
      const browser=await engine.launch();browsers.push(browser);const p=await visitor(browser,null,390);
      await p.goto(url+'radio.html');await p.locator('[data-air].on').waitFor();await p.locator('[data-power]').click();await playing(p);
      assert(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));results[name]='Receiver, power and advancing audio passed.';
    }catch(e){results[name]=e.message.split('\n')[0];process.exitCode=1;}
  }
  assert.deepEqual(errors,[]);console.log(JSON.stringify(results,null,2));
 }finally{for(const b of browsers)await b.close();server.close();await db.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
