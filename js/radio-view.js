import {artworkURL} from "./radio-media.js";
const root=document.querySelector("[data-radio]");
const find=name=>root.querySelector("[data-"+name+"]");
const hasDetails=Boolean(find("now"));
const presets=[
    {name:"Bass boost",bass:6,treble:0},
    {name:"Bright",bass:0,treble:5},
    {name:"Warm",bass:3,treble:-3}
];
const face=document.createElement("template");
face.innerHTML=`
    <div class="radio-screen">
        <div class="radio-line"><b data-air>Connecting</b><span data-count></span></div>
        <strong data-title></strong><span data-artist></span>
        <progress data-progress max="1" value="0" aria-label="Broadcast progress"></progress>
        <div class="radio-line"><span data-elapsed>–</span><span data-total>–</span></div>
    </div>
    <div class="knobs">
        <label><button class="radio-knob" data-power type="button" aria-label="Radio power" aria-pressed="false"></button>Power</label>
        <label><span class="radio-knob"><input aria-label="Radio volume" type="range" data-setting="volume" min="0" max="100" value="75"></span><span>Volume <small data-value></small></span></label>
        <label><span class="radio-knob"><input aria-label="Radio bass" type="range" data-setting="bass" min="-12" max="12" value="0"></span><span>Bass <small data-value></small></span></label>
        <label><span class="radio-knob"><input aria-label="Radio treble" type="range" data-setting="treble" min="-12" max="12" value="0"></span><span>Treble <small data-value></small></span></label>
    </div>
    <div class="radio-presets" role="group" aria-label="Radio sound presets">
        ${presets.map(({name})=>`<button type="button" data-preset="${name}" aria-pressed="false">${name}</button>`).join("")}
        <button type="button" data-reset title="Restore 75% volume and flat bass and treble">Reset</button>
    </div>`;
