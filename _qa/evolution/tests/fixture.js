
const id='00000000-0000-4000-8000-000000000001';
const user={id,email:'tester@example.test'};
const profile={id,user_id:id,username:'tester',bio:'',social_links:[],created_at:new Date().toISOString()};
const read=(t)=>JSON.parse(localStorage.getItem(t)||JSON.stringify(t==='profiles'?[profile]:[]));
const write=(t,v)=>localStorage.setItem(t,JSON.stringify(v));
function from(t) {
let op='read',value,filters=[],single=false,bounds;
const q={select(){return q},insert(v){value=v;op='insert';return q},update(v){value=v;op='update';return q},delete(){op='delete';return q},eq(k,v){filters.push(r=>r[k]===v);return q},in(k,vals){filters.push(r=>vals.includes(r[k]));return q},range(first,last){bounds=[first,last+1];return q},limit(){return q},order(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},
then(done,fail){try{let all=read(t),data=all.filter(r=>filters.every(f=>f(r)));
if(op==='insert'){data=[{id:crypto.randomUUID(),created_at:new Date().toISOString(),...value}];all.push(...data)}
if(op==='update')data.forEach(r=>Object.assign(r,value));
if(op==='delete')all=all.filter(r=>!data.includes(r));
if(op!=='read') write(t,all);
if(t==='posts')data.forEach(p=>p.tracks=read('tracks').find(tr=>tr.id===p.track_id));
if(bounds)data=data.slice(...bounds);
done({data:single?(data[0]||null):data,error:null})}catch(e){fail(e)}}};return q;
}
window.supabase={createClient:()=>({auth:{getUser:async()=>({data:{user:localStorage.auth?user:null}}),onAuthStateChange(){return {data:{subscription:{unsubscribe(){}}}}},signUp:async({email})=>{localStorage.setItem('registered',email);return {data:{user},error:null}},signInWithPassword:async()=>{localStorage.auth='1';return {data:{user}}},signOut:async()=>{delete localStorage.auth;return {}}},from,storage:{from:bucket=>({upload:async(path,file)=>{if(!file.size)throw Error('empty');return {}},getPublicUrl:path=>({data:{publicUrl:bucket==='creator-music'?'/audio/GrassCatsPopM.mp3':'/images/nart.jpeg'}}),remove:async()=>({}),createSignedUrl:async()=>({data:{signedUrl:'/images/nart.jpeg'}})})}})};
