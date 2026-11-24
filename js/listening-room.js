(async()=>{
    const {node,link,button,feedback,rpc,viewer,recording,reactBar,discussion}=MC;
    const root=document.querySelector("[data-library]");
    if(!root)return;
    const page=root.dataset.library, status=feedback();
    const list=node("div",null,"record-list");
    const params=new URLSearchParams(location.search);
    root.append(status);
    let user=null;
    try{user=await viewer();}catch{/* Guest catalogue still works. */}
    try {
        if(page==="track"){
            const id=params.get("id") || MC.bundled;
            const [row]=await rpc("music_page",{wanted:id});
            if(!row)throw Error("Recording unavailable.");
            document.title=row.title+" · Multi-Cata";
            root.append(node("h1",row.title),recording(row,true));
            if(row.credits)root.append(node("p",row.credits,"track-credits"));
            if(row.release_name)root.append(link("Read release liner notes","articles.html?release="+id));
            root.append(link("Read liner notes","articles.html?q="+encodeURIComponent("[track:"+id+"]")),link("Write liner notes","writing.html?track="+id));
            root.append(reactBar(row,user),link("Share in a post","posts.html?track="+encodeURIComponent(id===MC.bundled?"grasscats-pop":id)),discussion("track",id,user,row.user_id));return;
        }
        if(page==="notices"){
            if(!user){root.append(link("Sign in for notifications","account.html"));return;}
            const entries=await rpc("notice_feed");
            if(!entries.length){root.append(node("p","No notifications yet."));return;}
            const labels={follow:"followed you",comment:"left a comment",reply:"replied",mention:"mentioned you"};
            const mark=button("Mark as read",async()=>{
                try{await rpc("mark_notices",{items:entries.filter(r=>!r.seen).map(r=>r.id)});mark.hidden=true;window.dispatchEvent(new Event("noticesread"));list.querySelectorAll(".unread").forEach(e=>e.classList.remove("unread"));}
                catch{status.textContent="Could not mark notifications as read.";}
            });
            mark.hidden=entries.every(r=>r.seen);root.append(mark,list);
            for(const n of entries){
                const dest=n.topic==="article"?"article.html?id="+n.target:n.topic==="track"?MC.track(n.target):n.topic==="post"?"posts.html?post="+n.target:MC.profile(n.target);
                const a=link("@"+(n.username || "Member")+" "+labels[n.kind],dest+(n.entry?"#comment-"+n.entry:""));
                a.className="notice"+(n.seen?"":" unread");list.append(a);
            }
            return;
        }
        const fav=page==="favorites", pageSize=page==="home"?10:8;
        let mode=fav?"favorites":"recent",offset=0,generation=0;
        const bar=node("div",null,"catalogue-tools");
        const more=button("Load more music",()=>load(false));
        const sort=node("select");sort.setAttribute("aria-label","Sort music");
        let shuffle, shuffling=false;
        if(!fav){
            for(const [key,label] of [["recent","Recent Music"],["liked","Most Liked Music"],...(user?[["following","Following"]]:[])])sort.add(new Option(label,key));
            sort.onchange=()=>{mode=sort.value;load(true);};
            bar.append(sort,link("Favorite Music","favorites.html"));
        }else{
            if(!user){root.append(link("Sign in to view Favorite Music","account.html"));return;}
            shuffle=button("Shuffle favorites",async()=>{
                shuffling=true;shuffle.disabled=true;
                try{
                    const all=[];let batch;
                    do {batch=await rpc("music_page",{mode:"favorites",start_at:all.length,take:100});all.push(...batch);}while(batch.length===100);
                    for(let i=all.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[all[i],all[j]]=[all[j],all[i]];}
                    if(all.length)window.multiCataPlayer.playCollection(all.map(MC.media));
                    else status.textContent="Save a recording to shuffle your favorites.";
                }catch{status.textContent="Could not load favorites.";}finally{shuffling=false;shuffle.disabled=!list.childElementCount;}
            });
            shuffle.disabled=true;bar.append(shuffle,link("All Music","music.html"));
        }
        root.append(bar,list,more);
        async function load(reset){
            const turn=++generation;
            if(reset){offset=0;list.replaceChildren();if(shuffle)shuffle.disabled=true;}
            more.disabled=true;more.hidden=true;status.textContent="Loading music…";
            try{
                const rows=await rpc("music_page",{mode,start_at:offset,take:pageSize+1});
                if(turn!==generation)return;
                for(const row of rows.slice(0,pageSize)){
                    const item=recording(row);
                    if(page==="home" && user)item.append(reactBar(row,user));
                    if(fav){
                        const remove=button("Remove favorite",async()=>{
                            remove.disabled=true;
                            try{await rpc("music_reaction",{rec:row.id,choice:"unsave"});await load(true);}
                            catch{status.textContent="Could not remove favorite.";remove.disabled=false;}
                        });item.querySelector(".row-actions").append(remove);
                    }
                    list.append(item);
                }
                offset+=Math.min(rows.length,pageSize);more.hidden=rows.length<=pageSize;
                status.textContent=offset?"":fav?"No favorites yet. Use Favorite on a track.":mode==="following"?"No recordings from people you follow yet.":"No recordings yet.";
            }catch{
                if(turn!==generation)return;
                status.textContent="Music list unavailable.";more.textContent="Try again";more.hidden=false;
            }finally{
                if(turn===generation){
                    more.disabled=false;
                    if(shuffle)shuffle.disabled=shuffling || !list.childElementCount;
                }
            }
        }
        await load(true);
    }catch{status.textContent=page==="track"?"Recording unavailable.":"Could not load this page.";}
})();
