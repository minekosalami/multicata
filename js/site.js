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
