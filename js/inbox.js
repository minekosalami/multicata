(async () => {
    const status = document.getElementById("status");
    const threads = document.getElementById("threads");
    const history = document.getElementById("history");
    const form = document.getElementById("send");
    const block = document.getElementById("block");
    const older = document.getElementById("older");
    const peer = new URLSearchParams(location.search).get("peer");
    const {data: {user}} = await supabaseClient.auth.getUser();
    if (!user) {
        const link = document.createElement("a");
        link.href = "account.html?next=inbox";
        link.textContent = "Sign in to view private messages";
        status.replaceChildren(link);
        return;
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (peer && (!uuid.test(peer) || peer === user.id)) {status.textContent = "Invalid recipient."; return;}
    const {data: authListener} = supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === "SIGNED_OUT" || (session && session.user.id !== user.id)) {
            document.body.replaceChildren();
            location.replace("account.html");
        }
    });
    let limit = 50;
    let blocked = false;
    async function result(query) {
        const {data, error} = await query;
        if (error) throw error;
        return data;
    }
    async function refresh() {
        if (peer) {
            const messages = await result(supabaseClient.from("private_messages").select("*")
                .or("and(sender.eq." + user.id + ",recipient.eq." + peer + "),and(sender.eq." + peer + ",recipient.eq." + user.id + ")")
                .order("created_at",{ascending:false}).order("id",{ascending:false}).limit(limit + 1));
            older.hidden = messages.length <= limit;
            const visible = messages.slice(0,limit).reverse();
            const list = document.createDocumentFragment();
            for (const m of visible) {
                const item = document.createElement("li");
                const time = document.createElement("small");
                time.textContent = (m.sender === user.id ? "You" : "Them") + " · " + new Date(m.created_at).toLocaleString();
                const body = document.createElement("p");
                body.textContent = m.body;
                item.append(time,body);
                if (m.recipient === user.id) {
                    const report = document.createElement("button");
                    report.textContent = "Report";
                    report.onclick = async () => {
                        const reason = (await communityDialog("Report message","Submit report",{label:"Reason for reporting (up to 500 characters)",limit:500}))?.trim();
                        if (!reason) return;
                        if (reason.length > 500) {status.textContent = "Use 500 characters or fewer."; return;}
                        const {error} = await supabaseClient.from("message_reports").insert({message_id:m.id,reporter:user.id,reason});
                        status.textContent = !error ? "Reported." : error.code === "23505" ? "Already reported." : "Could not submit report.";
                    };
                    item.append(report);
                }
                list.append(item);
            }
            history.replaceChildren(list);
            const unread = visible.filter(m => m.recipient === user.id && !m.is_read).map(m => m.id);
            if (unread.length && !document.hidden) await result(supabaseClient.from("private_messages").update({is_read:true}).in("id",unread));
            blocked = Boolean(await result(supabaseClient.from("message_blocks").select("blocked").eq("blocker",user.id).eq("blocked",peer).maybeSingle()));
            block.hidden = false;
            block.textContent = blocked ? "Unblock" : "Block";
            form.hidden = !await result(supabaseClient.rpc("can_message",{peer}));
        }
        const rows = await result(supabaseClient.rpc("inbox_threads"));
        const ids = [...new Set([...rows.map(row => row.peer), ...(peer ? [peer] : [])])];
        const profiles = ids.length ? await result(supabaseClient.from("profiles").select("user_id,username").in("user_id",ids)) : [];
        const name = id => profiles.find(p => p.user_id === id)?.username || "Member";
        threads.replaceChildren();
        for (const row of rows) {
            const link = document.createElement("a");
            link.href = "inbox.html?peer=" + row.peer;
            link.textContent = name(row.peer) + (Number(row.unread) ? " (" + row.unread + " unread)" : "");
            threads.append(link);
        }
        if (peer) document.getElementById("conversation").textContent = "Conversation with " + name(peer);
        else if (!rows.length) threads.textContent = "No conversations yet. Open a member’s profile to message them.";
    }
    let refreshing = false;
    let refreshAgain = false;
    async function reload() {
        if (refreshing) {refreshAgain = true; return;}
        refreshing = true;
        try {
            do {
                refreshAgain = false;
                await refresh();
            } while (refreshAgain);
        }
        catch { status.textContent = "Private messages are unavailable. Try again later."; }
        finally {refreshing = false;}
    }
    older.onclick = () => {limit += 50; reload();};
    block.onclick = async () => {
        block.disabled = true;
        const table = supabaseClient.from("message_blocks");
        const {error} = await (blocked ? table.delete().eq("blocker",user.id).eq("blocked",peer) : table.insert({blocker:user.id,blocked:peer}));
        status.textContent = error ? "Could not update block." : "";
        await reload();
        block.disabled = false;
    };
    form.onsubmit = async event => {
        event.preventDefault();
        const body = form.elements.body.value.trim();
        if (!body || form.elements.submitButton.disabled) return;
        form.elements.submitButton.disabled = true;
        const {error} = await supabaseClient.from("private_messages").insert({sender:user.id,recipient:peer,body});
        if (error) status.textContent = "Message could not be sent.";
        else { form.elements.body.value = ""; status.textContent = "Sent."; }
        await reload();
        form.elements.submitButton.disabled = false;
    };
    await reload();
    window.addEventListener("focus",reload);
    const timer = setInterval(() => { if (!document.hidden) reload(); },30000);
    window.addEventListener("playerhost", () => {
        clearInterval(timer);
        authListener.subscription.unsubscribe();
        window.removeEventListener("focus",reload);
    }, {once:true});
})().catch(() => {document.getElementById("status").textContent = "Could not open private messages.";});
