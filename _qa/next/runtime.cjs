const http=require('node:http'),path=require('node:path'),fs=require('node:fs');
const root=process.cwd();
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 if(!/^\/(?:index\.html$|(?:html|css|js|audio|images|catssaga|landingimages|secrets)\/[^/]+$)/.test(pathname))return res.writeHead(404).end();
 const f=path.resolve(root,'.'+pathname);
 if(!f.startsWith(root+path.sep)||!fs.existsSync(f)||!fs.statSync(f).isFile())return res.writeHead(404).end();
 const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.mp3':'audio/mpeg','.webp':'image/webp','.png':'image/png','.jpeg':'image/jpeg','.jpg':'image/jpeg'};
 const size=fs.statSync(f).size,range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range || '');
 if(range){const start=Number(range[1]),end=Math.min(Number(range[2]||size-1),size-1);if(start>end)return res.writeHead(416).end();res.writeHead(206,{'content-range':'bytes '+start+'-'+end+'/'+size,'content-length':end-start+1,'content-type':mime[path.extname(f)],'accept-ranges':'bytes'});return fs.createReadStream(f,{start,end}).pipe(res);}
 res.writeHead(200,{'content-type':mime[path.extname(f)],'content-length':size});fs.createReadStream(f).pipe(res);
});
 async function openVisitor(browser,db,errors,id,width=1280,existingContext){
  const ctx=existingContext || await browser.newContext({viewport:{width,height:width===360?780:850},hasTouch:width===360,isMobile:width===360});
  await ctx.exposeBinding('qaDB',require('./bridge.cjs')(db));
  if(id)await ctx.addInitScript(id=>localStorage.fixtureUser=id,id);
  await ctx.route('**/*',r=>{
   const url=r.request().url();
   if(url.startsWith('https://cdn.jsdelivr.net/'))return r.fulfill({contentType:'application/javascript',path:path.join(__dirname,'adapter.js')});
   if(url.includes('.supabase.co/storage/v1/object/public/creator-music/')){
      const bytes=fs.readFileSync(path.join(root,'audio/GrassCatsPopM.mp3'));
      const range=/^bytes=(\d+)-(\d*)$/.exec(r.request().headers().range || '');
      if(!range)return r.fulfill({contentType:'audio/mpeg',headers:{'accept-ranges':'bytes'},body:bytes});
      const start=Number(range[1]),end=Math.min(Number(range[2]||bytes.length-1),bytes.length-1);
      if(start>end)return r.fulfill({status:416});
      return r.fulfill({status:206,contentType:'audio/mpeg',headers:{'accept-ranges':'bytes','content-range':'bytes '+start+'-'+end+'/'+bytes.length},body:bytes.subarray(start,end+1)});
   }
   if(url.includes('.supabase.co/storage/v1/object/public/community-images/'))return r.fulfill({contentType:'image/jpeg',path:path.join(root,'images/amanda.jpg')});
   return url.startsWith('http://127.0.0.1:')?r.continue():r.abort();
  });
  const page=await ctx.newPage();page.setDefaultTimeout(5000);page.on('pageerror',e=>errors.push(e.message));return page;
 }

module.exports={server,openVisitor};
