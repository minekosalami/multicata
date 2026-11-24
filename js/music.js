function trackCredit(track, artist) {
    return track.title + " · " + (artist || "Multi-Cata");
}
function playRecording(track, artist) {
    if (!track.audio_path.startsWith(track.user_id + "/")) return;
    const src = supabaseClient.storage.from("creator-music").getPublicUrl(track.audio_path).data.publicUrl;
    window.multiCataPlayer.openPlayer(true, {src, title:trackCredit(track, artist)});
}
async function loadDiscography(area, profile) {
    const {data, error} = await supabaseClient.from("tracks").select("*")
        .eq("user_id",profile.user_id).order("created_at",{ascending:false});
    if (error || !data?.length) return;
    const section = document.createElement("section");
    const heading = document.createElement("h2");
    heading.textContent = "Music";
    section.append(heading);
    const releases = new Map();
    for (const track of data) {
        const release = track.release_name || "";
        if (!releases.has(release)) {
            const group = document.createElement("div");
            if (release) {
                const name = document.createElement("h3");
                name.textContent = release;
                group.append(name);
            }
            section.append(group);
            releases.set(release,group);
        }
        const row = document.createElement("article");
        row.id = "track-" + track.id;
        const title = document.createElement("h4");
        title.textContent = track.title;
        const play = document.createElement("button");
        play.textContent = "Play " + track.title;
        play.onclick = () => playRecording(track,profile.display_name || profile.username);
        const share = document.createElement("a");
        share.href = "posts.html?track=" + track.id;
        share.textContent = "Share in a post";
        const detail=document.createElement("a");detail.href="track.html?id="+encodeURIComponent(track.id);detail.textContent="Track details and comments";
        const actions=document.createElement("div");actions.className="discography-actions";
        actions.append(play,detail,share);row.append(title,actions);
        if (track.credits) {
            const credits = document.createElement("p");
            credits.textContent = track.credits;
            row.append(credits);
        }
        releases.get(release).append(row);
    }
    area.append(section);
    if (location.hash.startsWith("#track-")) document.getElementById(location.hash.slice(1))?.scrollIntoView();
}

async function loadTrackChoices() {
    const select = document.getElementById("postTrack");
    const {data} = await supabaseClient.from("tracks").select("id,title").order("title");
    for (const track of data || []) select.add(new Option(track.title,track.id));
    const selected = new URLSearchParams(location.search).get("track");
    if (Array.from(select.options).some(option => option.value === selected)) select.value = selected;
}

async function validateAudioContainer(blob) {
    // M4A and Ogg share containers with video. Inspect local metadata without playing the file.
    const media = document.createElement("video");
    const url = URL.createObjectURL(blob);
    let timeout;
    try {
        await new Promise((resolve, reject) => {
            const unreadable = () => reject(new Error("This browser could not read the recording. Try another audio export."));
            timeout = setTimeout(unreadable, 15000);
            media.onloadedmetadata = resolve;
            media.onerror = unreadable;
            media.preload = "metadata";
            media.src = url;
        });
        if (media.videoWidth || media.videoHeight) throw new Error("Choose an audio-only recording.");
    } finally {
        clearTimeout(timeout);
        media.onloadedmetadata = media.onerror = null;
        media.removeAttribute("src");
        media.load();
        URL.revokeObjectURL(url);
    }
}

async function recordingUpload(file) {
    const extension = /\.([a-z0-9]+)$/i.exec(file?.name || "")?.[1].toLowerCase();
    const mimeTypes = {mp3:"audio/mpeg", wav:"audio/wav", flac:"audio/flac", m4a:"audio/mp4",
        ogg:"audio/ogg", oga:"audio/ogg", opus:"audio/ogg"};
    if (!Object.hasOwn(mimeTypes, extension)) throw new Error("Choose an MP3, WAV, FLAC, M4A, or Ogg audio file.");
    if (file.size > 50 * 1024 * 1024) throw new Error("Choose a song that is 50 MB or smaller.");

    const bytes = new Uint8Array(await file.slice(0, 300).arrayBuffer());
    const header = String.fromCharCode(...bytes);
    const mime = mimeTypes[extension];
    let matches;
    switch (mime) {
        case "audio/mpeg":
            matches = header.startsWith("ID3") || (bytes[0] === 255 && (bytes[1] & 224) === 224);
            break;
        case "audio/wav":
            matches = header.startsWith("RIFF") && header.startsWith("WAVE", 8);
            break;
        case "audio/flac":
            matches = header.startsWith("fLaC");
            break;
        case "audio/mp4":
            matches = header.startsWith("ftyp", 4);
            break;
        case "audio/ogg": {
            // The first packet follows the Ogg page header and its segment table.
            const packet = 27 + bytes[26];
            matches = header.startsWith("OggS") && (header.startsWith("OpusHead", packet) ||
                (extension !== "opus" && header.startsWith("\x01vorbis", packet)));
            break;
        }
    }
    if (!matches) throw new Error("The file contents do not match the ." + extension + " extension.");

    // Multipart storage uploads use the Blob MIME type, which file pickers may omit or mislabel.
    const body = file.slice(0, file.size, mime);
    if (mime === "audio/mp4" || mime === "audio/ogg") await validateAudioContainer(body);
    return {extension, mime, body};
}

async function publishTrack(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const fields = form.elements;
    const status = form.querySelector("[role=status]");
    if (fields.publish.disabled) return;
    fields.publish.disabled = true;
    status.replaceChildren();
    try {
        const title = fields.title.value.trim();
        const file = fields.recording.files[0];
        if (!title) throw new Error("Enter a track title.");
        const recording = await recordingUpload(file);
        const {data:{user}} = await supabaseClient.auth.getUser();
        if (!user) throw new Error("Sign in to publish music.");
        const path = user.id + "/" + crypto.randomUUID() + "." + recording.extension;
        status.textContent = "Uploading recording…";
        const bucket = supabaseClient.storage.from("creator-music");
        const art = fields.art.files[0] ? await uploadCommunityImage(user.id,fields.art.files[0]) : null;
        const uploaded = await bucket.upload(path, recording.body, {contentType:recording.mime});
        if (uploaded.error) {if(art)await supabaseClient.storage.from("community-images").remove([art]);throw new Error("Upload failed. Please try again.");}
        const published = await supabaseClient.from("tracks").insert({user_id:user.id,title,
            release_name:fields.releaseName.value.trim() || null,credits:fields.credits.value.trim() || null,...(art?{art_path:art}:{}),audio_path:path}).select("id").single();
        if (published.error) {
            if(published.error.code && /^[0-9A-Z]{5}$/.test(published.error.code)) {
                await bucket.remove([path]);
                if(art)await supabaseClient.storage.from("community-images").remove([art]);
            }
            throw new Error("Could not publish the track. Please try again.");
        }
        form.reset();
        status.textContent = "Published on your profile. ";
        const link = document.createElement("a");
        link.href = "profile.html?id=" + encodeURIComponent(user.id) + "#track-" + published.data.id;
        link.textContent = "View track on profile";
        status.append(link);
    } catch (error) { status.textContent = error.message; }
    finally { fields.publish.disabled = false; }
}
