// Station IDs and timeline timestamps are independent of the audio host.
export function radioURL(client, item) {
    if (item.provider === "bundled") return new URL("../audio/GrassCatsPopM.mp3", import.meta.url).href;
    const bucket = item.provider === "catalog" ? "creator-music" : "radio-announcements";
    const path=item.provider==="catalog" && item.stream_path ? item.stream_path : item.path;
    return client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
}

export function artworkURL(client,item) {
    if(item.art)return client.storage.from("community-images").getPublicUrl(item.art).data.publicUrl;
    return item.provider==="bundled"?new URL("../landingimages/mc0.4.1.png",import.meta.url).href:null;
}

export async function uploadAnnouncement(client,file,owner) {
    if(!file.path){
        const path=owner+"/"+crypto.randomUUID()+"."+file.ext;
        const {error}=await client.storage.from("radio-announcements").upload(path,file.body,{contentType:file.mime});
        if(error)throw error;
        file.path=path;
    }
    const {error}=await client.functions.invoke("radio-verify",{body:{path:file.path}});
    if(error)throw Error("The uploaded recording could not be verified. Check its format and retry.");
    return file.path;
}
