import {radioURL,uploadAnnouncement} from "./radio-media.js";
const el=id=>document.getElementById(id), status=text=>{el("panel-status").textContent=text;};
const format=n=>Math.floor(n/60)+":"+String(Math.floor(n%60)).padStart(2,"0");
let radio, owner, assets=[], catalog=[], queue=[], mediaFile, previewURL, recorder, microphone, meterContext, meterTimer, recordingStart;
let sourceVersion=0;
async function manage(action,args={}){
    let result;
    try{result=await MC.rpc("radio_manage",{action,args});}
    catch(error){
        if(error.code==="42501"){
            el("controls").hidden=true;
            if(recorder?.state==="recording")recorder.stop();
            stopMic();
        }
        throw error;
    }
    assets=result.assets;queue=result.queue;paint();return result;
}
function guarded(task){return async event=>{
    const trigger=event?.currentTarget;
    if(trigger?.tagName==="BUTTON")trigger.disabled=true;
    try{await task(event);}catch(error){status(error.message||"Radio action failed.");}
    finally{if(trigger?.isConnected && trigger.tagName==="BUTTON" && !["record","save","stop"].includes(trigger.id))trigger.disabled=false;}
};}
function action(text,fn){return MC.button(text,guarded(fn));}
function paint(){
    const music=assets.filter(a=>a.music);
    el("summary").textContent=music.length+" approved "+(music.length===1?"song":"songs")+" · "+format(music.reduce((n,a)=>n+a.seconds,0))+" total";
    const term=el("search").value.trim().toLowerCase();
    el("catalog").replaceChildren(...catalog.filter(r=>(r.title+" "+r.artist).toLowerCase().includes(term)).map(r=>{
        const approved=music.some(a=>a.id===r.id),li=MC.node("li",r.title+" · "+r.artist+" ");
        li.append(action(approved?"Remove approval":"Approve",async()=>{
            if(approved)await manage("revoke",{id:r.id});
            else {
                const url=radioURL(supabaseClient,{provider:r.id===MC.bundled?"bundled":"catalog",path:r.audio_path});
                await manage("approve",{id:r.id,seconds:await duration(url)});
            }
            status(approved?"Approval removed.":"Song approved.");
        }));return li;
    }));
    const selected=el("asset").value;
    el("asset").replaceChildren(...assets.map(a=>new Option(a.title+" · "+a.artist+" · "+format(a.seconds),a.id)));
    if(assets.some(a=>a.id===selected))el("asset").value=selected;
    const regular=queue.filter(q=>q.due===null);
    el("queue").replaceChildren(...queue.map(q=>{
        const li=MC.node("li",q.title+" ");
        const index=regular.indexOf(q);
        if(index>=0){
            li.draggable=true;li.prepend("⠿ ");
            li.ondragstart=e=>e.dataTransfer.setData("text/plain",String(q.id));
            li.ondragover=e=>e.preventDefault();
            li.ondrop=guarded(async e=>{e.preventDefault();const id=Number(e.dataTransfer.getData("text/plain"));if(regular.some(x=>x.id===id)&&id!==q.id)await manage("move",{queue:id,before:q.id});});
            if(index>0)li.append(action("Move up",()=>manage("move",{queue:q.id,before:regular[index-1].id})));
            if(index+1<regular.length)li.append(action("Move down",()=>manage("move",{queue:regular[index+1].id,before:q.id})));
        }else li.append(document.createTextNode(new Date(q.due).toLocaleString()+(q.timing==="exact"?" · Exact time ":" · After song ends ")));
        li.append(action("Remove",()=>manage("remove",{queue:q.id})));return li;
    }));
}
function duration(url){
    return new Promise((resolve,reject)=>{
        const media=new Audio();
        const finish=value=>{clearTimeout(timer);media.onloadedmetadata=media.onerror=media.ontimeupdate=null;
            media.removeAttribute("src");media.load();Number.isFinite(value)&&value>=1?resolve(value):reject(Error("Choose a playable recording at least one second long."));};
        const timer=setTimeout(()=>finish(null),15000);
        media.onloadedmetadata=()=>{if(Number.isFinite(media.duration))finish(media.duration);
            else{media.ontimeupdate=()=>{if(Number.isFinite(media.duration))finish(media.duration);};media.currentTime=1e10;}};
        media.onerror=()=>finish(null);media.preload="metadata";media.src=url;
    });
}
async function preview(file,measured){
    const version=++sourceVersion;
    mediaFile=null;el("save").disabled=true;el("preview").hidden=true;el("file-info").textContent="";
    if(previewURL)URL.revokeObjectURL(previewURL);
    if(!file)return;
    if(file.size>52428800){
        previewURL=URL.createObjectURL(file);
        el("preview").src=previewURL;el("preview").hidden=false;
        const download=MC.link("Save recording to this device",previewURL);download.download=file.name;
        el("file-info").append(download);status("This recording exceeds the 50 MB upload limit. Export a smaller file for broadcast.");
        return;
    }
    let body,ext,mime;
    if(file.name.toLowerCase().endsWith(".webm")){
        const head=new Uint8Array(await file.slice(0,4).arrayBuffer());
        if(![0x1a,0x45,0xdf,0xa3].every((b,i)=>head[i]===b))throw Error("Choose a WebM audio recording.");
        ext="webm";mime="audio/webm";body=file.slice(0,file.size,mime);
        await validateAudioContainer(body);
    }else{const r=await recordingUpload(file);ext=r.extension;mime=r.mime;body=r.body;}
    if(version!==sourceVersion)return;
    previewURL=URL.createObjectURL(body);
    const seconds=await duration(previewURL).catch(error=>{if(measured>=1)return measured;throw error;});
    if(version!==sourceVersion)return;
    mediaFile={body,ext,mime,seconds,path:null};
    el("preview").src=previewURL;el("preview").hidden=false;
    el("file-info").textContent=file.name+" · "+format(seconds);
    el("save").disabled=seconds<1;
}
function stopMic(){
    clearInterval(meterTimer);microphone?.getTracks().forEach(t=>t.stop());meterContext?.close().catch(()=>{});
    microphone=meterContext=null;el("level").value=0;el("record-time").textContent="Microphone off";
}
async function record(){
    el("record").disabled=true;
    try{
        if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder)throw Error("Microphone recording is unavailable in this browser. Use Upload audio.");
        microphone=await navigator.mediaDevices.getUserMedia({audio:true});
        const mime=["audio/webm;codecs=opus","audio/mp4","audio/ogg;codecs=opus"].find(m=>MediaRecorder.isTypeSupported(m));
        if(!mime)throw Error("Use Upload audio or another browser to record.");
        const chunks=[];let size=0;
        recorder=new MediaRecorder(microphone,{mimeType:mime,audioBitsPerSecond:64000});
        recorder.ondataavailable=e=>{if(e.data.size){chunks.push(e.data);size+=e.data.size;
            if(size>=52428800 && recorder.state==="recording"){status("Recording reached the storage limit. The preview includes everything captured.");recorder.stop();}}};
        recorder.onstop=async()=>{
            const measured=(performance.now()-recordingStart)/1000;stopMic();el("stop").disabled=true;
            try{const ext=mime.includes("webm")?"webm":mime.includes("mp4")?"m4a":"ogg";
                await preview(new File(chunks,"Announcement."+ext,{type:mime.split(";")[0]}),measured);
            }catch(e){status(e.message);}finally{el("record").disabled=false;el("record").textContent="Re-record";}
        };
        meterContext=new AudioContext();const analyser=meterContext.createAnalyser();analyser.fftSize=256;
        meterContext.createMediaStreamSource(microphone).connect(analyser);const data=new Uint8Array(analyser.fftSize);
        recordingStart=performance.now();recorder.start(1000);el("stop").disabled=false;
        meterTimer=setInterval(()=>{analyser.getByteTimeDomainData(data);el("level").value=Math.max(...data.map(v=>Math.abs(v-128)))/128;
            el("record-time").textContent="● Recording "+format((performance.now()-recordingStart)/1000);},150);
    }catch(e){stopMic();el("record").disabled=false;throw e;}
}
async function setup(){
    if(!(await MC.rpc("radio_can_edit"))){status("Only @lliosette can edit the station.");return;}
    owner=await MC.viewer();radio=await window.multiCataPlayer.getRadio();
    el("controls").hidden=false;status("");
    let lastState;
    const update=()=>{const s=radio.state;el("current").textContent=s?.current?s.current.item.title+" · "+format(radio.elapsed())+" / "+format(s.current.item.seconds):"Off air";
        if(s && s!==lastState){el("mode").value=s.manual?"manual":"auto";lastState=s;manage("list").catch(e=>status(e.message));}};
    const release=radio.observe(update);const clock=setInterval(update,1000);
    window.addEventListener("pagehide",()=>{release();clearInterval(clock);if(recorder?.state==="recording")recorder.stop();stopMic();},{once:true});
    for(let offset=0;;){const rows=await MC.rpc("music_page",{mode:"recent",start_at:offset,take:50});
        catalog.push(...rows);if(!rows.length)break;offset+=rows.length;}
    await manage("list");
    el("search").oninput=paint;
    el("mode").onchange=guarded(async()=>{await manage("mode",{manual:el("mode").value==="manual"});await radio.refresh();});
    el("skip").onclick=guarded(async()=>{await manage("skip",{current:radio.state?.current?.id});await radio.refresh();});
    el("record").onclick=guarded(record);el("stop").onclick=()=>{if(recorder?.state==="recording")recorder.stop();};
    el("upload").onchange=guarded(()=>preview(el("upload").files[0]));
    el("save").onclick=guarded(async()=>{
        const file=mediaFile,title=el("announcement-title").value.trim();
        try{
            if(!title||!file)throw Error("Enter a title and choose a recording.");
            await uploadAnnouncement(supabaseClient,file,owner.id);
            await manage("announce",{title,path:file.path,seconds:file.seconds});
            el("asset").value=assets.find(a=>a.path===file.path).id;
            status("Announcement saved. Choose its broadcast timing.");mediaFile=null;
        }finally{el("save").disabled=!mediaFile;}
    });
    const form=el("schedule");
    form.onchange=()=>{const later=form.elements.period.value==="schedule";
        el("later").hidden=!later;el("instant").hidden=later;el("due").required=later;form.querySelector("button").textContent=later?"Schedule broadcast":"Queue broadcast";};
    form.onsubmit=guarded(async e=>{e.preventDefault();const later=form.elements.period.value==="schedule", submit=form.querySelector("button");
        if(submit.disabled)return;submit.disabled=true;
        try{await manage("enqueue",{id:el("asset").value,timing:later?form.elements.scheduleTiming.value:form.elements.instantTiming.value,
            due:later?new Date(el("due").value).toISOString():null});status("Broadcast saved.");await radio.refresh();}
        finally{submit.disabled=false;}});
    el("append").onclick=guarded(()=>manage("enqueue",{id:el("asset").value,timing:"queue"}));
}
setup().catch(e=>status(e.message||"Could not load the radio control panel."));
