// Browser-side substitute for the SDK. All social RPCs and table requests run as
// the chosen fixture identity in the isolated database, via a Playwright binding.
(() => {
 const identity=()=>localStorage.fixtureUser || null;
 const auth={
  getUser:async()=>({data:{user:identity()?{id:identity(),email:"fixture@example.test"}:null}}),
  onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}}),
  signOut:async()=>{localStorage.removeItem("fixtureUser");return {error:null};}
 };
 function from(table){
  const req={table,op:"select",filters:[],orders:[]};
  const chain={
   select(cols="*",options={}){req.cols=cols;req.count=!!options.count;return chain;},
   insert(data){req.op="insert";req.data=data;return chain;},update(data){req.op="update";req.data=data;return chain;},
   delete(){req.op="delete";return chain;},eq(k,v){req.filters.push([k,[v]]);return chain;},in(k,v){req.filters.push([k,v]);return chain;},
   order(k,opt={}){req.orders.push([k,opt.ascending!==false]);return chain;},limit(n){req.limit=n;return chain;},
   range(a,b){req.limit=b-a+1;req.offset=a;return chain;},single(){req.one=true;return chain;},maybeSingle(){req.one=true;return chain;},
   or(expr){req.any=expr;return chain;},then(done,fail){return window.qaDB(identity(),req).then(done,fail);}
  };return chain;
 }
 const root="https://ncmizvdipzjwiknslohn.supabase.co/storage/v1/object/public/";
 window.supabase={createClient:()=>({auth,from,rpc:(name,args={})=>window.qaDB(identity(),{name,args}),
 storage:{from:bucket=>({getPublicUrl:path=>({data:{publicUrl:root+bucket+"/"+path}}),upload:async(path,file)=>{
  let bytes;
  if(bucket==="article-images")bytes=await new Promise((done,fail)=>{const reader=new FileReader();reader.onload=()=>done(reader.result);reader.onerror=fail;reader.readAsDataURL(file);});
  return window.qaDB(identity(),{upload:{bucket,path,bytes}});
 },
 remove:async()=>({error:null}),createSignedUrl:async path=>bucket==="article-images"?window.qaDB(identity(),{sign:{bucket,path}}):({data:{signedUrl:"../images/nart.jpeg"}})})}})};
})();
