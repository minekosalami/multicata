(() => {
    const nav = document.querySelector(".site-nav");
    const defaultTitle = "GrassCats Pop · LLiosette (Unmixed & Unmastered)";
    const source = new URL("../audio/GrassCatsPopM.mp3", document.currentScript.src);
    let host;
    try { host = parent !== window && parent.multiCataPlayer; } catch { /* External embed. */ }

    const toggle = document.createElement("button");
    toggle.type = "button";
    toggle.className = "player-toggle";
    toggle.textContent = "Player ▾";
    toggle.setAttribute("aria-expanded", "false");
    nav?.prepend(toggle);

    let frame, panel, audio, caption;
    let started = false;
    let speed = 1;
    function slowDial() {
        const group = document.createElement("div");
        group.className = "slow-control";
        const dial = document.createElement("div");
        dial.className = "slow-dial";
        dial.tabIndex = 0;
        dial.setAttribute("role", "slider");
        dial.setAttribute("aria-label", "Slow playback speed");
        dial.setAttribute("aria-valuemin", "0.50");
        dial.setAttribute("aria-valuemax", "1.00");
        dial.title = "Turn to change speed and pitch. Arrow keys adjust by 0.01. End or a double-click restores 1.00×.";
        const help = document.createElement("small");
        help.id = "slow-help";
        help.textContent = "Turn left to slow down. Turn right to return to 1.00×.";
        dial.setAttribute("aria-describedby", help.id);
        const label = document.createElement("strong");
        label.textContent = "SLOW";
        const value = document.createElement("output");
        value.setAttribute("aria-hidden", "true");
        function setSpeed(next) {
            speed = Math.max(.5, Math.min(1, Math.round(next * 100) / 100));
            audio.preservesPitch = false;
            if ("webkitPreservesPitch" in audio) audio.webkitPreservesPitch = false;
            if (audio.defaultPlaybackRate !== speed) audio.defaultPlaybackRate = speed;
            if (audio.playbackRate !== speed) audio.playbackRate = speed;
            value.textContent = speed.toFixed(2) + "×";
            dial.setAttribute("aria-valuenow", speed.toFixed(2));
            dial.setAttribute("aria-valuetext", value.textContent + " normal speed");
            dial.style.setProperty("--angle", ((speed - .5) * 540 - 135) + "deg");
        }
        function angle(e) {
            const r = dial.getBoundingClientRect();
            return Math.atan2(e.clientX - r.left - r.width/2, r.top + r.height/2 - e.clientY) * 180 / Math.PI;
        }
        let pointer = null, lastAngle, previousSpeed, moved, frame;
        function flush() { cancelAnimationFrame(frame); setSpeed(previousSpeed); }
        dial.onpointerdown = e => {
            if (pointer !== null || e.button !== 0) return;
            pointer = e.pointerId; lastAngle = angle(e); previousSpeed = speed; moved = false;
            dial.setPointerCapture(pointer); dial.focus({preventScroll:true});
        };
        dial.onpointermove = e => {
            if (pointer !== e.pointerId) return;
            const now = angle(e), delta = (now - lastAngle + 540) % 360 - 180;
            if (Math.abs(delta) < 1) return;
            moved = true; lastAngle = now;
            previousSpeed = Math.min(1, Math.max(.5, previousSpeed + delta / 540));
            cancelAnimationFrame(frame); frame = requestAnimationFrame(flush);
        };
        dial.onpointerup = e => {
            if (pointer !== e.pointerId) return;
            if (!moved) previousSpeed = .75 + Math.min(135, Math.max(-135, angle(e))) / 540;
            flush(); pointer = null; remember();
        };
        dial.onlostpointercapture = () => { pointer = null; };
        dial.ondblclick = () => {setSpeed(1);remember();};
        dial.onkeydown = e => {
            const steps = {ArrowLeft:-.01, ArrowDown:-.01, ArrowRight:.01, ArrowUp:.01, PageUp:.05, PageDown:-.05};
            if (!(e.key in steps) && e.key !== "Home" && e.key !== "End") return;
            e.preventDefault(); setSpeed(e.key === "Home" ? .5 : e.key === "End" ? 1 : speed + steps[e.key]); remember();
        };
        setSpeed(speed);
        group.append(label,dial,value,help);
        return group;
    }
    let previous=[], upcoming=[], queueBox, queueLabel, queueItems, queueHint, prevButton, nextButton, playNext;
    const channel=(!host && "BroadcastChannel" in window) ? new BroadcastChannel("multicata-audio") : null;
    if(channel) channel.onmessage=()=>{if(audio && !audio.paused)audio.pause();};
    function validTrack(t) {
        if (!t || typeof t.title!=="string" || typeof t.src!=="string") return false;
        try {
            const url = new URL(t.src,source);
            return url.href===source.href || (url.origin==="https://ncmizvdipzjwiknslohn.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/creator-music/"));
        } catch {return false;}
    }
    function current() {return {src:audio.src,title:caption.textContent};}
    function drawQueue(){
        if(!queueItems)return;
        queueLabel.textContent="Queue · "+upcoming.length;
        queueItems.replaceChildren();
        playNext.hidden=!upcoming.length;
        queueHint.hidden=upcoming.length>0;
        upcoming.forEach((song,i)=>{
            const item=document.createElement("li");
            const name=document.createElement("span");name.textContent=song.title;
            item.append(name);
            if(i>0){
                const earlier=document.createElement("button");earlier.textContent="Move up";
                earlier.setAttribute("aria-label","Move "+song.title+" earlier");
                earlier.onclick=()=>{[upcoming[i-1],upcoming[i]]=[upcoming[i],upcoming[i-1]];drawQueue();remember();};
                item.append(earlier);
            }
            const remove=document.createElement("button");
            remove.textContent="Remove";remove.setAttribute("aria-label","Remove "+song.title+" from queue");
            remove.onclick=()=>{upcoming.splice(i,1);drawQueue();remember();};
            item.append(remove);queueItems.append(item);
        });
        prevButton.disabled=!previous.length && !started;nextButton.disabled=!upcoming.length;
    }
    function startSong(song) {
        const src=new URL(song.src,source).href;
        if(audio.src!==src)audio.src=src;
        else audio.currentTime=0;
        caption.textContent=song.title;
        drawQueue();audio.play().then(remember).catch(()=>show(true));
    }
    function nextSong(){
        if(!upcoming.length)return;
        previous.push(current());startSong(upcoming.shift());
    }
    function enqueue(song){
        setup();upcoming.push(song);drawQueue();remember();
    }
    function playCollection(songs){
        if(!songs.length)return;
        setup();previous=[];upcoming=songs.slice(1);startSong(songs[0]);show(true);
    }
    function show(open) {
        panel.hidden = !open;
        const activeToggle = frame?.contentDocument?.querySelector(".player-toggle") || toggle;
        activeToggle.setAttribute("aria-expanded", String(open));
        if (open) {
            const header = activeToggle.closest("header");
            panel.style.top = Math.max(0, header?.getBoundingClientRect().bottom || 0) + "px";
        }
    }
    function closePanel() {
        if (!panel || panel.hidden) return;
        show(false);
        (frame?.contentDocument?.querySelector(".player-toggle") || toggle).focus();
    }
    function remember() {
        if (!audio) return;
        try {
            sessionStorage.setItem("multicata-listening", JSON.stringify({
                src:audio.src,title:caption.textContent,time:audio.currentTime,speed,previous,upcoming
            }));
        } catch { /* Storage can be disabled by the browser. */ }
    }
    function restore() {
        try {
            const saved = JSON.parse(sessionStorage.getItem("multicata-listening"));
            if (!saved) return;
            const url = new URL(saved.src);
            const uploaded = url.origin === "https://ncmizvdipzjwiknslohn.supabase.co"
                && url.pathname.startsWith("/storage/v1/object/public/creator-music/");
            if (url.href !== source.href && !uploaded) return;
            if (typeof saved.title !== "string" || !Number.isFinite(saved.time)) return;
            previous=Array.isArray(saved.previous)?saved.previous.filter(validTrack):[];
            upcoming=Array.isArray(saved.upcoming)?saved.upcoming.filter(validTrack):[];
            if (Number.isFinite(saved.speed)) speed = Math.max(.5, Math.min(1, saved.speed));
            audio.src = url.href;
            caption.textContent = saved.title;
            audio.currentTime = Math.max(0,saved.time);
        } catch { /* Start with the featured track if the session expired. */ }
    }
    function updateIndicator() {
        const button = frame?.contentDocument?.querySelector(".player-toggle") || toggle;
        button.dataset.playing = String(!audio.paused);
        button.title = caption.textContent;
    }
    function setup() {
        if (panel) return;
        panel = document.createElement("section");
        panel.className = "player-panel";
        panel.id = "music-player";
        toggle.setAttribute("aria-controls", panel.id);
        panel.setAttribute("aria-label", "Music player");
        caption = document.createElement("span");
        caption.textContent = "GrassCats Pop · LLiosette (Unmixed & Unmastered)";
        audio = document.createElement("audio");
        audio.controls = true;
        audio.controlsList?.add("noplaybackrate");
        audio.preload = "none";
        audio.src = source.href;
        restore();
        audio.addEventListener("play", () => { started = true; channel?.postMessage("playing"); updateIndicator(); drawQueue(); remember(); });
        audio.addEventListener("pause", () => { updateIndicator(); remember(); });
        audio.addEventListener("ended",nextSong);
        window.addEventListener("pagehide", remember);
        audio.addEventListener("error", () => { caption.textContent = "Recording could not be loaded."; });
        const close = document.createElement("button");
        close.textContent = "Close player controls";
        close.onclick = closePanel;
        const transport=document.createElement("div");transport.className="queue-transport";
        prevButton=document.createElement("button");prevButton.textContent="Previous";
        prevButton.onclick=()=>{
            if(previous.length){upcoming.unshift(current());startSong(previous.pop());}
            else audio.currentTime=0;
        };
        nextButton=document.createElement("button");nextButton.textContent="Next";nextButton.onclick=nextSong;
        transport.append(prevButton,nextButton,slowDial());
        queueBox=document.createElement("details");queueLabel=document.createElement("summary");queueItems=document.createElement("ol");
        playNext=document.createElement("button");playNext.textContent="Play next in queue";playNext.onclick=nextSong;
        queueHint=document.createElement("p");
        queueHint.textContent="Use Queue beside a track to add it here.";
        queueBox.append(queueLabel,queueHint,playNext,queueItems);drawQueue();
        const library=document.createElement("a");
        library.href=new URL("../html/favorites.html",source).href;
        library.textContent="Favorite Music";
        const footer=document.createElement("footer");
        footer.append(library,close);
        panel.append(caption,audio,transport,queueBox,footer);
        document.body.append(panel);
        panel.hidden = true;
    }
    // Keep the current page and any draft inputs intact until the listener navigates.
    function createFrame() {
        frame = document.createElement("iframe");
        frame.title = "Multi-Cata";
        frame.className = "player-page";
        frame.onload = () => {
            try {
                const page = frame.contentWindow.location;
                if (page.origin !== location.origin) return;
                history.replaceState(null, "", page.href);
                document.title = frame.contentDocument.title;
                updateIndicator();
                show(!panel.hidden);
            } catch { /* External navigation. */ }
        };
        document.body.prepend(frame);
        for (const element of document.body.children) {
            if (element !== frame && element !== panel) element.hidden = true;
        }
        window.dispatchEvent(new Event("playerhost"));
    }
    function navigate(href) {
        if (!started) return false;
        if (!frame) createFrame();
        show(false);
        history.pushState(null, "", href);
        frame.contentWindow.location.replace(href);
        return true;
    }
    window.addEventListener("popstate", () => {
        if (frame && frame.contentWindow.location.href !== location.href) {
            frame.contentWindow.location.replace(location.href);
        }
    });
    function openPlayer(play, track) {
        setup();
        show(play || panel.hidden);
        if (!panel.hidden) {
            audio.preload="metadata";
            audio.focus({preventScroll:true});
        }
        if (play) {
            const src = track?.src || source.href;
            if (audio.src !== new URL(src,source).href || caption.textContent !== (track?.title || defaultTitle)) {
                if(started) previous.push(current());
                audio.src=src;
            }
            caption.textContent = track?.title || defaultTitle;
            if (audio.readyState && audio.currentTime >= audio.duration) audio.currentTime = 0;
            audio.play().then(remember).catch(() => show(true));
        }
    }
    window.multiCataPlayer = host || {openPlayer, navigate, closePanel, enqueue, playCollection};
    document.addEventListener("keydown", event => {
        if (event.key === "Escape") window.multiCataPlayer.closePanel();
    });
    toggle.onclick = () => window.multiCataPlayer.openPlayer(false);
    document.querySelectorAll("[data-play-grasscats]").forEach(button => {
        button.onclick = () => window.multiCataPlayer.openPlayer(true);
    });
    document.addEventListener("click", event => {
        const link = event.target.closest("a[href]");
        if (!link || event.defaultPrevented || event.button !== 0 || event.ctrlKey || event.metaKey ||
            event.shiftKey || event.altKey || link.hasAttribute("download") || link.target) return;
        if (link.origin !== location.origin) {
            if (host) link.target = "_top";
            return;
        }
        if (link.pathname === location.pathname && link.search === location.search && link.hash) return;
        if (window.multiCataPlayer.navigate(link.href)) event.preventDefault();
    });
})();