root.querySelector("[data-radio-face]").replaceWith(face.content);
const time=n=>Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0");
let radio, lastState, user, release;
const tell=text=>{find("feedback").textContent=text;};
function list(name,values,empty){
    find(name).replaceChildren(...(values.length?values:[empty]).map(s=>MC.node("li",s)));
}
function display(){
    const state=radio.state, item=state?.current?.item;
    find("air").textContent=item?"ON AIR":state?"OFF AIR":radio.message?"Unavailable":"Connecting";
    find("air").classList.toggle("on",Boolean(item));
    find("title").textContent=item?.title||"";
    find("artist").textContent=item?.artist||"";
    find("count").textContent=radio.count==null?"":radio.count+" listener"+(radio.count===1?"":"s");
    tick();
    find("power").setAttribute("aria-pressed",radio.tuned);
    for(const input of root.querySelectorAll("[data-setting]")){
        const k=input.dataset.setting;input.value=radio.prefs[k]*(k==="volume"?100:1);
        input.disabled=k!=="volume"&&!radio.hasEQ;
        if(input.disabled)input.parentElement.title="Equalization is unavailable in this browser.";
        input.parentElement.style.setProperty("--angle",(-135+270*(input.value-input.min)/(input.max-input.min))+"deg");
        input.setAttribute("aria-valuetext",input.value+(k==="volume"?" percent":" dB"));
        input.closest("label").querySelector("[data-value]").textContent=k==="volume"?input.value+"%":(Number(input.value)>0?"+":"")+input.value+" dB";
    }
    for(const preset of presets){
        const button=root.querySelector(`[data-preset="${preset.name}"]`);
        button.disabled=!radio.hasEQ;
        button.setAttribute("aria-pressed",radio.hasEQ && radio.prefs.bass===preset.bass && radio.prefs.treble===preset.treble);
    }
    if(radio.message)tell(radio.message);
    if(!hasDetails||state===lastState||!state)return;
    lastState=state;
    const now=find("now");now.replaceChildren();
    if(item){
        const artwork=artworkURL(supabaseClient,item);
        if(artwork){const img=new Image();img.alt="Release artwork";img.src=artwork;now.append(img);}
        now.append(MC.node("strong",item.title),MC.node("p",item.artist));
        if(item.profile||item.provider==="bundled")now.append(MC.link("View artist profile",item.profile?MC.profile(item.profile):"lliosette.html"));
        if(item.music && user){
            const heart=MC.button("Favorite",async()=>{heart.disabled=true;try{
                const next=heart.getAttribute("aria-pressed")!=="true";
                await MC.rpc("music_reaction",{rec:item.music,choice:next?"save":"unsave"});
                heart.setAttribute("aria-pressed",next);heart.textContent=next?"♥ Saved":"♡ Favorite";
            }catch{tell("Could not save favorite.");}finally{heart.disabled=false;}});
            now.append(heart);heart.disabled=true;
            MC.rpc("music_page",{wanted:item.music}).then(rows=>{heart.setAttribute("aria-pressed",Boolean(rows[0]?.saved));heart.textContent=rows[0]?.saved?"♥ Saved":"♡ Favorite";heart.disabled=false;}).catch(()=>{heart.textContent="Favorites unavailable";});
        }
    }else now.textContent="No broadcast is playing.";
    list("history",state.history.map(h=>h.item.title+" · "+h.item.artist),"No broadcasts yet.");
    list("scheduled",state.scheduled.map(q=>q.title+" · "+new Date(q.due).toLocaleString()+(q.timing==="exact"?" · Exact time":" · After song ends")),"No scheduled broadcasts.");
    const votes=find("votes");votes.replaceChildren();
    if(!state.round||!state.votes.length){votes.textContent=state.manual?"Voting is paused in manual DJ mode.":"Voting is closed.";return;}
    const total=state.votes.reduce((sum,v)=>sum+v.count,0);
    for(const v of state.votes){
        const row=MC.node("div"),bar=document.createElement("progress");bar.max=total||1;bar.value=v.count;bar.setAttribute("aria-label",v.title+" vote share");
        const vote=MC.button(v.selected?"Selected":"Vote",async()=>{try{await MC.rpc("radio_vote",{ballot:state.round,choice:v.id});await radio.refresh();}catch{tell("This vote could not be saved.");}});
        vote.disabled=!user;vote.setAttribute("aria-pressed",v.selected);
        row.append(MC.node("span",v.title+" · "+v.artist+" · "+v.count+" votes "),vote,bar);votes.append(row);
    }
    votes.append(MC.node("p",total+" total votes"));
    if(!user)votes.append(MC.link("Sign in to vote","account.html"));
}
function tick(){
    const h=radio?.state?.current, duration=h?.item.seconds||0, pos=Math.min(duration,radio?.elapsed()||0);
    find("progress").max=duration||1;find("progress").value=pos;find("elapsed").textContent=time(pos);find("total").textContent=time(duration);
    if(!hasDetails)return;
    const exact=radio?.state?.scheduled.find(x=>x.timing==="exact" && Date.parse(x.due)>radio.now());
    const end=Math.min(Date.parse(h?.ends),exact?Date.parse(exact.due):Infinity);
    find("vote-time").textContent=radio?.state?.round?"Voting closes in "+time(Math.max(0,(end-radio.now())/1000)):"";
}
function bindKnob(input){
    const key=input.dataset.setting;
    const change=()=>radio.adjust({[key]:input.valueAsNumber/(key==="volume"?100:1)});
    input.oninput=change;
    const knob=input.parentElement;
    knob.title="Drag up or right to increase. Use the arrow keys for small changes.";
    let drag;
    knob.onpointerdown=event=>{
        if(!event.isPrimary || event.button!==0 || input.disabled)return;
        event.preventDefault();
        input.focus({preventScroll:true});
        knob.setPointerCapture(event.pointerId);
        drag={id:event.pointerId,x:event.clientX,y:event.clientY,value:input.valueAsNumber};
    };
    knob.onpointermove=event=>{
        if(drag?.id!==event.pointerId)return;
        const dx=event.clientX-drag.x, dy=drag.y-event.clientY;
        if(!drag.axis){
            if(Math.max(Math.abs(dx),Math.abs(dy))<3)return;
            drag.axis=Math.abs(dx)>Math.abs(dy)?"x":"y";
        }
        const distance=drag.axis==="x"?dx:dy;
        const value=Math.round(drag.value+distance*(input.max-input.min)/144);
        const next=Math.max(Number(input.min),Math.min(Number(input.max),value));
        if(input.valueAsNumber!==next){input.valueAsNumber=next;change();}
    };
    knob.onlostpointercapture=()=>{drag=null;};
}
try{
    radio=await window.multiCataPlayer.getRadio();
    if(hasDetails){
        user=await MC.viewer();const permission=await supabaseClient.rpc("radio_can_edit");find("control").hidden=permission.data!==true;
    }
    find("power").onclick=()=>radio.power(!radio.tuned).catch(()=>tell("Playback could not start."));
    for(const input of root.querySelectorAll("[data-setting]"))bindKnob(input);
    for(const {name,bass,treble} of presets){
        root.querySelector(`[data-preset="${name}"]`).onclick=()=>radio.adjust({bass,treble});
    }
    find("reset").onclick=()=>radio.resetKnobs();
    let timer;
    function stopView(){clearInterval(timer);release?.();release=null;}
    let inView=true;
    function syncView(){
        if(document.hidden||!inView||document.querySelector(".player-page")){stopView();return;}
        if(release)return;
        release=radio.observe(display);timer=setInterval(tick,500);
    }
    if(!hasDetails && "IntersectionObserver" in window){
        inView=false;
        const observer=new IntersectionObserver(([entry])=>{inView=entry.isIntersecting;syncView();},{rootMargin:"160px"});
        observer.observe(root);
    }
    syncView();
    document.addEventListener("visibilitychange",syncView);
    window.addEventListener("playerhost",syncView);
    window.addEventListener("pageshow",syncView);
    window.addEventListener("pagehide",stopView);
}catch{find("air").textContent="Unavailable";tell("Radio connection unavailable.");}
