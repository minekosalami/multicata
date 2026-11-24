const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {database, ids} = require('../next/local-db.cjs');
const {server, openVisitor} = require('../next/runtime.cjs');

(async () => {
    const db = await database();
    const browser = await chromium.launch({channel:'chrome'});
    const errors = [], results = [];
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const home = 'http://127.0.0.1:' + server.address().port + '/html/index.html';
    try {
        for (const width of [320, 360, 768, 1280]) {
            const page = await openVisitor(browser, db, errors, ids[0], width);
            const logo = page.locator('.drifting-logo').first();
            const state = expected => page.waitForFunction(value =>
                getComputedStyle(document.querySelector('.drifting-logo')).animationPlayState === value, expected);
            await page.goto(home);
            await page.locator('.record-row').first().waitFor();
            await page.evaluate(() => scrollTo(0,0));
            await state('running');
            const proof = await logo.evaluate(img => {
                const original = document.querySelector('.orbital-logo');
                const tracks = [...document.querySelectorAll('.logo-track')];
                const copies = [...document.querySelectorAll('.drifting-logo')];
                const animations = copies.map(el => el.getAnimations()[0]);
                let overlaps = 0;
                for (let t = 0; t <= 160000; t += 1000) {
                    animations.forEach(animation => { animation.currentTime = t; });
                    const boxes = copies.map(el => el.getBoundingClientRect());
                    boxes.forEach((a, index) => {
                        overlaps += boxes.slice(index + 1).filter(b =>
                            a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom
                        ).length;
                    });
                }
                return {counts: tracks.map(track => track.children.length), overlaps,
                    artwork: copies.every(el => el.currentSrc === original.currentSrc && el.naturalWidth > 0),
                    decorative: img.closest('[aria-hidden=true]') !== null && getComputedStyle(img).pointerEvents === 'none',
                    overflow: document.documentElement.scrollWidth - innerWidth};
            });
            assert.deepEqual(proof.counts, Array(10).fill(3));
            assert.equal(proof.overlaps, 0);
            assert(proof.artwork && proof.decorative);
            assert.equal(proof.overflow, 0);
            const time = () => logo.evaluate(el=>el.getAnimations()[0].currentTime);
            const start = await time();
            await page.waitForFunction(t=>document.querySelector('.drifting-logo').getAnimations()[0].currentTime > t+80,start);
            await page.locator('#directory').scrollIntoViewIfNeeded();
            await state('paused');
            await page.waitForTimeout(80);
            const paused = await time();
            await page.waitForTimeout(120);
            assert.equal(await time(),paused);
            await page.evaluate(() => scrollTo(0,0));await state('running');
            await page.emulateMedia({reducedMotion:'reduce'});await state('paused');
            await page.emulateMedia({reducedMotion:'no-preference'});await state('running');
            await page.locator('.member-menu summary').click();
            await page.getByRole('button',{name:'Reduce effects',exact:true}).click();await state('paused');
            await page.getByRole('button',{name:'Reduce effects',exact:true}).click();await state('running');
            await page.keyboard.press('Escape');
            await page.getByRole('button',{name:'Play GrassCats Pop',exact:true}).click();
            await page.getByRole('button',{name:'Close player controls'}).click();
            await page.locator('#reading header a').click();await page.frameLocator('.player-page').locator('h1').waitFor();
            await state('paused');
            assert(await page.locator('audio').evaluate(a=>!a.paused));
            results.push({width,...proof,offscreenFrozen:true,systemAndMenuPause:true,playerHostPaused:true});
            await page.context().close();
        }
        assert.deepEqual(errors,[]);
        console.log(results);
        console.log('Drift geometry, loop, visibility, effects, hit testing and player-host checks passed at all four sizes.');
    } finally {await browser.close();server.close();await db.close();}
})().catch(err=>{console.error(err);process.exitCode=1;});
