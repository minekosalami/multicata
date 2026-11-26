const assert=require('node:assert/strict');
const {database,asUser,ids}=require('../next/local-db.cjs');
const owner='fd38626e-243b-43f2-aa00-365b23380bb0', bundled='00000000-0000-4000-8000-000000000041';
async function seed(db){
    await db.query('insert into auth.users values ($1)',[owner]);
    await db.query('insert into article_moderators values ($1)',[owner]);
}
function rpc(db,user,sql,params=[]){return asUser(db,user,async tx=>(await tx.query('select '+sql+' as value',params)).rows[0].value);}
async function checks(){
 const db=await database();
 try{
    await seed(db);
    const admin=(action,args={})=>rpc(db,owner,'radio_manage($1,$2)',[action,args]);
    const state=()=>rpc(db,null,'radio_state()');
    const vote=(member,round,choice)=>rpc(db,member,'radio_vote($1,$2)',[round,choice]);
    assert.equal((await state()).votes.length,4);
    assert.equal((await db.query('select count(*)::int as total from mc_radio.assets where approved')).rows[0].total,4);
    await assert.rejects(db.query("update mc_radio.assets set stream_path='unrelated.mp3' where music=$1",[ids[0]]),{code:'23514'});
    for(const member of [null,...ids]){
        await assert.rejects(rpc(db,member,"radio_manage('mode',$1)",[{manual:true}]));
        await assert.rejects(asUser(db,member,tx=>tx.query("update public.radio_updates set revision=0")));
        await assert.rejects(asUser(db,member,tx=>tx.query("insert into storage.objects values('radio-announcements',$1)",[owner+'/'+ids[0]+'.mp3'])));
    }
    await db.query('insert into article_moderators values ($1)',[ids[0]]);
    assert.equal(await rpc(db,ids[0],'radio_can_edit()'),false);
    // Check that random rotation advances with no votes, queue or moderator action.
    const start=(await state()).current;
    await db.query('select mc_radio.advance($1::timestamptz)',[start.ends]);
    const following=(await state()).current;
    assert.notEqual(following.item.id,start.item.id);
    await db.exec("update mc_radio.history set started=started-interval '105 seconds',ends=ends-interval '105 seconds'");
    let s=await state();assert.equal(s.votes.length,4);assert.equal(new Set(s.votes.map(v=>v.id)).size,4);
    for(const member of ids)await vote(member,s.round,ids[1]);
    await vote(ids[0],s.round,ids[2]);s=await state();assert.equal(s.votes.find(v=>v.id===ids[1]).count,2);
    await admin('skip',{current:s.current.id});assert.equal((await state()).current.item.id,ids[1]);
    await assert.rejects(admin('skip',{current:s.current.id}));await assert.rejects(vote(ids[0],s.round,ids[1]));
    await admin('mode',{manual:true});assert.equal((await state()).round,null);
    await admin('enqueue',{id:ids[1],timing:'queue'});let panel=await admin('enqueue',{id:ids[2],timing:'queue'});
    const [a,b]=panel.queue;panel=await admin('move',{queue:b.id,before:a.id});assert.equal(panel.queue[0].id,b.id);
    await admin('remove',{queue:b.id});await admin('revoke',{id:ids[1]});assert.equal((await admin('list')).queue.length,0);
    assert.equal((await state()).current.item.id,ids[1]);
    await admin('skip',{current:(await state()).current.id});assert.notEqual((await state()).current.item.id,ids[1]);
    await admin('mode',{manual:false});s=await state();assert.equal(s.votes.length,3);
    await Promise.all([vote(ids[0],s.round,bundled),vote(ids[1],s.round,ids[2])]);
    const skips=await Promise.allSettled([admin('skip',{current:s.current.id}),admin('skip',{current:s.current.id})]);
    assert.equal(skips.filter(x=>x.status==='fulfilled').length,1);
    s=await state();assert([bundled,ids[2]].includes(s.current.item.id));
    await Promise.all([vote(ids[0],s.round,bundled),vote(ids[0],s.round,ids[2])]);
    assert.equal((await state()).votes.reduce((n,v)=>n+v.count,0),1);
    const file=owner+'/'+ids[1]+'.mp3';
    await asUser(db,owner,tx=>tx.query("insert into storage.objects values('radio-announcements',$1)",[file]));
    await assert.rejects(admin('announce',{path:file,seconds:20,title:'Fixture recording'}));
    await assert.rejects(rpc(db,owner,'radio_verify_object($1)',[file]));
    await db.query('select radio_verify_object($1)',[file]);
    const announce=u=>rpc(db,u,'radio_announce_next($1,$2,$3)',[file,'Fixture recording',20]);
    for(const u of [null,...ids])await assert.rejects(announce(u),{code:'42501'});
    const ann=await announce(owner);assert.equal(await announce(owner),ann);
    panel=await admin('list');
    assert.equal(panel.queue.filter(q=>q.asset===ann).length,1);
    await admin('remove',{queue:panel.queue.find(q=>q.asset===ann).id});
    await vote(ids[0],s.round,ids[2]);
    await admin('enqueue',{id:ann,timing:'now'});assert.equal((await state()).current.item.id,ann);
    await admin('skip',{current:(await state()).current.id});assert.equal((await state()).current.item.id,ids[2]);
    const exact=new Date(Date.now()+15000).toISOString();
    await admin('enqueue',{id:ann,timing:'exact',due:exact});
    await admin('enqueue',{id:bundled,timing:'after',due:new Date(Date.parse(exact)+3000).toISOString()});
    const before=(await state()).current;
    // No client or moderator requests during the simulated six-hour interval.
    await db.query("select mc_radio.advance($1::timestamptz+interval '6 hours')",[exact]);
    const rows=(await db.query('select item,started,ends from mc_radio.history where id>=$1 order by id',[before.id])).rows;
    assert.equal(rows[1].started.toISOString(),exact);assert.equal(rows[1].item.id,ann);
    assert.equal(rows[2].started-rows[1].started,20000);assert.equal(rows[2].item.id,bundled);
    for(let i=1;i<rows.length;i++)assert.equal(+rows[i-1].ends,+rows[i].started);
    const end=Date.parse(exact)+48*3600*1000;
    const advance=async()=>(await db.query('select mc_radio.advance($1::timestamptz) as caught_up',[new Date(end).toISOString()])).rows[0].caught_up;
    assert.equal(await advance(),false);
    let batches=1;while(!(await advance()))batches++;
    assert(batches>=3);
    await db.query('delete from article_moderators where member=$1',[owner]);
    await assert.rejects(admin('list'));
    console.log('PASS public state, exclusive identity and revocation, storage and registration permissions, four and smaller ballots, vote changes, winning track, frozen result, queue edits, exact and after-end schedules, stale skip, '+rows.length+' continuous history entries across six unattended hours.');
 }finally{await db.close();}
}
module.exports={owner,bundled,seed,rpc};
if(require.main===module)checks().catch(e=>{console.error(e.message,e.where||e.stack);process.exitCode=1;});
