const SUPABASE_URL = "https://ncmizvdipzjwiknslohn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_l2Bi2NHypj5wHzOqE2U_nw_CFXaF1T-";

// Keep the SDK's authenticated request. Only active song uploads need XHR's
// upload progress events. All other requests use the browser's normal fetch.
const songUploadProgress = new Map();
function fetchWithSongProgress(input, init) {
    const url = typeof input === "string" ? input : input.url || input.href;
    const progress = songUploadProgress.get(url);
    if (!progress || init?.method !== "POST") return fetch(input, init);
    return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.upload.onprogress = event => {
            if (event.lengthComputable) progress(event.loaded / event.total);
        };
        xhr.open("POST", url);
        new Headers(init.headers).forEach((value, name) => xhr.setRequestHeader(name, value));
        xhr.onload = () => resolve(new Response(xhr.responseText, {status:xhr.status, statusText:xhr.statusText}));
        xhr.onerror = () => reject(new TypeError("Recording upload connection failed."));
        xhr.onabort = () => reject(new DOMException("Upload aborted.", "AbortError"));
        const abort = () => xhr.abort();
        if (init.signal?.aborted) { reject(init.signal.reason); return; }
        init.signal?.addEventListener("abort", abort, {once:true});
        xhr.onloadend = () => init.signal?.removeEventListener("abort", abort);
        xhr.send(init.body);
    });
}

const supabaseClient = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {global:{fetch:fetchWithSongProgress}}
);
