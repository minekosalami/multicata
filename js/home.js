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
                const rows=await rpc("home_threads");
                if (!rows.length) {inbox.append(node("p","No conversations yet. Visit a member’s profile to start one."));return;}
                for(const row of rows){
                    const thread=link((row.username?"@"+row.username:"Member")+(Number(row.unread)?" · "+row.unread+" unread":""),"inbox.html?peer="+row.peer);
                    thread.append(timestamp(row.latest));inbox.append(thread);
                }
            })().catch(()=>inbox.append(node("p","Inbox preview unavailable."))),
            (async()=>{
                const rows=await rpc("home_posts");
                for(const post of rows){
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
