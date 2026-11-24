(async()=>{
    const {node,link,button,feedback,viewer,profile,discussion}=MC;
    const table=name=>supabaseClient.from(name);
    const url=id=>"article.html?id="+encodeURIComponent(id);
    const date=value=>new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
    const query=async request=>{const {data,error}=await request;if(error)throw error;return data;};
    async function byline(id){
        const person=await query(table("profiles").select("username,id").eq("user_id",id).order("username",{nullsFirst:false}).order("id").limit(1).maybeSingle());
        return link(person?.username?"@"+person.username:"Member profile",profile(id));
    }
    function inline(container,text){
        const tokens=/\*\*([^*\n]+)\*\*|_([^_\n]+)_|\[([^\]\n]+)\]\((https?:\/\/[^()\s]+)\)/g;
        let start=0;
        for(const hit of text.matchAll(tokens)){
            container.append(text.slice(start,hit.index));
            if(hit[1]) container.append(node("strong",hit[1]));
            else if(hit[2])container.append(node("em",hit[2]));
            else {
                try {const dest=new URL(hit[4]);container.append(link(hit[3],dest.href));}
                catch {container.append(hit[0]);}
            }
            start=hit.index+hit[0].length;
        }
        container.append(text.slice(start));
    }
    function render(body,id){
        const area=node("div",null,"article-prose");
        for(const block of body.trim().split(/\n\s*\n/)){
            for(const line of block.split(/\n(?=## |!\[)/)){
                const image=/^!\[([^\]\n]{1,200})\]\(image:([0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:png|jpg|webp))\)$/.exec(line.trim());
                if(image && image[2].split("/")[0]===id){
                    const img=node("img");img.alt=image[1];area.append(img);
                    query(supabaseClient.storage.from("article-images").createSignedUrl(image[2],300)).then(data=>{img.src=data.signedUrl;}).catch(()=>img.replaceWith(node("p",image[1]+" (image unavailable)")));
                }else{
                    const heading=line.startsWith("## "),el=node(heading?"h2":"p");
                    inline(el,heading?line.slice(3):line);area.append(el);
                }
            }
        }
        return area;
    }
    async function listing(root){
        const preview=root.hasAttribute("data-preview"),limit=preview?6:12;
        const featured = !preview && new URLSearchParams(location.search).get("view") === "featured";
        let moderator = false;
        if (!preview) {
            const heading = featured ? "Featured articles" : "All Articles";
            document.querySelector(".folio-head h1").textContent = heading;
            document.title = heading + " - Multi-Cata";
            document.querySelector(featured ? "[data-featured-link]" : "[data-all-link]").setAttribute("aria-current", "page");
            if (!featured) {
                const user = await viewer();
                if (user) {
                    const {data} = await table("article_moderators").select("member").eq("member",user.id).maybeSingle();
                    moderator = Boolean(data);
                }
            }
        }
        let start=0;
        const list=node("div",null,"article-list"),status=feedback(),more=button("Load more articles",load);
        root.append(list,status,more);
        async function load(){
            more.disabled=true;status.textContent="Loading articles…";
            try{
                let rows;
                if (preview) rows = await MC.rpc("home_articles");
                else {
                    let request = table("articles").select("id,title,author,published_at,excerpt,featured,revision").eq("published",true);
                    if (featured) request = request.eq("featured",true);
                    rows = await query(request.order("published_at",{ascending:false}).order("id").range(start,start+limit));
                }
                for(const row of rows.slice(0,limit)){
                    const entry=node("article"),title=node("h3"),meta=node("p");
                    title.append(link(row.title,url(row.id)));meta.append(preview?link(row.username?"@"+row.username:"Member profile",profile(row.author)):await byline(row.author)," · "+date(row.published_at));entry.append(title,meta);
                    if(preview && row.image_key){
                        const img=node("img",null,"article-thumb");img.alt=row.image_alt||"";img.width=72;img.height=72;img.loading="lazy";entry.prepend(img);
                        const loadImage=async()=>{
                            try{const data=await query(supabaseClient.storage.from("article-images").createSignedUrl(row.image_key,300));img.src=data.signedUrl;}
                            catch{img.remove();}
                        };
                        const observer=new IntersectionObserver(([hit])=>{if(hit.isIntersecting){observer.disconnect();loadImage();}},{rootMargin:"250px"});
                        observer.observe(img);
                    }
                    const excerpt=row.excerpt.replace(/!\[[^\]]*\]\([^)]*(?:\)|$)/g,"").replace(/\[([^\]]+)\]\([^)]*(?:\)|$)/g,"$1").replace(/^## /gm,"").replace(/\*\*|_/g,"").replace(/\s+/g," ").trim();
                    if(excerpt)entry.append(node("p",excerpt.length>150?excerpt.slice(0,147)+"…":excerpt));
                    if (moderator && !row.featured) {
                        const approve = button("Approve", async () => {
                            approve.disabled = true;
                            try {
                                await MC.rpc("approve_article",{target:row.id,expected_revision:row.revision});
                                approve.replaceWith(node("strong","Featured"));
                            } catch {
                                status.textContent = "Approval failed. Reload the article list and try again.";
                                approve.disabled = false;
                            }
                        });
                        entry.append(approve);
                    } else if (row.featured && !featured) entry.append(node("strong","Featured"));
                    list.append(entry);
                }
                if (!rows.length && !start) {
                    if (featured) list.append(node("p","No featured articles yet."));
                    else list.append(node("h3","Articles"),link("Write your articles here!","writing.html"));
                }
                start+=Math.min(rows.length,limit);more.hidden=preview||rows.length<=limit;status.textContent="";
            }catch{status.textContent="Articles could not be loaded.";more.textContent="Try loading articles again";more.hidden=false;}
            finally{more.disabled=false;}
        }
        await load();
    }
    async function detail(root,user){
        const id=new URLSearchParams(location.search).get("id");
        if(!id){root.textContent="Choose an article from All Articles.";return;}
        const row=await query(table("articles").select("*").eq("id",id).maybeSingle());
        if(!row){root.textContent="Article unavailable.";return;}
        document.title=row.title+" · MultiCata";
        const meta=node("p",null,"article-meta");meta.append(await byline(row.author)," · "+(row.published?date(row.published_at):"Unpublished draft"));
        root.replaceChildren(node("h1",row.title),meta,render(row.body,row.id));
        if(user?.id===row.author)root.append(link("Edit article","writing.html?edit="+row.id));
        if(row.published)root.append(discussion("article",row.id,user,row.author));
    }
    async function desk(root,user){
        root.replaceChildren();
        if(!user){root.append(link("Sign in to write","account.html"));return;}
        const rows=await query(table("articles").select("id,title,published,revision").eq("author",user.id).order("title"));
        const list=node("section",null,"manuscripts");
        list.append(node("h2","Your articles"),link("New draft","writing.html"));
        for(const row of rows)list.append(link(row.title+" · "+(row.published?"Published":"Draft"),"writing.html?edit="+row.id));
        root.append(list);
        const id=new URLSearchParams(location.search).get("edit");
        const row=id?await query(table("articles").select("*").eq("author",user.id).eq("id",id).maybeSingle()):null;
        if(id && !row){root.append(node("p","Draft unavailable."));return;}
        editor(root,row);
    }
    function editor(root,row){
        const form=node("form",null,"article-editor"),status=feedback();
        const field=(label,input)=>{const el=node("label",label);el.append(input);return el;};
        const title=node("input"),body=node("textarea");
        title.required=true;title.maxLength=160;title.value=row?.title||"";body.required=true;body.maxLength=50000;body.rows=12;body.value=row?.body||"";
        const tools=node("div",null,"format-tools");
        function insert(before,after,placeholder){
            const a=body.selectionStart,b=body.selectionEnd;
            const selected=body.value.slice(a,b)||placeholder;
            body.setRangeText(before+selected+after,a,b,"end");body.focus();
        }
        for(const [label,start,end,example] of [["Heading","\n\n## ","\n\n","Heading"],["Bold","**","**","bold text"],["Italic","_","_","italic text"],["Link","[","](https://example.com)","link text"]])
            tools.append(button(label,()=>insert(start,end,example)));
        const image=node("input");image.type="file";image.accept="image/png,image/jpeg,image/webp";
        const alt=node("input");alt.maxLength=200;
        const upload=button("Insert image",async()=>{
            const file=image.files[0],ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file?.type];
            if(!row){status.textContent="Save a draft before adding an image.";return;}
            if(!ext||file.size>5242880||!alt.value.trim()||/[\]\n]/.test(alt.value)){status.textContent="Choose a JPG, PNG or WebP up to 5 MB and enter a description without brackets.";return;}
            const key=row.id+"/"+crypto.randomUUID()+"."+ext;
            upload.disabled=true;
            try{await query(supabaseClient.storage.from("article-images").upload(key,file));body.setRangeText("\n\n!["+alt.value.trim()+"](image:"+key+")\n\n",body.selectionStart,body.selectionEnd,"end");body.focus();image.value="";status.textContent="Image inserted. Save your changes.";}
            catch{status.textContent="Image upload failed.";}finally{upload.disabled=false;}
        });
        const media=node("details");media.append(node("summary","Add an image"),field("Image description",alt),field("Image file",image),upload);
        const preview=node("div"),paint=button("Preview",()=>{preview.replaceChildren(node("h2",title.value||"Preview"),render(body.value,row?.id));});
        const save=node("button"),publish=node("button");
        function labels(){save.textContent=row?.published?"Save changes":"Save draft";publish.textContent=row?.published?"Unpublish":"Publish";}
        labels();form.append(node("h2","Article editor"),field("Title",title),tools,field("Article text (at least 100 characters)",body),media,save,publish,paint,status,preview);root.append(form);
        form.onsubmit=async e=>{
            e.preventDefault();if(save.disabled)return;
            const published=e.submitter===publish?!row?.published:!!row?.published;
            if (!title.value.trim()) {status.textContent="Enter a title.";title.focus();return;}
            if (Array.from(body.value.trim()).length < 100) {status.textContent="Enter at least 100 characters of article text.";body.focus();return;}
            const values={title:title.value.trim(),body:body.value,published};
            save.disabled=publish.disabled=true;
            try{
                const request=row?table("articles").update(values).eq("id",row.id).eq("revision",row.revision):table("articles").insert(values);
                const saved=await query(request.select("*").maybeSingle());
                if(!saved)throw Error();
                row=saved;history.replaceState(null,"","writing.html?edit="+row.id);labels();
                const directory=root.querySelector(".manuscripts"),href="writing.html?edit="+row.id;
                let entry=directory.querySelector('a[href="'+href+'"]');
                if(!entry){entry=link("",href);directory.append(entry);}
                entry.textContent=row.title+" · "+(row.published?"Published":"Draft");
                status.replaceChildren(row.published?"Published. ":"Draft saved. ",link("Read article",url(row.id)));
            }catch{status.textContent="Could not save. Reopen the latest version in another tab. Your text is still here.";}
            finally{save.disabled=publish.disabled=false;}
        };
    }
    const index=document.querySelector("[data-article-list]");
    if(index)await listing(index);
    const reader=document.querySelector("#article-detail"),workspace=document.querySelector("#writing-desk");
    if(reader||workspace){
        try{const user=await viewer();if(reader)await detail(reader,user);else await desk(workspace,user);}
        catch{(reader||workspace).textContent="This page could not be loaded. Please try again.";}
    }
})();
