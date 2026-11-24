const MC = (() => {
    const bundled = "00000000-0000-4000-8000-000000000041";
    function node(tag, text, cls) {
        const element = document.createElement(tag);
        if (text != null) element.textContent = text;
        if (cls) element.className = cls;
        return element;
    }
    function link(title, href) {
        const a = node("a",title); a.href = href; return a;
    }
    function button(title, action) {
        const b = node("button",title); b.type = "button"; b.onclick = action; return b;
    }
    function feedback() {
        const el = node("p","","social-status"); el.setAttribute("role","status"); return el;
    }
    async function rpc(name,args={}) {
        const {data,error} = await supabaseClient.rpc(name,args);
        if (error) throw error;
        return data;
    }
    const viewer = async () => (await supabaseClient.auth.getUser()).data.user;
    const profile = id => "profile.html?id=" + encodeURIComponent(id);
    const track = id => "track.html?id=" + encodeURIComponent(id);
    function mentions(container, text) {
        let last=0;
        for (const match of String(text || "").matchAll(/(^|[^a-zA-Z0-9_@])@([a-zA-Z0-9_]{1,20})(?![a-zA-Z0-9_])/g)) {
            container.append(text.slice(last,match.index)+match[1],link("@"+match[2],"profile.html?user="+encodeURIComponent(match[2])));
            last=match.index+match[0].length;
        }
        container.append((text || "").slice(last));
    }
    function media(row) {
        const src = row.id === bundled ? new URL("../audio/GrassCatsPopM.mp3", location.href).href :
            supabaseClient.storage.from("creator-music").getPublicUrl(row.audio_path).data.publicUrl;
        return {src,title:row.title+" · "+row.artist,id:row.id};
    }
    function recording(row, detailed=false) {
        const el=node("article",null,"record-row");
        const text=node("div",null,"record-text");
        const title=link(row.title,track(row.id)); title.className="record-name";
        const by=link(row.artist,row.user_id ? profile(row.user_id) : "lliosette.html");
        const credit=node("div",null,"record-credit"); credit.append(by);
        if(row.release_name) credit.append(" · "+row.release_name);
        if(!detailed)text.append(title);
        text.append(credit);
        const controls=node("div",null,"row-actions");
        const play=button("Play",()=>window.multiCataPlayer.openPlayer(true,media(row)));
        play.setAttribute("aria-label","Play "+row.title);
        let clearFeedback;
        const enqueue=button("Queue",()=>{
            window.multiCataPlayer.enqueue(media(row));
            status.textContent="Added to queue.";
            clearTimeout(clearFeedback);
            clearFeedback=setTimeout(()=>{status.textContent="";},3500);
        });
        enqueue.setAttribute("aria-label","Queue "+row.title);
        controls.append(play,enqueue);
        const status=feedback();
        if ((row.art || row.id===bundled) && !(row.id===bundled && document.querySelector(".portal"))) {
            const image=node("img"); image.alt=""; image.loading="lazy";
            image.onerror=()=>image.remove();
            image.src=row.art ? supabaseClient.storage.from("community-images").getPublicUrl(row.art).data.publicUrl : "../landingimages/mc0.4.1.png"; el.append(image);
        }
        el.append(text,controls);
        if (!detailed && Number(row.likes)>0 && !document.querySelector(".orbit-home")) text.append(node("small",row.likes+" "+(Number(row.likes)===1?"like":"likes")));
        el.append(status);
        return el;
    }
    function reactBar(row,user,onChange) {
        const area=node("div",null,"reaction-bar");
        const state=feedback();
        if(!user) {area.append(node("span",row.likes+" likes"),link("Sign in to vote or save","account.html"));return area;}
        const like=button("",()=>change(row.my_vote===1?"unvote":"like"));
        const dislike=button("Dislike",()=>change(row.my_vote===-1?"unvote":"dislike"));
        const heart=button("",()=>change(row.saved?"unsave":"save"));
        function paint() {
            like.textContent="Like · "+row.likes;
            heart.textContent=row.saved?"♥ Saved":"♡ Favorite";
            for(const [b,active] of [[like,row.my_vote===1],[dislike,row.my_vote===-1],[heart,row.saved]]) b.setAttribute("aria-pressed",String(active));
        }
        async function change(choice) {
            like.disabled=dislike.disabled=heart.disabled=true;
            try {
                await rpc("music_reaction",{rec:row.id,choice});
                const [fresh]=await rpc("music_page",{wanted:row.id});
                Object.assign(row,fresh);paint();
                state.textContent=choice==="save"?"Saved to Favorite Music.":choice==="unsave"?"Removed from Favorite Music.":"Vote updated.";
                onChange?.();
            } catch {state.textContent="Could not update this recording. Try again.";}
            finally {like.disabled=dislike.disabled=heart.disabled=false;}
        }
        paint();area.append(like,dislike,heart,state);return area;
    }
    async function voting(kind, ids, user) {
        const read = async targets => {
            const [counts, mine] = await Promise.all([
                rpc("writing_vote_counts",{kind,targets}),
                user ? rpc("my_writing_votes",{kind,targets}) : []
            ]);
            const state=new Map(targets.map(id=>[id,{choice:0}]));
            for(const row of counts)Object.assign(state.get(row.target),row);
            for(const row of mine)state.get(row.target).choice=row.value;
            return state;
        };
        if (!ids.length) return () => document.createDocumentFragment();
        let state;
        try { state = await read(ids); }
        catch {
            // Reactions are optional. Keep the article and its discussion readable.
            return () => document.createDocumentFragment();
        }
        return id => {
            const bar=node("div",null,"reaction-bar"),status=feedback();
            const buttons=[1,-1].map(value=>button("",async()=>{
                buttons.forEach(b=>b.disabled=true);
                try {
                    await rpc("set_writing_vote",{kind,target:id,choice:state.get(id).choice===value?0:value});
                    state.set(id,(await read([id])).get(id));status.textContent="";
                } catch {status.textContent="Vote could not be updated. Try again.";}
                paint();
            }));
            function paint() {
                const row=state.get(id);
                buttons.forEach((b,i)=>{
                    b.textContent=(i?"Dislike":"Like")+" · "+(i?row.dislikes||0:row.likes||0);
                    b.setAttribute("aria-pressed",String(row.choice===(i?-1:1)));b.disabled=!user;
                });
            }
            paint();bar.append(...buttons,status);return bar;
        };
    }
    function report(kind,id) {
        return button("Report",async e=>{
            const b=e.currentTarget;
            const reason=await communityDialog("Report "+kind,"Submit report",{label:"Reason",limit:500});
            if(!reason?.trim())return;
            b.disabled=true;
            const {error}=await supabaseClient.from("writing_reports").insert({[kind==="article"?"article":"entry"]:id,reason:reason.trim()});
            b.textContent=!error || error.code==="23505"?"Reported":"Try reporting again";b.disabled=b.textContent==="Reported";
        });
    }
    function copyLink(label,href) {
        return button(label,async e=>{
            const b=e.currentTarget;
            try {await navigator.clipboard.writeText(new URL(href,location.href).href);b.textContent="Copied";}
            catch {const a=link("Open link",href);b.replaceWith(a);}
        });
    }

    function discussion(topic,target,user,owner) {
        const details=node("details",null,"discussion");
        const heading=topic==="guestbook"?"Guestbook":"Comments";
        details.append(node("summary",heading));
        const list=node("div"),status=feedback();
        const form=node("form",null,"comment-form"),label=node("label","Your message");
        const input=node("textarea"); input.required=true; input.maxLength=1500; input.rows=2;
        const send=node("button",topic==="guestbook"?"Sign guestbook":"Comment");
        const cancel=button("Cancel reply",()=>choose(null));
        let parent=null;
        const expanded=new Set();
        const context=node("blockquote");context.hidden=true;form.prepend(context);
        function choose(entry) {
            parent=entry?.id || null; cancel.hidden=!parent;
            label.firstChild.textContent=parent?"Reply to @"+(entry.username || "Member"):"Your message";
            send.textContent=parent?"Send reply":topic==="guestbook"?"Sign guestbook":"Comment";
            context.hidden=!entry;context.textContent=entry?.body || "";
            if(entry) input.focus();
        }
        cancel.hidden=true;label.append(input);form.append(label,send,cancel);
        form.onsubmit=async e=>{
            e.preventDefault(); if(!input.value.trim() || send.disabled) return;
            send.disabled=true;
            try {
                await rpc("leave_comment",{topic,target,message:input.value.trim(),parent});
                if(parent)expanded.add(parent);
                input.value="";choose(null);await load();status.textContent="Posted.";
            } catch(e){status.textContent=e.message?.includes("minute")?"Please wait a minute before posting again.":"Could not post this message.";}
            finally {send.disabled=false;}
        };
        async function load(){
            try {
                const rows=await rpc("thread_entries",{topic,target});
                const votes=await voting("comment",rows.map(r=>r.id),user);
                const replies=new Map();
                for(const row of rows.filter(r=>r.parent_id)) {
                    if(!replies.has(row.parent_id)) replies.set(row.parent_id,[]);
                    replies.get(row.parent_id).push(row);
                }
                const fragment=document.createDocumentFragment();
                function entry(row) {
                    const el=node("article",null,row.parent_id?"comment reply":"comment");el.id="comment-"+row.id;
                    const head=node("header");head.append(link("@"+(row.username || "Member"),profile(row.author))," · ",node("time",new Date(row.created_at).toLocaleString()));
                    const body=node("p");mentions(body,row.body);el.append(head,body);
                    if(user && !row.parent_id) el.append(button("Reply",()=>choose(row)));
                    if(user && (row.author===user.id || (topic==="guestbook" && owner===user.id))) {
                        el.append(button("Remove",async()=>{
                            if(!await communityDialog("Remove this comment and its replies?","Remove")) return;
                            try {await rpc("remove_comment",{entry:row.id});await load();} catch {status.textContent="Could not remove comment.";}
                        }));
                    }
                    el.append(votes(row.id),copyLink("Copy link","#comment-"+row.id));
                    if(user && row.author!==user.id)el.append(report("comment",row.id));
                    if(user?.id===row.author)el.append(button("Edit",async()=>{
                        const text=await communityDialog("Edit message","Save",{label:"Message",limit:1500,value:row.body});
                        if(!text?.trim())return;
                        const {error}=await supabaseClient.from("community_comments").update({body:text.trim()}).eq("id",row.id);
                        if(error)status.textContent="Could not save this edit.";else await load();
                    }));
                    if(row.edited_at)head.append(" (edited)");
                    return el;
                }
                for(const row of rows.filter(r=>!r.parent_id)) {
                    fragment.append(entry(row));
                    const children=replies.get(row.id);
                    if(!children?.length)continue;
                    const thread=node("details");
                    thread.append(node("summary","View replies ("+children.length+")"),...children.map(entry));
                    thread.open=expanded.has(row.id)||children.some(r=>location.hash==="#comment-"+r.id);
                    thread.ontoggle=()=>thread.open?expanded.add(row.id):expanded.delete(row.id);
                    fragment.append(thread);
                }
                if(!rows.length)fragment.append(node("p",topic==="guestbook"?"No guestbook entries yet.":"No comments yet.","quiet"));
                list.replaceChildren(fragment);status.textContent="";
                if(location.hash.startsWith("#comment-"))document.getElementById(location.hash.slice(1))?.scrollIntoView();
            }catch {status.textContent="Discussion unavailable. Close and reopen to retry.";}
        }
        details.append(list,user?form:link(topic==="guestbook"?"Sign in to sign the guestbook":"Sign in to comment","account.html"),status);
        if(user){
            const prefs=()=>supabaseClient.from("muted_discussions");
            const mute=button("Mute discussion",async()=>{
                mute.disabled=true;
                const active=mute.getAttribute("aria-pressed")==="true";
                const {error}=await (active?prefs().delete().eq("member",user.id).eq("topic",topic).eq("target",target):prefs().insert({topic,target}));
                if(error)status.textContent="Could not update notifications.";else paint(!active);
                mute.disabled=false;
            });
            function paint(active){mute.textContent=active?"Unmute discussion":"Mute discussion";mute.setAttribute("aria-pressed",String(active));}
            prefs().select("target").eq("member",user.id).eq("topic",topic).eq("target",target).maybeSingle().then(({data,error})=>{if(!error){paint(Boolean(data));details.append(mute);}});
        }
        details.ontoggle=()=>{if(details.open)load();};
        if(topic==="article" || topic==="guestbook" || topic==="track" || location.hash.startsWith("#comment-"))details.open=true;
        return details;
    }
    async function relationships(area,person,user) {
        const section=node("section",null,"relationships"),status=feedback();
        const controls=node("div",null,"row-actions"),directory=node("div");
        section.append(controls,directory,status);area.append(section);
        async function render(){
            const [followers,following]=await Promise.all(["followers","following"].map(direction=>rpc("community_people",{person,direction})));
            controls.replaceChildren();
            if(user && user.id!==person){
                const followed=followers.some(p=>p.user_id===user.id);
                const follow=button(followed?"Unfollow":"Follow",async()=>{
                    follow.disabled=true;
                    try {await rpc("change_follow",{person,desired:!followed});await render();}catch{status.textContent="Could not change follow status.";follow.disabled=false;}
                });controls.append(follow);
            }
            for(const [name,people] of [["Followers",followers],["Following",following]]) {
                controls.append(button(name+" · "+people.length,()=>{
                    directory.replaceChildren();
                    for(const p of people)directory.append(link("@"+(p.username || "Member"),profile(p.user_id))," ");
                    if(!people.length)directory.textContent="No "+name.toLowerCase()+" yet.";
                }));
            }
        }
        try{await render();}catch{status.textContent="Follow information unavailable.";}
    }
    return {bundled,node,link,button,feedback,rpc,viewer,profile,track,mentions,media,recording,reactBar,discussion,relationships,voting,report,copyLink};
})();
