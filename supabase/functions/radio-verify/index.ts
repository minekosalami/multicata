// Storage objects are immutable to client accounts. Verify the stored bytes before registration.
import { createClient } from "npm:@supabase/supabase-js@2";
const cors = {"Access-Control-Allow-Origin":"*", "Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info"};
const reply = (status:number, message:string) => Response.json({message}, {status, headers:cors});

Deno.serve(async request => {
    if (request.method === "OPTIONS") return new Response(null,{headers:cors});
    if (request.method !== "POST") return reply(405,"Use POST.");
    try {
        const base=Deno.env.get("SUPABASE_URL")!;
        const client=createClient(base,Deno.env.get("SUPABASE_ANON_KEY")!,{
            global:{headers:{Authorization:request.headers.get("Authorization") || ""}}
        });
        const token=request.headers.get("Authorization")?.replace(/^Bearer\s+/i,"");
        if(!token)return reply(403,"Radio owner required.");
        const {data:{user}}=await client.auth.getUser(token);
        if (!user || (await client.rpc("radio_can_edit")).data !== true) return reply(403,"Radio owner required.");
        const {path}=await request.json();
        const match=typeof path==="string" && /^([0-9a-f-]{36})\/([0-9a-f-]{36})\.(mp3|wav|flac|m4a|ogg|oga|opus|webm)$/.exec(path);
        if (!match || match[1]!==user.id) return reply(400,"Invalid recording path.");
        const url=client.storage.from("radio-announcements").getPublicUrl(path).data.publicUrl;
        const response=await fetch(url,{headers:{Range:"bytes=0-511"}});
        if (!response.ok || !response.body) return reply(400,"Recording unavailable.");
        // Some storage providers ignore Range. Read only the header even on a full response.
        const reader=response.body.getReader(), bytes=new Uint8Array(512);
        let length=0;
        try { while(length<512){const {done,value}=await reader.read();if(done)break;
            const part=value.subarray(0,512-length);bytes.set(part,length);length+=part.length;} }
        finally {await reader.cancel();}
        const h=String.fromCharCode(...bytes.subarray(0,length)), packet=27+bytes[26];
        const opus=h.startsWith("OpusHead",packet), ogg=h.startsWith("OggS")&&(opus||h.startsWith("\x01vorbis",packet));
        const checks:Record<string,boolean>={wav:h.startsWith("RIFF")&&h.startsWith("WAVE",8),flac:h.startsWith("fLaC"),
            mp3:h.startsWith("ID3")||(bytes[0]===255&&(bytes[1]&224)===224),m4a:h.startsWith("ftyp",4),
            ogg,oga:ogg,opus:ogg&&opus,webm:h.startsWith("\x1a\x45\xdf\xa3")&&h.includes("webm")};
        if (!checks[match[3]]) return reply(415,"Recording format mismatch.");
        const admin=createClient(base,Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
        const {error}=await admin.rpc("radio_verify_object",{object_path:path});
        return error?reply(500,"Verification failed."):reply(200,"Verified.");
    } catch {return reply(400,"Could not verify the recording.");}
});
