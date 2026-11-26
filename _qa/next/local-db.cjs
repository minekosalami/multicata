const {PGlite}=require('@electric-sql/pglite');
const fs=require('node:fs');
const ids=['00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000000003'];
async function database(legacyDuplicates=false){
const db=new PGlite();const run=sql=>db.exec(sql);
await run(`create schema auth;create schema storage;create role anon;create role authenticated;create role service_role bypassrls;
create table auth.users(id uuid primary key,raw_user_meta_data jsonb);create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.uid',true),'')::uuid$$;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(bucket_id text,name text);create function storage.foldername(text) returns text[] language sql as $$select string_to_array($1,'/')$$;
create table public.profiles(id uuid primary key default gen_random_uuid(),user_id uuid, username text unique,display_name text,bio text,created_at timestamptz default now(),profile_picture text);
create table public.posts(id uuid primary key default gen_random_uuid(),user_id uuid,content text,created_at timestamptz default now());
create table public.messages(id uuid primary key default gen_random_uuid(),user_id uuid,message text,created_at timestamptz default now());
grant select on public.profiles to anon,authenticated;grant insert,update on public.profiles to authenticated;alter table public.profiles enable row level security;
create policy read on public.profiles for select using(true);create policy own on public.profiles for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
grant usage on schema auth, storage to anon,authenticated;
grant select on storage.objects to anon; grant select,insert,delete on storage.objects to authenticated;alter table storage.objects enable row level security;
grant select,insert,delete on public.posts to authenticated;alter table public.posts enable row level security;
create policy read on public.posts for select to authenticated using(true);
create policy insertown on public.posts for insert to authenticated with check(user_id=auth.uid());
create policy del on public.posts for delete to authenticated using(user_id=auth.uid());
insert into storage.buckets(id,name) values('avatars','avatars');`);
for(const f of fs.readdirSync('supabase/migrations').sort()){
 if(legacyDuplicates && f==='20261121000400_music_community.sql'){
   await run("insert into auth.users values ('00000000-0000-4000-8000-000000000004');insert into profiles(user_id,username) values ('00000000-0000-4000-8000-000000000004','old_name'),('00000000-0000-4000-8000-000000000004','other_name');");
 }
 await run(fs.readFileSync('supabase/migrations/'+f,'utf8'));
}

for(const [i,id] of ids.entries()){
 await db.query('insert into auth.users values ($1)',[id]);
 await db.query('insert into profiles(user_id,username,bio) values($1,$2,$3)',[id,['tester','creator','third'][i],'Disposable QA profile']);
}
for(let i=0;i<3;i++){
 const path=ids[1]+'/'+ids[i]+'.mp3';
 await db.query("insert into storage.objects values('creator-music',$1)",[path]);
 await db.query("insert into tracks(id,user_id,title,release_name,audio_path,credits,duration_seconds) values($1,$2,$3,'QA release',$4,'Fixture credit',104.1)",[ids[i],ids[1],'Fixture recording '+(i+1),path]);
}
await db.query("insert into posts(id,user_id,content) values($1,$2,'Disposable studio update')",[ids[0],ids[1]]);
return db;
}
async function asUser(db,user,fn){
 return db.transaction(async tx=>{
  await tx.exec(user?'set local role authenticated':'set local role anon');
  await tx.query("select set_config('test.uid',$1,true)",[user || '']);
  return fn(tx);
 });
}
module.exports={database,asUser,ids};
