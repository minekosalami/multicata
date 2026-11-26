// The host owns the transport across iframe navigation. Consumers share one connection and clock.
import {radioURL} from "./radio-media.js";

export async function station(base, takePlayer) {
    if (typeof supabaseClient === "undefined") {
        for (const src of ["https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2", new URL("backend.js",base).href]) {
            await new Promise((resolve,reject) => {
                const s=document.createElement("script"); s.onload=resolve; s.onerror=()=>reject(Error("Radio connection unavailable."));
                s.src=src; document.head.append(s);
            });
        }
    }
    const client=supabaseClient, watchers=new Set(), session=crypto.randomUUID();
    const Context=window.AudioContext || window.webkitAudioContext;
    let state, channel, count=null, tuned=false, transport, context, bass, treble, gain;
    let origin=0, playingId=null, timer, notification, request, tracked=false, subscribed=false, message="";
    const defaults={volume:.75,bass:0,treble:0};
    const prefs={...defaults};
    try { const saved=JSON.parse(localStorage.getItem("mc-radio-eq")); for(const k of Object.keys(prefs))
        if(Number.isFinite(saved?.[k])) prefs[k]=Math.max(k==="volume"?0:-12, Math.min(k==="volume"?1:12,saved[k])); } catch {}
    const bar=document.createElement("aside"); bar.className="radio-mini"; bar.hidden=true;
    const link=document.createElement("a"); link.href=new URL("../html/radio.html",base).href;
    const identity=document.createElement("strong"); identity.textContent="● mCata Radio · LIVE";
    const title=document.createElement("span"); link.append(identity,title);
    const volume=document.createElement("input"); volume.type="range"; volume.min=0; volume.max=1; volume.step=.01;
    volume.setAttribute("aria-label","Compact player volume"); volume.oninput=()=>adjust({volume:Number(volume.value)});
    const off=document.createElement("button");off.textContent="⏻";off.setAttribute("aria-label","Turn radio off");off.onclick=()=>power(false);
    bar.append(link,volume,off);document.body.append(bar);
    const css=document.createElement("link");css.rel="stylesheet";css.href=new URL("../css/radio.css",base).href;
    if(!document.querySelector('link[href$="/radio.css"]'))document.head.append(css);
    const now=()=>origin+performance.now();
    const elapsed=()=>state?.current?Math.max(0,(now()-Date.parse(state.current.started))/1000):0;
    function emit(){
        bar.hidden=!tuned; volume.value=prefs.volume;
        const item=state?.current?.item;
        title.textContent=message || (item?item.title+" · "+item.artist:"Off air");
        watchers.forEach(fn=>fn());
    }
    function adjust(settings){
        for(const [key,value] of Object.entries(settings)){
            if(!Object.hasOwn(defaults,key)||!Number.isFinite(value))continue;
            prefs[key]=Math.max(key==="volume"?0:-12,Math.min(key==="volume"?1:12,value));
            if(context) ({volume:gain.gain,bass:bass.gain,treble:treble.gain})[key].setTargetAtTime(prefs[key],context.currentTime,.025);
            else if(transport && key==="volume")transport.volume=prefs.volume;
        }
        try { localStorage.setItem("mc-radio-eq",JSON.stringify(prefs)); } catch {}
        emit();
    }
    function presence(active){
        if(!subscribed||tracked===active)return;
        tracked=active;
        (active?channel.track({listening:true}):channel.untrack()).catch(()=>{tracked=false;});
    }
    function correct(){
        if(!tuned||!state?.current||transport.readyState<1)return;
        const pos=elapsed();
        if(Math.abs(transport.currentTime-pos)>1.25 && pos<state.current.item.seconds) transport.currentTime=pos;
    }
    function sync(){
        if(!tuned)return;
        const current=state?.current;
        if(!current){transport.pause();playingId=null;presence(false);return;}
        const changed=current.id!==playingId;
        if(changed){
            playingId=current.id;presence(false);
            const url=radioURL(client,current.item);
            if(transport.src!==url){
                transport.src=url;
                // Give the browser the live position before it starts buffering a long recording.
                transport.currentTime=Math.min(elapsed(),current.item.seconds);
            }else correct();
        } else correct();
        if(transport.paused && !transport.error && (changed||!transport.ended))transport.play().catch(error=>{
            if(tuned && current.id===playingId && error.name!=="AbortError"){message="Playback interrupted. Tune in again.";presence(false);emit();}
        });
    }
    async function refresh(){
        if(request)return request;
        const sent=performance.now();
        request=(async()=>{
            const {data,error}=await client.rpc("radio_state");
            if(error)throw error;
            state=data;origin=Date.parse(data.server_time)-(sent+performance.now())/2;
            message=data.recovering?"Station is catching up.":"";sync();
        })().catch(()=>{message="Station connection unavailable.";}).finally(()=>{
            request=null;clearTimeout(timer);emit();
            if(!watchers.size&&!tuned || document.hidden&&!tuned)return;
            const boundaries=[Date.parse(state?.current?.ends),...(state?.scheduled||[]).filter(x=>x.timing==="exact").map(x=>Date.parse(x.due))].filter(t=>t>now());
            // With Realtime connected, wake for the broadcast boundary; changes arrive by push.
            const heartbeat=message?6000:subscribed?300000:60000;
            timer=setTimeout(refresh,Math.max(200,Math.min(heartbeat,...boundaries.map(t=>t-now()+80))));
        });
        return request;
    }
    function wake(){if(document.hidden&&!tuned)return;clearTimeout(notification);notification=setTimeout(refresh,120);}
    function connect(){
        if(!channel && client.channel){
            const connection=client.channel("mc-radio-live",{config:{presence:{key:session}}});
            channel=connection;
            channel.on("postgres_changes",{event:"UPDATE",schema:"public",table:"radio_updates"},wake)
            .on("presence",{event:"sync"},()=>{
                if(channel!==connection)return;
                count=Object.values(connection.presenceState()||{}).filter(group=>group.some(p=>p.listening)).length;emit();
            }).subscribe(status=>{
                if(channel!==connection)return;
                subscribed=status==="SUBSCRIBED";tracked=false;
                if(subscribed){presence(Boolean(tuned && transport && !transport.paused && transport.readyState>=3));wake();}
                else{count=null;emit();}
            });
        }
        return refresh();
    }
    function release(){
        if(watchers.size||tuned)return;
        clearTimeout(timer);clearTimeout(notification);
        if(channel){const old=channel;channel=null;subscribed=false;tracked=false;client.removeChannel(old);}
    }
    function observe(fn){
        watchers.add(fn);fn();connect();
        return ()=>{watchers.delete(fn);release();};
    }
    async function power(on){
        if(on===tuned)return;
        if(!on){tuned=false;playingId=null;presence(false);transport?.pause();transport?.removeAttribute("src");transport?.load();
            context?.suspend().catch(()=>{});message="";emit();release();return;}
        if(!transport){
            transport=new Audio();transport.crossOrigin="anonymous";transport.preload="none";
            if(Context){
                context=new Context();
                const source=context.createMediaElementSource(transport);
                bass=context.createBiquadFilter();bass.type="lowshelf";bass.frequency.value=200;
                treble=context.createBiquadFilter();treble.type="highshelf";treble.frequency.value=3200;
                gain=context.createGain();source.connect(bass).connect(treble).connect(gain).connect(context.destination);
                gain.gain.value=prefs.volume;bass.gain.value=prefs.bass;treble.gain.value=prefs.treble;
            }else transport.volume=prefs.volume;
            transport.onloadedmetadata=correct;transport.onplaying=()=>{correct();presence(true);message="";emit();};
            transport.onwaiting=()=>presence(false);transport.onended=()=>{presence(false);refresh();};
            transport.onerror=()=>{presence(false);message="Recording unavailable.";emit();};
        }
        takePlayer();tuned=true;emit();
        // Request native playback inside the power-button gesture, including on mobile Safari.
        const resumed=context?.resume();sync();
        await resumed;if(tuned)await connect();
    }
    document.addEventListener("visibilitychange",()=>{if(!document.hidden&&(watchers.size||tuned))refresh();});
    window.addEventListener("online",()=>{if(watchers.size||tuned){if(transport?.error){playingId=null;transport.load();}refresh();}});
    window.addEventListener("pageshow",()=>{if(watchers.size||tuned)refresh();});
    return {observe,refresh,power,adjust,resetKnobs:()=>adjust(defaults),prefs,elapsed,now,bar,hasEQ:Boolean(Context),get state(){return state;},get count(){return count;},
        get tuned(){return tuned;},get message(){return message;}};
}
