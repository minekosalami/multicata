const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {database, ids} = require('../next/local-db.cjs');
const {server, openVisitor} = require('../next/runtime.cjs');

(async () => {
    const db = await database();
    const browser = await chromium.launch({channel:'chrome', args:['--autoplay-policy=no-user-gesture-required']});
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const errors = [];
    try {
        for (const width of [320, 1280]) {
            const page = await openVisitor(browser, db, errors, ids[0], width);
            await page.goto('http://127.0.0.1:' + server.address().port + '/html/index.html');
            await page.getByRole('button', {name:'Play GrassCats Pop', exact:true}).click();
            await page.waitForFunction(() => document.querySelector('audio')?.currentTime > .1);
            await page.getByRole('button', {name:'Close player controls'}).click();
            await page.evaluate(() => {
                const audio = document.querySelector('audio');
                window.listenCheck = {audio, src:audio.currentSrc, time:audio.currentTime, events:[]};
                for (const event of ['pause','loadstart','emptied','seeking']) {
                    audio.addEventListener(event, () => window.listenCheck.events.push(event));
                }
            });
            let view = page;
            async function follow(name, file, heading) {
                await view.getByRole('link', {name,exact:true}).click();
                view = page.frameLocator('.player-page');
                await view.getByRole('heading',{name:heading,exact:true}).first().waitFor({state:'attached'});
                const info = await view.locator('body').evaluate(() => ({
                    file:location.pathname.split('/').pop(), title:document.title,
                    overflow:document.documentElement.scrollWidth - innerWidth
                }));
                assert.equal(info.file,file);
                assert(info.overflow <= 1, 'Horizontal overflow on ' + file);
                if (['Writing','All Music','All Posts','All Articles'].includes(heading)) assert(info.title.includes(heading));
                assert(await page.locator('audio').evaluate(a => a === window.listenCheck.audio && !a.paused && a.currentSrc === window.listenCheck.src));
            }
            await follow('All Music','music.html','All Music');
            await follow('Home','index.html','MultiCata');
            await follow('All Articles','articles.html','All Articles');
            await follow('Writing','writing.html','Writing');
            await follow('All Articles','articles.html','All Articles');
            await follow('Home','index.html','MultiCata');
            await follow('All Posts','posts.html','All Posts');
            await view.locator('.member-menu summary').focus();
            await page.keyboard.press('Enter');
            await follow('Private messages','inbox.html','Private messages');
            await follow('Account','account.html','Account');
            await view.locator('.account-links a[href="writing.html"]').click();
            await view.getByRole('heading',{name:'Writing',exact:true}).waitFor();
            await view.getByText('Menu',{exact:true}).click();
            await follow('Favorite Music','favorites.html','Favorite Music');
            const result = await page.locator('audio').evaluate(a => ({
                advanced:a.currentTime - window.listenCheck.time, events:window.listenCheck.events
            }));
            assert(result.advanced > 0);
            assert.deepEqual(result.events,[]);
            console.log(width + 'px: renamed links, titles, keyboard menu and destinations passed. Audio advanced ' +
                result.advanced.toFixed(2) + 's with no pause, seek or source reload.');
            await page.context().close();
        }
        assert.deepEqual(errors,[]);
    } finally {
        await browser.close();
        server.close();
        await db.close();
    }
})().catch(error => { console.error(error); process.exitCode = 1; });
