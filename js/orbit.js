(() => {
    const splash = document.querySelector("#orbit-splash");
    const messages = [
        "Join Nart Club!", "mmmmm, Cata...", "from LLiosette, to you.", "Pet's not dead!",
        "Play NeoCata99.", "GrassCats!", "A CaveCats Christmas.", "CatsSaga on the NekoMINI",
        "PLAY CATSSAGA NOW.", "Have fun!", "Konnichiwa!", "Bart approves of you.",
        "Post some music!", "Be happy.", "Be sad.", "Write some articles!", "Thanks to HALLOW"
    ];
    function pick() {
        let last;
        try { last = sessionStorage.getItem("multicata-splash"); } catch {}
        const pool = messages.filter(message => message !== last);
        const message = pool[Math.floor(Math.random() * pool.length)];
        splash.textContent = message;
        try { sessionStorage.setItem("multicata-splash", message); } catch {}
    }
    const gallery=new IntersectionObserver(entries=>{
        for(const hit of entries){
            if(!hit.isIntersecting)continue;
            hit.target.src=hit.target.dataset.nearSrc;gallery.unobserve(hit.target);
        }
    },{rootMargin:"120px"});
    document.querySelectorAll("[data-near-src]").forEach(img=>gallery.observe(img));
    pick();
    window.addEventListener("pageshow", e => { if (e.persisted) pick(); });

    const lane = document.querySelector(".drift-lane");
    const field = document.querySelector(".logo-field");
    const firstTrack = field.firstElementChild;
    const trackVisibility = new IntersectionObserver(entries => {
        for (const entry of entries) entry.target.classList.toggle("in-view", entry.isIntersecting);
    });
    for (let i = 0; i < 10; i++) {
        const track = i === 0 ? firstTrack : firstTrack.cloneNode(false);
        const logo = firstTrack.firstElementChild;
        const duration = 128 + i * 3;
        track.style.setProperty("--duration", duration + "s");
        for (let j = 0; j < 3; j++) {
            const copy = i === 0 && j === 0 ? logo : logo.cloneNode(false);
            copy.style.setProperty("--phase", -(i * 41 + duration * j / 3) + "s");
            if (copy !== logo) track.append(copy);
        }
        if (i) field.append(track);
        trackVisibility.observe(track);
    }
    const stage = document.querySelector(".orbit-stage");
    let inView = true, driftInView = false, playerHost = false;
    function sync() {
        const visible = !document.hidden && !playerHost;
        stage.classList.toggle("orbit-running", inView && visible);
        lane.classList.toggle("drift-running", driftInView && visible);
    }
    new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; sync(); }).observe(stage);
    new IntersectionObserver(([entry]) => { driftInView = entry.isIntersecting; sync(); }).observe(lane);
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("playerhost", () => { playerHost = true; sync(); });
    sync();
})();
