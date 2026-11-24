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
    function sample(){
        const section=node("section",null,"sample-print");
        section.append(node("strong","Sample article · unpublished"),node("h3","Notes on a recording"),node("p","A recording note can describe how a track was made, which instruments you hear, and who played them."));
        return section;
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
        let start=0;
        const list=node("div",null,"article-list"),status=feedback(),more=button("Load more articles",load);
        root.append(list,status,more);
        async function load(){
            more.disabled=true;status.textContent="Loading articles…";
            try{
                const rows=preview?await MC.rpc("home_articles"):await query(table("articles").select("id,title,author,published_at,excerpt").eq("published",true).order("published_at",{ascending:false}).order("id").range(start,start+limit));
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
                    list.append(entry);
                }
                if(!rows.length && !start) list.append(node("p","No published articles yet."),sample());
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
        if(!user){root.append(link("Sign in to apply or write","account.html"));return;}
        const [app,admin]=await Promise.all(["writer_applications","editorial_admins"].map(t=>query(table(t).select("*").eq("member",user.id).maybeSingle())));
        if(admin)await administration(root);
        if(app?.status==="approved"){
            const rows=await query(table("articles").select("id,title,published,revision").eq("author",user.id).order("title"));
            const list=node("section",null,"manuscripts");
            list.append(node("h2","Your articles"),link("New draft","writing.html"));
            for(const row of rows)list.append(link(row.title+" · "+(row.published?"Published":"Draft"),"writing.html?edit="+row.id));
            root.append(list);
            const id=new URLSearchParams(location.search).get("edit");
            const row=id?await query(table("articles").select("*").eq("author",user.id).eq("id",id).maybeSingle()):null;
            if(id && !row){root.append(node("p","Draft unavailable."));return;}
            editor(root,row);return;
        }
        if(app){root.append(node("h2","Writer application"),node("p","Application status · "+app.status));return;}
        const form=node("form"),label=node("label","Why would you like to write?"),input=node("textarea"),send=node("button","Submit application"),status=feedback();
        input.required=true;input.maxLength=800;label.append(input);form.append(node("h2","Apply to write"),label,send,status);root.append(form);
        form.onsubmit=async e=>{
            e.preventDefault();send.disabled=true;
            try{await query(table("writer_applications").insert({statement:input.value.trim()}));await desk(root,user);}
            catch{status.textContent="Application could not be saved.";send.disabled=false;}
        };
    }
    async function administration(root){
        const area=node("details"),list=node("div"),status=feedback();
        area.append(node("summary","Review writer applications"),list,status);root.append(area);
        async function refresh(){
            const rows=await query(table("writer_applications").select("*").order("submitted_at"));
            list.replaceChildren();
            for(const r of rows){
                const card=node("article");card.append(await byline(r.member),node("p",r.statement),node("strong",r.status));
                const actions=r.status==="pending"?[["Approve","approved"],["Reject","rejected"]]:r.status==="approved"?[["Revoke writer access","revoked"]]:[["Approve","approved"]];
                for(const [label,next] of actions)card.append(button(label,async e=>{
                    e.currentTarget.disabled=true;
                    try{const result=await query(table("writer_applications").update({status:next}).eq("member",r.member).eq("status",r.status).select("member"));if(!result.length)throw Error();await refresh();}
                    catch{status.textContent="Could not update this application. Reopen to refresh.";}
                }));
                list.append(card);
            }
            if(!rows.length)list.textContent="No applications yet.";
        }
        area.ontoggle=()=>{if(area.open)refresh().catch(()=>status.textContent="Review unavailable.");};
    }
    function editor(root,row){
        const form=node("form",null,"article-editor"),status=feedback();
        const field=(label,input)=>{const el=node("label",label);el.append(input);return el;};
        const title=node("input"),body=node("textarea");
        title.required=true;title.maxLength=160;title.value=row?.title||"";body.maxLength=50000;body.rows=12;body.value=row?.body||"";
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
        labels();form.append(node("h2","Article editor"),field("Title",title),tools,field("Article text",body),media,save,publish,paint,status,preview);root.append(form);
        form.onsubmit=async e=>{
            e.preventDefault();if(save.disabled)return;
            const published=e.submitter===publish?!row?.published:!!row?.published;
            if(published&&!body.value.trim()){status.textContent="Enter article text before publishing.";return;}
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
            }catch{status.textContent="Could not save. Check writer access or reopen the latest version in another tab. Your text is still here.";}
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
