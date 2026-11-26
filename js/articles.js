(async()=>{
    const {node,link,button,feedback,viewer,profile,discussion}=MC;
    const table=name=>supabaseClient.from(name);
    const url=id=>"article.html?id="+encodeURIComponent(id);
    const date=value=>new Date(value).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"numeric"});
    const query=async request=>{const {data,error}=await request;if(error)throw error;return data;};
    function deviceBookmarks(account){
        const prefix="mc-bookmark:"+account+":";
        return Object.keys(localStorage).filter(key=>key.startsWith(prefix)).map(key=>key.slice(prefix.length))
            .filter(id=>/^[\da-f]{8}(-[\da-f]{4}){3}-[\da-f]{12}$/i.test(id));
    }
    async function importBookmarks(account){
        const ids=deviceBookmarks(account);
        for(let start=0;start<ids.length;start+=100){
            const batch=ids.slice(start,start+100);
            await MC.rpc("import_article_bookmarks",{items:batch});
            for(const id of batch)localStorage.removeItem("mc-bookmark:"+account+":"+id);
        }
    }
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
                const trackId=/^\[track:([0-9a-f-]{36})\]$/i.exec(line.trim())?.[1];
                if(trackId){
                    const holder=node("div");area.append(holder);holder.append(link("Open track",MC.track(trackId)));
                    MC.rpc("music_page",{wanted:trackId}).then(([r])=>{if(r)holder.replaceChildren(MC.recording(r));}).catch(()=>{});
                    continue;
                }
                if(line.startsWith("Credits: @")){const credit=node("p");MC.mentions(credit,line);area.append(credit);continue;}
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
            {
                const user = await viewer();
                if (user) {
                    const {data} = await table("article_moderators").select("member").eq("member",user.id).maybeSingle();
                    moderator = Boolean(data);
                }
            }
        }
        const params=new URLSearchParams(location.search);
        if(!preview){
            const filters=node("form",null,"article-views");
            for(const [key,label] of [["q","Search title, author or text"],["topic","Topic"],["series","Series"]]){
                const input=node("input");input.name=key;input.value=params.get(key)||"";const wrap=node("label",label);wrap.append(input);filters.append(wrap);
            }
            const sort=node("select");sort.name="sort";sort.setAttribute("aria-label","Sort articles");
            for(const [v,t] of [["new","Newest"],["liked","Most liked"],["following","Following"]])sort.add(new Option(t,v));
            sort.value=params.get("sort")||"new";filters.append(sort,node("button","Search"));
            for(const key of ["view","writer"]){if(params.has(key)){const input=node("input");input.type="hidden";input.name=key;input.value=params.get(key);filters.append(input);}}
            filters.onsubmit=e=>{e.preventDefault();const href="articles.html?"+new URLSearchParams(new FormData(filters));
                if(!window.multiCataPlayer?.navigate(new URL(href,location.href).href))location.assign(href);};
            if(params.has("release"))root.append(node("h2","Release liner notes"));
            root.append(filters);
            const saved=node("details"),items=node("div");saved.append(node("summary","Saved for later"),items);root.append(saved);
            const account=(await viewer())?.id||"guest";
            let listRequest=0;
            saved.ontoggle=async()=>{
                const request=++listRequest;
                if(!saved.open)return;
                items.textContent="Loading saved articles…";
                try{
                    const entries=node("ul");
                    if(account==="guest"){
                        const ids=deviceBookmarks(account);
                        for(let start=0;start<ids.length;start+=50){
                            const rows=await query(table("articles").select("id,title").eq("published",true).in("id",ids.slice(start,start+50)));
                            for(const row of rows)add(row);
                        }
                    }else{
                        await importBookmarks(account);
                        for(let start=0;;start+=50){
                            const rows=await MC.rpc("saved_articles",{start_at:start});
                            for(const row of rows)add(row);
                            if(rows.length<50 || request!==listRequest)break;
                        }
                    }
                    function add(row){const li=node("li");li.append(link(row.title,url(row.id)));entries.append(li);}
                    if(request===listRequest)items.replaceChildren(entries.children.length?entries:account==="guest"?"No saved articles on this device.":"No saved articles yet.");
                }catch{if(request===listRequest)items.textContent="Could not load saved articles. Reopen to try again.";}
            };
            if(moderator){
                const reports=node("details"),entries=node("div");reports.append(node("summary","Article and reply reports"),entries);root.append(reports);
                reports.ontoggle=async()=>{
                    if(!reports.open)return;
                    try{
                        const rows=await query(table("writing_reports").select("article,entry,reason").limit(100));
                        entries.replaceChildren();for(const r of rows){
                            const item=node("article");item.append(node("p",r.reason));
                            if(r.article)item.append(link("Read reported article",url(r.article)));
                            else{const c=await query(table("community_comments").select("id,body,article_id,record_id,profile_user,post_id").eq("id",r.entry).maybeSingle());
                                if(c){const dest=c.article_id?url(c.article_id):c.record_id?MC.track(c.record_id):c.post_id?"posts.html?post="+c.post_id:profile(c.profile_user);item.append(link("Read reported message",dest+"#comment-"+c.id));}}
                            entries.append(item);
                        }
                        if(!rows.length)entries.textContent="No reports.";
                    }catch{entries.textContent="Could not load reports.";}
                };
            }
            if(featured){
                const history=node("details"),entries=node("div");history.append(node("summary","Previously featured"),entries);root.append(history);
                history.ontoggle=async()=>{if(!history.open)return;try{const historyRows=await query(table("feature_history").select("*").order("featured_at",{ascending:false}).limit(50));
                    entries.replaceChildren();for(const h of historyRows){const article=await query(table("articles").select("title").eq("id",h.article).maybeSingle());if(article)entries.append(link(article.title+" · "+date(h.featured_at),url(h.article)));}
                    if(!entries.childNodes.length)entries.textContent="No featured history yet.";
                }catch{entries.textContent="Could not load featured history.";}};
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
                    rows=params.has("release")?await MC.rpc("release_liner_notes",{recording:params.get("release"),start_at:start}):await MC.rpc("browse_articles",{search_text:params.get("q")||"",selected_topic:params.get("topic")||"",selected_series:params.get("series")||"",writer:params.get("writer")||null,following_only:params.get("sort")==="following",featured_only:featured,most_liked:params.get("sort")==="liked",start_at:start});
                }
                const batch=document.createDocumentFragment();
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
                    for(const k of ["topic","series"])if(row[k])entry.append(link(row[k],"articles.html?"+k+"="+encodeURIComponent(row[k])));
                    batch.append(entry);
                }
                list.append(batch);
                more.textContent="Load more articles";
                if (!rows.length && !start) {
                    if (["q","topic","series","writer","sort","release"].some(k=>params.get(k))) list.append(node("p","No matching articles."));
                    else if (featured) list.append(node("p","No featured articles yet."));
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
        const token=new URLSearchParams(location.search).get("preview");
        if(token){
            const [draft]=await MC.rpc("preview_article",{access_key:token});
            if(draft)root.replaceChildren(node("p","Private preview"),node("h1",draft.title),render(draft.body,draft.id));
            else root.textContent="This preview link is unavailable.";
            return;
        }
        if(!id){root.textContent="Choose an article from All Articles.";return;}
        const row=await query(table("articles").select("*").eq("id",id).maybeSingle());
        if(!row){root.textContent="Article unavailable.";return;}
        document.title=row.title+" · MultiCata";
        const meta=node("p",null,"article-meta");meta.append(await byline(row.author)," · "+(row.published?date(row.published_at):"Unpublished draft"));
        root.replaceChildren(node("h1",row.title),meta,render(row.body,row.id));
        if(user?.id===row.author)root.append(link("Edit article","writing.html?edit="+row.id));
        if(!row.published)return;
        const prose=root.querySelector(".article-prose"),controls=node("div",null,"article-views"),account=user?.id||"guest";
        meta.append(" · "+Math.max(1,Math.ceil(row.body.trim().split(/\s+/).length/200))+" min read");
        const key="mc-bookmark:"+account+":"+id;
        let marked=false,loaded=false;
        const bookmarkStatus=feedback(),bookmark=button("Save for later",async()=>{
            if(!loaded){await loadBookmark();return;}
            bookmark.disabled=true;bookmarkStatus.textContent="";
            try{
                if(user)await MC.rpc("set_article_bookmark",{target:id,desired:!marked});
                else if(marked)localStorage.removeItem(key);
                else localStorage.setItem(key,"1");
                marked=!marked;showBookmark();
            }catch{bookmarkStatus.textContent="Could not update your bookmark. Try again.";}
            finally{bookmark.disabled=false;}
        });
        function showBookmark(){
            bookmark.textContent=marked?"Remove bookmark":"Save for later";
            bookmark.setAttribute("aria-pressed",marked);
        }
        async function loadBookmark(){
            bookmark.disabled=true;bookmarkStatus.textContent="";
            try{
                if(user){
                    await importBookmarks(account);
                    const entry=await query(table("article_bookmarks").select("saved").eq("member",account).eq("article",id).maybeSingle());
                    marked=Boolean(entry?.saved);
                }else marked=Boolean(localStorage.getItem(key));
                loaded=true;showBookmark();
            }catch{bookmark.textContent="Retry bookmark";bookmarkStatus.textContent="Could not load your bookmark.";}
            finally{bookmark.disabled=false;}
        }
        controls.append(bookmark,bookmarkStatus);loadBookmark();
        const size=node("select");size.setAttribute("aria-label","Reading text size");
        for(const [k,v] of [["1","Standard text"],["1.2","Large text"],["1.45","Extra large text"]])size.add(new Option(v,k));
        size.value=localStorage.getItem("mc-reading-size")||"1";prose.style.fontSize=size.value+"em";
        size.onchange=()=>{localStorage.setItem("mc-reading-size",size.value);prose.style.fontSize=size.value+"em";};controls.append(size);
        const outline=node("details");outline.append(node("summary","Sections"));
        [...prose.querySelectorAll("h2")].forEach((h,i)=>{h.id="section-"+(i+1);outline.append(link(h.textContent,"#"+h.id),MC.copyLink("Copy section link","#"+h.id));});
        if(outline.children.length>1)controls.append(outline);
        prose.before(controls);
        const place="mc-reading:"+account+":"+id,position=Number(localStorage.getItem(place));
        if(position>100 && !location.hash)controls.append(button("Resume reading",()=>window.scrollTo(0,position)));
        window.addEventListener("pagehide",()=>localStorage.setItem(place,String(scrollY)),{once:true});
        if(location.hash.startsWith("#section-"))document.getElementById(location.hash.slice(1))?.scrollIntoView();
        if(row.feature_note)root.append(node("p","Moderator note: "+row.feature_note));
        root.append((await MC.voting("article",[id],user))(id),link("More by this author","articles.html?writer="+row.author));
        if(user && user.id!==row.author)root.append(MC.report("article",id));
        if(user && (await query(table("article_moderators").select("member").eq("member",user.id).maybeSingle()))){
            const action=button(row.featured?"Remove from featured":"Approve",async()=>{
                const note=row.featured?"":await communityDialog("Feature article","Approve",{label:"Moderator note (optional)",limit:300});
                if(note===null)return;
                action.disabled=true;try{await MC.rpc("set_article_feature",{target:id,expected_revision:row.revision,enabled:!row.featured,note});await detail(root,user);}
                catch{action.textContent="Refresh before moderating again";}
            });root.append(action);
        }
        root.append(discussion("article",row.id,user,row.author));
    }
    async function desk(root,user){
        root.replaceChildren();
        if(!user){root.append(link("Sign in to write","account.html?next=article"));return;}
        const rows=await query(table("articles").select("id,title,published,updated_at").eq("author",user.id).order("updated_at",{ascending:false}));
        const list=node("section",null,"manuscripts");
        list.append(node("h2","Your articles"),link("New draft","writing.html"));
        for(const published of [false,true]){
            const group=node("section");group.dataset.published=String(published);group.append(node("h3",published?"Published":"Drafts"));
            for(const row of rows.filter(r=>r.published===published))group.append(link(row.title,"writing.html?edit="+row.id));
            list.append(group);
        }
        const prompts=["Write the liner notes for a favorite track.","Introduce a character through a scene.","What changed between your first demo and the finished version?"];
        let promptIndex=0;const prompt=node("p");
        list.append(button("Give me a writing prompt",()=>{prompt.textContent=prompts[promptIndex++%prompts.length];}),prompt);
        root.append(list);
        const id=new URLSearchParams(location.search).get("edit");
        const row=id?await query(table("articles").select("*").eq("author",user.id).eq("id",id).maybeSingle()):null;
        if(id && !row){root.append(node("p","Draft unavailable."));return;}
        editor(root,row,user);
    }
    function writingTools(form,user,row,title,body,status,save) {
        const count=node("p"),state=feedback(),fields={};
        const options=node("details");options.append(node("summary","Article details"));
        for(const [key,label,max] of [["topic","Topic",80],["series","Series",120],["summary","Preview excerpt",300]]){
            const input=node("input"),wrapper=node("label",label);
            input.maxLength=max;input.value=row?.[key]||"";wrapper.append(input);options.append(wrapper);fields[key]=input;
        }
        const storageKey=()=> "mc-writing:"+user.id+":"+(row?.id||"new");
        const values=()=>Object.fromEntries(Object.entries(fields).map(([k,input])=>[k,input.value.trim()]));
        const snapshot=()=>({title:title.value,body:body.value,...values(),revision:row?.revision||0});
        function apply(data){
            title.value=data.title;body.value=data.body;
            for(const k in fields)fields[k].value=data[k]||"";
            changed();
        }
        function measure(){
            const n=Array.from(body.value.trim()).length,w=body.value.trim().split(/\s+/).filter(Boolean).length;
            count.textContent=w+" words · "+Math.max(1,Math.ceil(w/200))+" min read · "+(n<100?(100-n)+" characters to go":n+" characters");
        }
        function changed(){
            if(status.querySelector('a'))status.replaceChildren();
            measure();
            try{localStorage.setItem(storageKey(),JSON.stringify(snapshot()));state.textContent="Unsaved changes · recoverable on this device";}
            catch{state.textContent="Unsaved changes · device storage unavailable";}
        }
        form.addEventListener("input",changed);
        form.addEventListener("keydown",e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();if(!save.disabled)form.requestSubmit(save);}});
        form.insertBefore(options,save);body.after(count);form.append(state);
        let recoveryPrompt;
        let backup;
        try{backup=JSON.parse(localStorage.getItem(storageKey()));}catch{}
        if(backup){
            const restore=node("section"),use=button("Restore unfinished writing",()=>{apply(backup);restore.remove();});
            if(row && backup.revision!==row.revision)restore.append(node("p","A newer version was saved. Compare the editor with your recovery copy before restoring it."),node("pre",backup.title+"\n\n"+backup.body));
            restore.append(use,button("Discard recovery copy",()=>{localStorage.removeItem(storageKey());restore.remove();}));
            recoveryPrompt=restore;form.prepend(restore);
        }
        if(row?.featured)form.insertBefore(node("p","Editing this featured article sends it back for approval."),save);
        const versions=node("details"),items=node("div");
        versions.append(node("summary","Version history"),items);form.append(versions);
        versions.ontoggle=async()=>{
            if(!versions.open)return;
            if(!row){items.textContent="Save your draft to start its history.";return;}
            try{
                const rows=await query(table("article_versions").select("*").eq("article",row.id).order("revision",{ascending:false}).limit(30));
                items.replaceChildren();for(const v of rows)items.append(button("Restore revision "+v.revision+" · "+v.title,()=>apply(v)));
                if(!rows.length)items.textContent="No earlier revisions.";
            }catch{items.textContent="Could not load earlier versions.";}
        };
        const share=node("details"),sharing=node("div");share.append(node("summary","Private preview link"),sharing);form.append(share);
        async function shareMenu(){
            sharing.replaceChildren(node("p","Anyone with this link can read the latest saved text until you revoke it. Draft images stay private."));if(!row){sharing.textContent="Save your draft first.";return;}
            try{
                const record=await query(table("article_shares").select("token").eq("article",row.id).maybeSingle());
                if(record){const href="article.html?preview="+record.token;sharing.append(link("Open private preview",href),MC.copyLink("Copy preview link",href));}
                sharing.append(button(record?"Revoke preview link":"Create preview link",async e=>{
                    e.currentTarget.disabled=true;
                    try{await query(record?table("article_shares").delete().eq("article",row.id):table("article_shares").insert({article:row.id}));await shareMenu();}
                    catch{sharing.textContent="Could not change preview sharing. Reopen to retry.";}
                }));
            }catch{sharing.textContent="Could not load sharing settings.";}
        }
        share.ontoggle=()=>{if(share.open)shareMenu();};
        measure();
        return {values,changed,state,saved(next,submitted){
            recoveryPrompt?.remove();
            const edited=JSON.stringify(snapshot())!==submitted;try{localStorage.removeItem(storageKey());}catch{}row=next;
            if(edited)changed();else state.textContent="";
        },snapshot:()=>JSON.stringify(snapshot())};
    }

    function editor(root,row,user){
        const form=node("form",null,"article-editor"),status=feedback();
        const field=(label,input)=>{const el=node("label",label);el.append(input);return el;};
        const title=node("input"),body=node("textarea");
        title.required=true;title.maxLength=160;title.value=row?.title||"";body.required=true;body.maxLength=50000;body.rows=12;body.value=row?.body||"";
        const sourceTrack=new URLSearchParams(location.search).get("track");
        if(!row && /^[0-9a-f-]{36}$/i.test(sourceTrack||""))body.value="[track:"+sourceTrack+"]\n\n";
        const tools=node("div",null,"format-tools");
        function insert(before,after,placeholder){
            const a=body.selectionStart,b=body.selectionEnd;
            const selected=body.value.slice(a,b)||placeholder;
            body.setRangeText(before+selected+after,a,b,"end");body.focus();extras.changed();
        }
        for(const [label,start,end,example] of [["Heading","\n\n## ","\n\n","Heading"],["Bold","**","**","bold text"],["Italic","_","_","italic text"],["Link","[","](https://example.com)","link text"]])
            tools.append(button(label,()=>insert(start,end,example)));
        let beforeFormat;
        tools.addEventListener("click",()=>{beforeFormat=body.value;},true);
        let undoValue;
        body.addEventListener("input",()=>{undoValue=undefined;});
        tools.addEventListener("click",e=>{if(e.target!==undo)undoValue=beforeFormat;});
        const undo=button("Undo formatting",()=>{if(undoValue!==undefined){body.value=undoValue;undoValue=undefined;extras.changed();}});
        tools.append(undo,button("Insert track",async()=>{
            const raw=await communityDialog("Insert a Multi-Cata track","Insert",{label:"Multi-Cata track URL",limit:500});
            if(!raw)return;let id;try{id=new URL(raw,location.href).searchParams.get("id");}catch{}
            if(!/^[0-9a-f-]{36}$/i.test(id||"")){status.textContent="Choose a link from a Multi-Cata track page.";return;}
            body.setRangeText("\n\n[track:"+id+"]\n\n",body.selectionStart,body.selectionEnd,"end");extras.changed();
        }),button("Credit a collaborator",async()=>{
            const name=await communityDialog("Credit a collaborator","Insert",{label:"Multi-Cata username",limit:21});
            if(!name)return;const handle=name.trim().replace(/^@/,"");
            if(!/^[a-z0-9_]{1,20}$/i.test(handle)){status.textContent="Enter a valid username.";return;}
            body.setRangeText("\n\nCredits: @"+handle,body.selectionStart,body.selectionEnd,"end");extras.changed();
        }));
        const image=node("input");image.type="file";image.accept="image/png,image/jpeg,image/webp";
        const alt=node("input");alt.maxLength=200;
        const upload=button("Insert image",async()=>{
            const file=image.files[0],ext={"image/png":"png","image/jpeg":"jpg","image/webp":"webp"}[file?.type];
            if(!row){status.textContent="Save a draft before adding an image.";return;}
            if(!ext||file.size>5242880||!alt.value.trim()||/[\]\n]/.test(alt.value)){status.textContent="Choose a JPG, PNG or WebP up to 5 MB and enter a description without brackets.";return;}
            const key=row.id+"/"+crypto.randomUUID()+"."+ext;
            upload.disabled=true;
            try{await query(supabaseClient.storage.from("article-images").upload(key,file));body.setRangeText("\n\n!["+alt.value.trim()+"](image:"+key+")\n\n",body.selectionStart,body.selectionEnd,"end");body.focus();image.value="";extras.changed();status.textContent="Image inserted. Save your changes.";}
            catch{status.textContent="Image upload failed.";}finally{upload.disabled=false;}
        });
        const media=node("details");media.append(node("summary","Add an image"));const imageHint=node("p","Save a draft before adding an image.");imageHint.hidden=Boolean(row);media.append(imageHint,field("Image description",alt),field("Image file",image),upload);
        const preview=node("div",null,"writing-preview");preview.hidden=true;
        const paint=button("Preview",()=>{preview.hidden=!preview.hidden;form.classList.toggle("previewing",!preview.hidden);
            paint.textContent=preview.hidden?"Preview":"Back to writing";if(!preview.hidden)refreshPreview();});
        function refreshPreview(){preview.replaceChildren(node("h2",title.value||"Preview"),render(body.value,row?.id));}
        let timer;form.addEventListener("input",()=>{if(!preview.hidden){clearTimeout(timer);timer=setTimeout(refreshPreview,300);}});
        const save=node("button"),publish=node("button");
        function labels(){save.textContent=row?.published?"Save changes":"Save draft";publish.textContent=row?.published?"Unpublish":"Publish";}
        labels();form.append(node("h2","Article editor"),field("Title",title),tools,field("Article text (at least 100 characters)",body),media,save,publish,paint,status,preview);root.append(form);
        const extras=writingTools(form,user,row,title,body,status,save);
        if(new URLSearchParams(location.search).get("compose")==="article")title.focus();
        form.onsubmit=async e=>{
            e.preventDefault();if(save.disabled)return;
            const published=e.submitter===publish?!row?.published:!!row?.published;
            if (!title.value.trim()) {status.textContent="Enter a title.";title.focus();return;}
            if (Array.from(body.value.trim()).length < 100) {status.textContent="Enter at least 100 characters of article text.";body.focus();return;}
            const values={title:title.value.trim(),body:body.value,published,...extras.values()};
            const submitted=extras.snapshot();extras.state.textContent="Saving...";
            save.disabled=publish.disabled=true;
            try{
                const request=row?table("articles").update(values).eq("id",row.id).eq("revision",row.revision):table("articles").insert(values);
                const saved=await query(request.select("*").maybeSingle());
                if(!saved){
                    const latest=await query(table("articles").select("*").eq("id",row.id).maybeSingle());
                    if(!latest)throw Error();
                    const compare=node("details");compare.open=true;compare.append(node("summary","Compare with latest saved version"),node("h3",latest.title),node("pre",latest.body),button("Keep my text and edit against this version",()=>{row=latest;compare.remove();extras.changed();}));
                    status.replaceChildren("Another tab saved changes. Your text is still in the editor.",compare);extras.state.textContent="Unsaved changes";return;
                }
                extras.saved(saved,submitted);imageHint.hidden=true;
                row=saved;history.replaceState(null,"","writing.html?edit="+row.id);labels();
                const directory=root.querySelector(".manuscripts"),href="writing.html?edit="+row.id;
                let entry=directory.querySelector('a[href="'+href+'"]');
                if(!entry)entry=link("",href);
                directory.querySelector('[data-published="'+row.published+'"]').prepend(entry);
                entry.textContent=row.title+" · "+(row.published?"Published":"Draft");
                status.replaceChildren(row.published?"Published. ":"Draft saved. ",link("Read article",url(row.id)));
            }catch{extras.state.textContent="Unsaved changes";status.textContent="Could not save. Reopen the latest version in another tab. Your text is still here.";}
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
