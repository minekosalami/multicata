function suspendPageEffects() {
    document.documentElement.classList.toggle("effects-suspended",document.hidden || Boolean(document.querySelector(".player-page")));
}
document.addEventListener("visibilitychange",suspendPageEffects);
window.addEventListener("playerhost",suspendPageEffects);
suspendPageEffects();
const mainContent = document.querySelector("main");
if (mainContent) {
    const skip = document.createElement("a");
    mainContent.id ||= "main-content";
    mainContent.tabIndex = -1;
    skip.className = "skip-link";
    skip.href = "#" + mainContent.id;
    skip.textContent = "Skip to content";
    document.body.prepend(skip);
}

document.addEventListener("click", function (event) {
    const link = event.target.closest("a[data-back-button]");

    if (!link) {
        return;
    }

    const referrer = document.referrer;

    if (window.history.length > 1 && referrer) {
        try {
            if (new URL(referrer).origin === window.location.origin) {
                event.preventDefault();
                window.history.back();
            }
        } catch (error) {
            console.error("Could not determine the previous page:", error);
        }
    }
});


const nav = document.querySelector(".site-nav");
if (!nav) {
    try {document.documentElement.classList.toggle("motion-off",localStorage.getItem("multicata-motion")==="off");} catch {}
}
if (nav) {
    const brand = document.querySelector(".site-header .site-brand");
    if (brand) {
        const group = document.createElement("div");
        group.className = "brand-tools";
        const create = document.createElement("details");
        create.className = "create-menu";
        const trigger = document.createElement("summary");
        trigger.setAttribute("aria-label", "Create");
        trigger.title = "Create";
        const choices = document.createElement("div");
        choices.className = "create-choices";
        for (const [label, mark, destination] of [
            ["Write a post", "✎", "posts.html?compose=post"],
            ["Post an image", "▧", "posts.html?compose=image"],
            ["Upload a song", "♫", "account.html?compose=music&v=e1563fa"],
            ["Write an article", "¶", "writing.html?compose=article"]
        ]) {
            const a = document.createElement("a");
            a.href = new URL("../html/" + destination, document.currentScript.src).href;
            const icon = document.createElement("span");
            icon.className = "create-icon";
            icon.setAttribute("aria-hidden", "true");
            icon.textContent = mark;
            a.append(icon, label);
            choices.append(a);
        }
        create.append(trigger, choices);
        brand.before(group);
        group.append(brand, create);
        document.addEventListener("click", e => {
            if (!create.contains(e.target) || choices.contains(e.target)) create.open = false;
        });
        document.addEventListener("focusin", e => {
            if (!create.contains(e.target)) create.open = false;
        });
        document.addEventListener("keydown", e => {
            if (create.open && e.key === "Escape") { create.open = false; trigger.focus(); }
        });
    }
    const menu = document.createElement("details");
    menu.className = "member-menu";
    const summary = document.createElement("summary");
    summary.textContent = "Menu";
    const panel = document.createElement("div");
    for (const [name,file] of [["All Music","music"],["Favorite Music","favorites"],["Characters","characters"],["Notifications","notices"],["Private messages","inbox"],["Writing","writing"]]) {
        const a=document.createElement("a");
        a.href=new URL("../html/"+file+".html",document.currentScript.src).href;
        a.textContent=name;panel.append(a);
        if(file==="notices" && typeof supabaseClient!=="undefined"){
            async function unread(){
                try{
                    const {data:{user}}=await supabaseClient.auth.getUser();
                    if(!user)return;
                    const result=await supabaseClient.from("community_notices").select("id",{count:"exact",head:true}).eq("seen",false);
                    if(result.error || result.count==null)return;
                    a.textContent=result.count?"Notifications ("+result.count+" unread)":"Notifications";
                    summary.title=result.count?result.count+" unread notifications":"Menu";
                }catch{/* The menu remains usable if counts are unavailable. */}
            }
            unread();window.addEventListener("noticesread",unread);
        }
    }
    const motion=document.createElement("button");
    motion.type="button";
    const reduced=matchMedia("(prefers-reduced-motion: reduce)");
    function syncMotion(){
        let paused=reduced.matches;
        try {paused ||= localStorage.getItem("multicata-motion")==="off";} catch {}
        document.documentElement.classList.toggle("motion-off",paused);
        motion.textContent=reduced.matches?"Reduce effects · system preference":"Reduce effects";
        motion.setAttribute("aria-pressed",String(paused));
        motion.disabled=reduced.matches;
    }
    motion.onclick=()=>{
        try {localStorage.setItem("multicata-motion",document.documentElement.classList.contains("motion-off")?"on":"off");} catch {}
        syncMotion();
    };
    window.addEventListener("storage",syncMotion);reduced.addEventListener("change",syncMotion);
    syncMotion();panel.append(motion);
    const field=document.createElement("div");field.className="star-field";field.setAttribute("aria-hidden","true");
    const pattern=document.createElement("div");field.append(pattern);document.body.prepend(field);
    menu.append(summary,panel);nav.append(menu);
    document.addEventListener("click",e=>{if(!menu.contains(e.target))menu.open=false;});
    document.addEventListener("keydown",e=>{if(e.key==="Escape" && menu.open){menu.open=false;summary.focus();}});
}

// Native modal semantics keep keyboard focus inside the prompt and support Escape.
function communityDialog(title, action, options) {
    return new Promise(resolve=>{
        const previous=document.activeElement, modal=document.createElement("dialog");
        modal.className="community-dialog";
        const heading=document.createElement("h2");
        heading.id="community-dialog-title";heading.textContent=title;
        modal.setAttribute("aria-labelledby",heading.id);
        const form=document.createElement("form");form.method="dialog";
        form.append(heading);
        let input;
        if(options){
            const label=document.createElement("label");label.textContent=options.label;
            input=document.createElement("textarea");input.value=options.value || "";
            input.maxLength=options.limit;input.rows=4;label.append(input);form.append(label);
        }
        const cancel=document.createElement("button"),submit=document.createElement("button");
        cancel.type="button";cancel.textContent="Cancel";cancel.onclick=()=>modal.close();
        submit.value="accept";submit.textContent=action;
        form.append(cancel,submit);modal.append(form);document.body.append(modal);
        modal.addEventListener("close",()=>{
            const result=modal.returnValue==="accept"?(input?input.value:true):null;
            modal.remove();if(previous?.isConnected)previous.focus();resolve(result);
        },{once:true});
        modal.showModal();(input || cancel).focus();
    });
}
