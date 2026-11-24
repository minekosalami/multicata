const {asUser,ids}=require('./local-db.cjs');
const ident=k=>{if(!/^[a-z_][a-z_0-9]*$/.test(k))throw Error('Invalid identifier');return '"'+k+'"';};
const storedBytes=new WeakMap();
module.exports=db=>async(_source,user,req)=>{
 try{
  if(user && !ids.includes(user))throw Error('Unknown fixture identity');
  const data=await asUser(db,user,async tx=>{
   if(!storedBytes.has(db))storedBytes.set(db,new Map());
   if(req.sign){
    const {bucket,path}=req.sign;
    const allowed=await tx.query("select name from storage.objects where bucket_id=$1 and name=$2",[bucket,path]);
    if(!allowed.rows.length)throw Error("Image unavailable");
    return {signedUrl:storedBytes.get(db).get(path)};
   }
   if(req.upload){await tx.query("insert into storage.objects(bucket_id,name) values($1,$2)",[req.upload.bucket,req.upload.path]);if(req.upload.bytes)storedBytes.get(db).set(req.upload.path,req.upload.bytes);return null;}
   if(req.name){
    const names=Object.keys(req.args);
    const args=names.map((n,i)=>ident(n)+' => $'+(i+1)).join(',');
    const result=(await tx.query('select * from public.'+ident(req.name)+'('+args+')',Object.values(req.args))).rows;
    return ['can_message','leave_comment','music_reaction','change_follow','remove_comment','mark_notices'].includes(req.name)?result[0]?.[req.name]:result;
   }
   const table=ident(req.table),values=[];
   const param=v=>{values.push(v);return '$'+values.length;};
   const cols=!req.cols || req.cols==='*'?'*':req.cols.split(',').map(k=>ident(k.trim())).join(',');
   let sql;
   if(req.op==='insert'){const keys=Object.keys(req.data);sql='insert into '+table+'('+keys.map(ident)+') values('+Object.values(req.data).map(param)+')';}
   else if(req.op==='update')sql='update '+table+' set '+Object.entries(req.data).map(([k,v])=>ident(k)+'='+param(v)).join(',');
   else sql=req.op==='delete'?'delete from '+table:'select '+cols+' from '+table;
   const clauses=req.filters.map(([k,vs])=>vs.length?ident(k)+' in ('+vs.map(param)+')':'false');
   if(req.any){
    if(req.table!=='private_messages')throw Error('Unsupported fixture filter');
    const members=[...new Set(req.any.match(/[0-9a-f-]{36}/g))];
    const peer=members.find(m=>m!==user);
    clauses.push('((sender='+param(user)+' and recipient='+param(peer)+') or (sender='+param(peer)+' and recipient='+param(user)+'))');
   }
   if(clauses.length)sql+=' where '+clauses.join(' and ');
   if(req.orders.length)sql+=' order by '+req.orders.map(([k,asc])=>ident(k)+(asc?' asc nulls last':' desc')).join(',');
   if(req.limit!=null)sql+=' limit '+Number(req.limit);
   if(req.offset)sql+=' offset '+Number(req.offset);
   if(req.op!=='select' && req.cols)sql+=' returning '+cols;
   const rows=(await tx.query(sql,values)).rows;
   return req.one?(rows[0] || null):rows;
  });
  return {count:req.count?data.length:null,data:JSON.parse(JSON.stringify(data,(_k,v)=>typeof v==='bigint'?Number(v):v)) ?? null,error:null};
 }catch(error){return {data:null,error:{message:error.message,code:error.code}};}
};
