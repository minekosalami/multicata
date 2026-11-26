// Exercise the Edge handler against local auth, range-response and database adapters.
const assert=require('node:assert/strict'), fs=require('node:fs'), vm=require('node:vm');
const {stripTypeScriptTypes}=require('node:module');
const {owner}=require('./station.cjs');
(async()=>{
    let handler,allowed=true,verified=0,range;
    const bytes=Buffer.alloc(512);bytes.write('RIFF');bytes.write('WAVE',8);
    const client={
        auth:{getUser:async token=>({data:{user:token==='fixture'?{id:owner}:null}})},
        storage:{from:()=>({getPublicUrl:()=>({data:{publicUrl:'http://fixture.invalid/object'}})})},
        rpc:async name=>{if(name==='radio_can_edit')return {data:allowed};if(name==='radio_verify_object')verified++;return {error:null};}
    };
    const ctx={Deno:{env:{get:()=>''},serve:fn=>{handler=fn;}},createClient:()=>client,
        fetch:async(_,opts)=>{range=opts.headers.Range;return new Response(bytes,{status:206});},Response,Uint8Array};
    const code=fs.readFileSync('supabase/functions/radio-verify/index.ts','utf8').replace(/^import .*;$/m,'');
    vm.runInNewContext(stripTypeScriptTypes(code),ctx);
    const path=owner+'/11111111-1111-4111-8111-111111111111.wav';
    const request=(file,token='fixture')=>handler(new Request('http://localhost',{method:'POST',
        headers:{Authorization:'Bearer '+token},body:JSON.stringify({path:file})}));
    assert.equal((await request(path)).status,200);assert.equal(range,'bytes=0-511');assert.equal(verified,1);
    assert.equal((await request(path.replace('.wav','.mp3'))).status,415);
    assert.equal((await request(path.replace(owner,'00000000-0000-4000-8000-000000000001'))).status,400);
    assert.equal((await request(path,'expired')).status,403);
    allowed=false;assert.equal((await request(path)).status,403);assert.equal(verified,1);
    console.log('PASS server-side announcement format, owner, path, session and revocation checks using the actual Edge handler.');
})().catch(e=>{console.error(e);process.exitCode=1;});
