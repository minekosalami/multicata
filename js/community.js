// Shared by the profile editor, public profiles and the post feed.
const imageTypes = ["image/jpeg", "image/png"];

async function validateImage(file) {
    if (!imageTypes.includes(file.type) || file.size > 5 * 1024 * 1024) {
        throw new Error("Choose a JPEG or static PNG of 5 MB or less.");
    }
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.type === "image/jpeg") {
        if (bytes[0] !== 255 || bytes[1] !== 216 || bytes[2] !== 255) throw new Error("Invalid JPEG.");
    } else {
        if (![137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) throw new Error("Invalid PNG.");
        const view = new DataView(bytes.buffer);
        for (let i = 8; i + 12 <= bytes.length; i += 12 + view.getUint32(i)) {
            if (view.getUint32(i + 4) === 0x6163544c) throw new Error("Choose a still image.");
        }
    }
    const bitmap = await createImageBitmap(file);
    bitmap.close();
}

async function uploadCommunityImage(userId, file, bucket = "community-images") {
    await validateImage(file);
    const path = userId + "/" + crypto.randomUUID() + (file.type === "image/png" ? ".png" : ".jpg");
    const { error } = await supabaseClient.storage.from(bucket).upload(path, file);
    if (error) throw error;
    return path;
}

function communityImage(path, owner) {
    if (typeof path !== "string" || !path.startsWith(owner + "/")) return null;
    return supabaseClient.storage.from("community-images").getPublicUrl(path).data.publicUrl;
}

function socialUrl(value) {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
        throw new Error("Enter a full http or https link.");
    }
    return url.href;
}

async function attachTrackDetails(posts) {
    const ids = [...new Set(posts.map(post => post.track_id).filter(Boolean))];
    if (!ids.length) return;
    const {data} = await supabaseClient.from("tracks").select("id,title,user_id").in("id",ids);
    const tracks = new Map((data || []).map(track => [track.id,track]));
    for (const post of posts) post.tracks = tracks.get(post.track_id);
}

function renderPostMedia(container, post) {
    if (post.image_path) {
        const image = document.createElement("img");
        supabaseClient.storage.from("post-images").createSignedUrl(post.image_path,3600).then(({data}) => {
            if (data) image.src = data.signedUrl;
        });
        image.alt = "Image attached to post";
        image.loading = "lazy";
        image.className = "attached-image";
        container.append(image);
    }
    if (post.track_id && post.tracks) {
        const link = document.createElement("a");
        link.href = "profile.html?id=" + encodeURIComponent(post.tracks.user_id) + "#track-" + post.track_id;
        link.textContent = post.tracks.title;
        container.append(link);
    }
    if (post.track === "grasscats-pop") {
        const link = document.createElement("a");
        link.href = "lliosette.html#grasscats-pop";
        link.textContent = "GrassCats Pop · LLiosette";
        container.append(link);
    }
}

function postActions(container, post, user, refresh) {
    if (post.user_id !== user?.id) return;
    const edit = document.createElement("button");
    const remove = document.createElement("button");
    edit.textContent = "Edit";
    remove.textContent = "Delete";
    const status = document.createElement("span");
    status.setAttribute("role", "status");
    const modify = async (content) => {
        edit.disabled = remove.disabled = true;
        try {
            const table = supabaseClient.from("posts");
            const query = content === null ? table.delete() : table.update({content});
            const {error} = await query.eq("id", post.id).eq("user_id", user.id).select("id").single();
            if (error) throw error;
            if (content === null && post.image_path) await supabaseClient.storage.from("post-images").remove([post.image_path]);
            await refresh();
        } catch {
            status.textContent = "Could not change this post. Try again.";
        } finally {
            edit.disabled = remove.disabled = false;
        }
    };
    edit.onclick = async () => {
        const content = (await communityDialog("Edit post","Save",{label:"Post text",value:post.content,limit:1000}))?.trim();
        if (content === undefined || content === post.content) return;
        if ((!content && !post.image_path && !post.track && !post.track_id) || content.length > 1000) {
            status.textContent = "Enter up to 1,000 characters.";
            return;
        }
        modify(content);
    };
    remove.onclick = async () => { if (await communityDialog("Delete this post?","Delete")) modify(null); };
    container.append(edit, remove, status);
}
