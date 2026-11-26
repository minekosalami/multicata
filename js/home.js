(async()=>{
    const {node, link, viewer, rpc}=MC;
    const inbox=document.querySelector("#home-inbox"), posts=document.querySelector("#recentPosts");
    const creators=document.querySelector("#home-creators");
    function timestamp(value) {
        const t=node("time", new Date(value).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}));
        t.dateTime=value;return t;
    }
    async function directory(){
        try{
            const people=await rpc("home_creators");
            if(!people.length)creators.append(node("p","Published music and articles will link to their creators here."));
            for(const c of people){
                const entry=node("div",null,"creator-entry"), credits=[];
                if(Number(c.recordings))credits.push(c.recordings+(Number(c.recordings)===1?" recording":" recordings"));
                if(Number(c.articles))credits.push(c.articles+(Number(c.articles)===1?" article":" articles"));
                entry.append(link(c.username?"@"+c.username:"Creator profile",MC.profile(c.user_id)),node("small",credits.join(" · ")));
                creators.append(entry);
            }
        } catch{creators.textContent="Community creator list unavailable.";}
    }
    directory();
    try {
        const user=await viewer();
        const grid=document.querySelector(".portal-grid"),widgets=[...grid.querySelectorAll(":scope > section")];
        const scope="mc-home:"+(user?.id||"guest")+":";
        const settings=node("details"),choices=node("div");settings.append(node("summary","Customize homepage"),choices);
        document.querySelector(".flight-index").append(settings);
        function arrange(){
            const pinned=widgets.filter(w=>localStorage.getItem(scope+w.id+":pin"));
            const ordered=[...pinned,...widgets.filter(w=>!pinned.includes(w))];
            const radio=grid.querySelector(".radio-widget");
            const afterPair=ordered.findLastIndex(w=>w.id==="music" || w.id==="posts")+1;
            ordered.splice(afterPair,0,radio);
            grid.append(...ordered);
        }
        for(const w of widgets){
            const title=w.querySelector("h2").textContent;
            for(const [action,label] of [["pin","Pin"],["collapse","Collapse"]]){
                const key=scope+w.id+":"+action,field=node("label"),box=node("input");
                box.type="checkbox";box.checked=Boolean(localStorage.getItem(key));field.append(box," "+label+" "+title);choices.append(field);
                function apply(){if(action==="collapse")w.classList.toggle("collapsed-widget",box.checked);else arrange();}
                box.onchange=()=>{if(box.checked)localStorage.setItem(key,"1");else localStorage.removeItem(key);apply();};apply();
            }
        }
        if(user){
            const {data}=await supabaseClient.from("articles").select("id,title").eq("author",user.id).eq("published",false).order("updated_at",{ascending:false}).limit(1).maybeSingle();
            if(data || localStorage.getItem("mc-writing:"+user.id+":new"))document.querySelector(".update-strip").append(link("Continue your draft",data?"writing.html?edit="+data.id:"writing.html"));
        }
        // Shared-browser sign-out or an account switch also invalidates private previews.
        supabaseClient.auth.onAuthStateChange((event,session)=>{
            if(event!=="SIGNED_OUT" && event!=="SIGNED_IN")return;
            if((session?.user?.id || null)===(user?.id || null))return;
            inbox.replaceChildren();posts.replaceChildren();
            if(!document.querySelector(".player-page"))location.reload();
        });
        if (!user) {
            inbox.append(link("Sign in to open your conversations","account.html"));
            posts.append(node("p","Sign in to browse community discussions."),link("Sign in","account.html"));
            document.querySelector("#accountButton").textContent="Sign In";
            return;
        }
        await Promise.all([
            (async()=>{
                const notices=await rpc("notice_feed");
                const count=notices.filter(n=>n.kind==="reply"&&!n.seen).length;
                if(count)document.querySelector("#chats footer").append(link(count+(count===1?" unread reply":" unread replies"),"notices.html"));
            })().catch(()=>{}),
            (async()=>{
                const rows=await rpc("home_threads");
                const unread=rows.reduce((n,r)=>n+Number(r.unread||0),0);
                if(unread)document.querySelector("#chats h2").append(" ("+unread+" unread)");
                if (!rows.length) {inbox.append(node("p","No conversations yet. Visit a member’s profile to start one."));return;}
                for(const row of rows){
                    const thread=link((row.username?"@"+row.username:"Member")+(Number(row.unread)?" · "+row.unread+" unread":""),"inbox.html?peer="+row.peer);
                    thread.append(timestamp(row.latest));inbox.append(thread);
                }
            })().catch(()=>inbox.append(node("p","Inbox preview unavailable."))),
            (async()=>{
                const rows=await rpc("home_posts");
                for(const post of rows.slice(0, 2)){
                    const entry=node("article",null,"home-entry"),dest="posts.html?post="+post.id;
                    entry.append(link(post.username?"@"+post.username:"Member profile",MC.profile(post.author)),timestamp(post.created_at),
                        node("p",post.excerpt||"Post with an attachment"),link("View post and comments",dest));posts.append(entry);
                }
                if(!rows.length)posts.append(node("p","No community posts yet."));
            })().catch(()=>posts.append(node("p","Posts preview unavailable."))),
            (async()=>{
                const {data}=await supabaseClient.from("profiles").select("username,id").eq("user_id",user.id).order("username",{nullsFirst:false}).order("id").limit(1).maybeSingle();
                if(data?.username)document.querySelector("#accountButton").textContent="@"+data.username;
            })()
        ]);
    }catch{if(!inbox.childNodes.length)inbox.textContent="Open the inbox to view your conversations.";}
})();
