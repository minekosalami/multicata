const profileField = id => document.getElementById(id);
let savedAppearance;
const profileColors = ["background_color", "accent_color", "border_color", "text_color"];
const hexColor = value => /^#[a-f\d]{6}$/i.test(value);
// Relative luminance against the opaque #f5f5e7 identity panel.
function luminance(hex) {
    const linear = hex.slice(1).match(/../g).map(pair => {
        const c = parseInt(pair, 16) / 255;
        return c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
    });
    return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
}
function readableInk(color) {
    return hexColor(color) && (luminance("#f5f5e7") + .05) / (luminance(color) + .05) >= 4.5;
}
function applyColors(area, values) {
    for (const [key, property] of [["accent_color","--profile-accent"],["border_color","--profile-border"],["text_color","--profile-text"]]) {
        const color = values[key];
        if (key === "text_color" ? readableInk(color) : hexColor(color)) area.style.setProperty(property, color);
        else area.style.removeProperty(property);
    }
}
const previewFiles = new Map();
function forgetPreviewFiles() {
    for (const url of previewFiles.values()) URL.revokeObjectURL(url);
    previewFiles.clear();
}
function refreshPreview() {
    const preview = profileField("appearancePreview");
    if (!savedAppearance || !preview) return;
    const values = Object.fromEntries(profileColors.map(key => [key, profileField(key).value.trim()]));
    applyColors(preview, values);
    profileField("colorFeedback").textContent = values.text_color && hexColor(values.text_color) && !readableInk(values.text_color)
        ? "Choose a darker text color so it can be read on the profile panel." : "";
    const image = (key, clear) => previewFiles.get(key) || (!profileField(clear).checked && communityImage(savedAppearance[key], savedAppearance.user_id));
    const bg = image("background_path", "clearBackground");
    preview.style.backgroundImage = bg ? 'url("' + bg + '")' : "";
    preview.style.backgroundColor = hexColor(values.background_color) ? values.background_color : "";
    for (const [selector,src] of [[".profile-banner",image("banner_path","clearBanner")],[".preview-avatar",profileField("profilePicturePreview").getAttribute("src")]]) {
        const img = preview.querySelector(selector);
        if (src && img.getAttribute("src") !== src) img.src = src;
        if (!src) img.removeAttribute("src");
        img.hidden = !src;
    }
    preview.querySelector(".preview-name").textContent = profileField("displayName").value || profileField("username").value;
    preview.querySelector(".preview-bio").textContent = profileField("bio").value;
}
document.addEventListener("DOMContentLoaded", () => {
    const editor = profileField("appearance");
    if (!editor) return;
    profileField("profileArea").addEventListener("input", refreshPreview);
    for (const [key, clear] of [["banner_path","clearBanner"],["background_path","clearBackground"]]) {
        const input = profileField(key);
        profileField(clear).addEventListener("change", () => {
            if (!profileField(clear).checked) return;
            input.value = "";
            if (previewFiles.has(key)) URL.revokeObjectURL(previewFiles.get(key));
            previewFiles.delete(key);
            refreshPreview();
        });
        input.addEventListener("change", async () => {
            const file = input.files[0];
            if (previewFiles.has(key)) URL.revokeObjectURL(previewFiles.get(key));
            previewFiles.delete(key);
            if (file) profileField(clear).checked = false;
            refreshPreview();
            if (!file) return;
            try {
                await validateImage(file);
                if (file !== input.files[0]) return;
                previewFiles.set(key, URL.createObjectURL(file));
                profileField("profileMessage").textContent = "";
            } catch {
                if (file !== input.files[0]) return;
                input.value = "";
                profileField("profileMessage").textContent = "Choose a valid JPEG or static PNG of 5 MB or less.";
            }
            refreshPreview();
        });
    }
});
function loadProfileOptions(profile) {
    savedAppearance = profile;
    forgetPreviewFiles();
    profileField("appearance").hidden = !("social_links" in profile);
    for (const id of profileColors) {
        profileField(id).value = profile[id] || "";
        profileField(id).parentElement.hidden = !(id in profile);
    }
    profileField("social_links").value = (profile.social_links || []).join("\n");
    for (const id of ["banner_path","background_path"]) profileField(id).value = "";
    for (const id of ["clearBanner","clearBackground"]) profileField(id).checked = false;
    refreshPreview();
}

async function readProfileOptions(owner, staged) {
    if (profileField("appearance").hidden) return {};
    const options = {};
    for (const key of profileColors) {
        if (!(key in savedAppearance)) continue;
        const color = profileField(key).value.trim();
        if (color && !hexColor(color)) throw new Error("Enter a six-digit hex color.");
        if (key === "text_color" && color && !readableInk(color)) throw new Error("Choose a darker text color so it can be read on the profile panel.");
        options[key] = color || null;
    }
    options.social_links = profileField("social_links").value.split(/\s+/).filter(Boolean).map(socialUrl);
    if (options.social_links.length > 5) throw new Error("Use up to five social links.");
    for (const [key, clear] of [["banner_path","clearBanner"],["background_path","clearBackground"]]) {
        const file = profileField(key).files[0];
        if (file) {
            options[key] = await uploadCommunityImage(owner, file);
            staged.push(options[key]);
        } else if (profileField(clear).checked) options[key] = null;
    }
    return options;
}

function applyProfileOptions(area, profile) {
    area.querySelector(".bio").textContent=profile.bio || "No bio yet.";
    const avatar = document.createElement(profile.profile_picture ? "img" : "div");
    if (profile.profile_picture) {
        avatar.className = "profile-picture";
        avatar.src = profile.profile_picture;
        avatar.alt = "Profile picture";
    } else {
        avatar.className = "default-profile-picture";
        avatar.textContent = "?";
    }
    area.querySelector(".profile-picture-container").append(avatar);
    const banner = communityImage(profile.banner_path, profile.user_id);
    if (banner) {
        const image = document.createElement("img");
        image.className = "profile-banner";
        image.src = banner;
        image.alt = "";
        area.prepend(image);
    }
    const background = communityImage(profile.background_path, profile.user_id);
    if (background || profile.background_color) document.body.classList.add("custom-profile-background");
    if (background) document.body.style.backgroundSize = "cover";
    if (background) document.body.style.backgroundImage = 'url("' + background + '")';
    if (hexColor(profile.background_color)) {
        document.body.style.backgroundColor = profile.background_color;
        if (!background) document.body.style.backgroundImage = "none";
    }
    applyColors(area, profile);
    for (const value of profile.social_links || []) {
        try {
            const link = document.createElement("a");
            link.href = socialUrl(value);
            link.textContent = new URL(link.href).hostname;
            link.rel = "me noopener noreferrer";
            area.querySelector(".profile-information").append(link, " ");
        } catch { /* Ignore invalid legacy URLs. */ }
    }
}
