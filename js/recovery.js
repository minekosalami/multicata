(() => {
    // Register before the SDK finishes consuming the email callback.
    const fragment = new URLSearchParams(location.hash.slice(1));
    const query = new URLSearchParams(location.search);
    const callback = ['type','access_token','error','error_code','code'].some(key => fragment.has(key) || query.has(key));
    let recoveryUser;
    let finished = false;
    let render;
    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'PASSWORD_RECOVERY') recoveryUser = session?.user?.id;
        if (recoveryUser && session?.user?.id !== recoveryUser) recoveryUser = undefined;
        if (render && !finished && (event === 'PASSWORD_RECOVERY' || event === 'SIGNED_OUT')) render();
    });
    document.addEventListener('DOMContentLoaded', async () => {
        const request = document.querySelector('#requestReset');
        const change = document.querySelector('#setPassword');
        const verify = document.querySelector('#verifyCode');
        const email = document.querySelector('#recoveryEmail');
        const codeEmail = document.querySelector('#codeEmail');
        const code = document.querySelector('#recoveryCode');
        const status = document.querySelector('#resetStatus');
        const password = document.querySelector('#newPassword');
        const confirmation = document.querySelector('#repeatPassword');
        render = () => {
            request.hidden = Boolean(recoveryUser);
            verify.hidden = true;
            change.hidden = !recoveryUser;
            status.textContent = callback && !recoveryUser ? 'This reset link is invalid or expired. Request a new one.' : '';
        };
        try {
            if (callback) {
                const {data} = await supabaseClient.auth.getSession();
                // The implicit callback may finish before the listener is attached.
                if (fragment.get('type') === 'recovery' && data.session?.access_token &&
                    data.session.access_token === fragment.get('access_token')) recoveryUser = data.session.user.id;
            }
        } catch {
            recoveryUser = undefined;
        } finally {
            if (callback) history.replaceState(null,'',location.pathname);
            render();
        }
        function showCode() {
            request.hidden = true;
            verify.hidden = false;
            change.hidden = true;
            codeEmail.value = email.value.trim();
            status.textContent = '';
            (codeEmail.value ? code : codeEmail).focus();
        }
        document.querySelector('#haveCode').onclick = showCode;
        document.querySelector('#anotherCode').onclick = () => {
            email.value = codeEmail.value.trim();
            code.value = '';
            render();
            email.focus();
        };
        verify.onsubmit = async event => {
            event.preventDefault();
            const button = verify.querySelector('button');
            if (button.disabled) return;
            button.disabled = true;
            try {
                const {data,error} = await supabaseClient.auth.verifyOtp({email:codeEmail.value.trim(), token:code.value.trim(), type:'recovery'});
                if (error || !data.session?.user?.id) throw new Error();
                recoveryUser = data.session.user.id;
                code.value = '';
                render();
                password.focus();
            } catch {
                status.textContent = 'Could not verify the code. Check the email address and code, or request another code.';
            } finally { button.disabled = false; }
        };
        request.onsubmit = async event => {
            event.preventDefault();
            const button = request.querySelector('button');
            if (button.disabled) return;
            button.disabled = true;
            try {
                const {error} = await supabaseClient.auth.resetPasswordForEmail(
                    document.querySelector('#recoveryEmail').value.trim(),
                    {redirectTo:new URL('reset.html',location.href).href}
                );
                if (error) throw error;
                showCode();
                status.textContent = 'If this address has a Multi-Cata account, check your email for a reset code.';
            } catch {
                status.textContent = 'Could not request a code. Wait a moment and try again.';
            } finally { button.disabled = false; }
        };
        change.onsubmit = async event => {
            event.preventDefault();
            if (password.value !== confirmation.value) {
                status.textContent = 'The passwords do not match.';
                confirmation.focus();
                return;
            }
            const button = change.querySelector('button');
            if (button.disabled || !recoveryUser) return;
            button.disabled = true;
            try {
                const {data,error} = await supabaseClient.auth.getUser();
                if (error || !recoveryUser || data.user?.id !== recoveryUser) {
                    recoveryUser = undefined;
                    render();
                    return;
                }
                const result = await supabaseClient.auth.updateUser({password:password.value});
                if (result.error) throw result.error;
                finished = true;
                change.reset();
                change.hidden = true;
                status.textContent = 'Your password has been updated.';
            } catch {
                status.textContent = 'Could not save that password. Try a different password or request a new reset link.';
                request.hidden = false;
            } finally { button.disabled = false; }
        };
    });
})();
