# MultiCata nine-persona stress test

## A. Initial website condition

The ordinary journeys were in better shape than the failure paths. At revision `e961a879c60fa3e821d12f37a92fe475ac4a8bf6`, the existing database, community, and homepage suites passed. The route review rendered 40 page/viewport combinations. Then a guest lost an entire published article when only its vote counts went offline. A writer saved a replacement draft and was still invited to restore the obsolete one. Neither fault required malformed content.

**Environment.** Windows 10.0.26300, Node 24.18.0, installed Chrome 158.0.8127.38 in Playwright headless mode. Additional runs used Playwright Firefox 159.0, Windows WebKit 27.2, and Chromium for native tab zoom. All nine people below are fictional task frameworks. Quoted remarks interpret browser evidence. They are not interviews or measurements of human comprehension.

**Isolation.** Static HTML, shared JavaScript, CSS, Supabase-style queries, database functions with row-level security, storage adapters, and a persistent audio host that presents navigation in an iframe. A loopback static server and fresh PGlite databases supplied disposable reader, creator, and third-member identities. The older authentication test used its own mock. Cloud email delivery, live signup, production permissions and real private messages were outside scope. The existing suites ran against a temporary archive of the starting revision with each round's changes copied in. This kept their screenshot writers away from previous QA work. The application working tree was clean at intake.

**Route inventory.** Root entry; Home; Account and Reset password; Articles, Article and Writing; Music, Track and Favorites; Profile, LLiosette and Dorian Hallow; Characters; Posts, Chat, Inbox and Notices; the HTML secret entry and both existing pages in the secrets directory. Review included the Humanization report and its profile, reduced-motion, artist-page and player regression journeys. The 40-render sweep covers the 18 HTML routes and two secret destinations at desktop and phone widths. The additional responsive sweep covers five public routes at seven widths.

## B. Initial visits

| Persona and starting state | What the simulated visitor did, expected and found |
|---|---|
| **Impatient Musician** · disposable creator, desktop and touch | “I brought an MP3 and a cover. I expect to leave with a link.” He filled the publishing form, uploaded real local media bytes through the fixture adapter, opened the release on the profile, and shared it into a post. The selected recording survived that handoff, and another fixture account could discover the music. The upload offered stage feedback. Release names group recordings; he found no standalone album publishing flow or published-track metadata editor. |
| **Internet Archaeologist** · public visitor and signed-in reader | “The cat print on the front door is a better introduction than an About Us paragraph.” He went from the landing artwork to the character gallery, artist pages, member profiles and recordings. He could distinguish LLiosette's page from the community catalogue and open the original CatsSaga artwork. The limitation he noticed was content density on a quiet fixture database. Nobody populated the public site to make it look busy. |
| **Confused Grandpa** · fresh browser context, no account | “Play played the song. Back brought me back. Then I opened something to read and the whole page said try again.” Using visible link and button names, his journeys covered Home, Play, Articles, the keyboard menu and Back/Forward. Normal navigation and playback worked at narrow widths. With just the vote-count request interrupted, the reading goal failed at the article itself. |
| **Professional Hater** · three disposable roles plus guest | “The tests were green. I kept the old draft around anyway.” He challenged privacy boundaries in the local role tests, followed a reply notification, and exercised invalid inputs and empty states. The database kept the writers out of one another's drafts. But after reloading an unfinished draft, typing a replacement and saving it, he counted **one** stale Restore button. He also reproduced the public-article outage. |
| **Obsessed Music Listener** · guest and member | “Show me the playhead, not the little triangle.” The same audio element advanced **65.73 seconds** through 32 throttled navigations. The trace had zero pauses, seeks, errors, stalls, empties or new loads during those navigations. Separate tests exercised queue order, removal, shuffle, automatic progression, favorites, touch dial, Back and Forward. The pitch test analysed a generated test signal in the local player; it never entered the catalogue. |
| **Broke Computer Guy** · 768-pixel window, guest | “Leave the cats alone until you can tell me what they're costing.” With 4× CPU throttling and network emulation, the renderer spent **8.40 seconds** on tasks in a **65.69-second** navigation interval. JS heap went from 17 to 13 MiB across the two samples. The orbit paused offscreen; system reduced motion and the site's own effect setting worked. These observations support keeping the artwork, but they are no substitute for his actual laptop. |
| **Perfectionist Artist** · profile owner, second account and public view | “I picked that ink and that border separately. Please check both after I hit Save.” She previewed uploads, changed bio, link, background, text and border colors, saved, reopened, checked the public profile, then cleared optional settings. The suite compared computed colors, rejected an unreadable light ink and an invalid PNG, and denied a second account's write. Her original image was still an image after the round trip. |
| **Silent Visitor** · fresh signed-out contexts | “I don't want an account just to find out whether I like the music.” Public tracks, profiles and character pages let this visitor browse. Posts, inbox, community chat and writing showed their existing account boundaries. A healthy article opened without signup. The vote outage still made that article unreadable, even for someone who had no intention of voting. |
| **Greg** · guest homepage, guest article, member editor, phone and desktop | **STAYS** on the front page; **LEAVES** the saved editor. “The cat art gets a whole front door. Good. Down here it says ‘Draft saved’ and then ‘Saved’ directly underneath. I believed you the first time.” His objection is visible in the baseline screenshot. It required no new font, frame, mascot, label or theme to fix. |

## C. Consolidated issue tracker

| ID · class · affected visitors | Reproduction and evidence | Cause, authorized correction and regression |
|---|---|---|
| **MC-01 · High** · Grandpa, Hater, Silent Visitor | Open an existing published article as a guest. Let its row and author load, then return a normal service error from the vote-count RPC. Expected readable prose. Actual result was a page-level error with no prose. [Before](baseline/article-outage.jpg) | Vote hydration threw into the outer page handler. Isolated the ancillary failure in the shared reaction renderer; articles and discussions can render without vote controls. Empty ID batches no longer request counts. Tested forced outage and healthy voting separately. **Fixed.** |
| **MC-02 · Medium** · Hater, writers | Type a title, reload, leave the recovery offer untouched, type different text and save. The previous Restore control survived a successful save and still referred to the old snapshot. [Baseline observations](baseline/observations.json) | The successful-save path cleared storage but left the control mounted. Retire that control when the save succeeds; retain normal recovery for unfinished writing. The browser regression counts stale controls after the replacement save. **Fixed.** |
| **MC-03 · Low** · Greg, writers | Save a draft. Two adjacent status areas announced completion; the older success link could also remain visible during subsequent edits. [Before](baseline/editor-saved.jpg) | Two feedback paths reported the same result. Keep the existing success message and article link; clear obsolete success feedback on further edits. Verified visually and through the published/draft workflow. **Fixed.** |
| **MC-04 · Medium** · Hater, Grandpa, Archaeologist | Seed two articles. Interrupt the second author's lookup, then click the displayed retry button. Chrome rendered titles **2, 2, 1**. Expected **2, 1**. [Failure](round1-chrome/engines.json) | The first card was already visible while pagination still pointed to the start of the failed page. Assemble a page offscreen, append it only when complete and restore the normal Load more label on success. Two-row retry verified across all three engines. **Fixed.** |
| **QA-01 · Environment** · Listener, Hater | Firefox timed out during sandboxed startup. WebKit audio failed in the sandbox; plain HTML with the same MP3 also failed there. The initial intercepted-media test was unreliable outside it. | Firefox passed with the local runner outside the filesystem sandbox. For WebKit, a real missing loopback URL followed by a real playable loopback URL tested the player without relying on interception of native media. The successful bare-player control and full journey are distinct checks. **Harness corrected.** |
| **QA-02 · Environment** · Musician, Artist, Hater | Fixture SDKs simulate authentication and storage. Real confirmation mail, CDN failures, production Realtime and hosted storage cleanup cannot be certified by this setup. | Remains explicitly **unverified**. No production tests, private-account access or migrations were used to close it. |
| **OWN-01 · Feature proposal** · Musician | Editor for an already-published recording and a separate album publishing flow are absent. A release name is supported. | Owner decision. Neither feature was implemented or counted as a broken existing workflow. |

## D. Iterations

1. **Baseline.** All nine journeys used the starting revision before application edits. The existing suite passed; the supplemental run failed MC-01 and MC-02. Greg recorded MC-03 on the saved-editor screen. The separate article and save scenarios had independent causes.
2. **First return.** Fixed MC-01 through MC-03. Repeated the full suite, public-route sweep, zoom, sustained navigation and screenshot review. The original failure scenarios passed. New work included invalid-media retry, gallery navigation using the keyboard and an interrupted article list. The two-row retry failed in Chrome, opening MC-04. Firefox launch and WebKit media produced unsuccessful attempts as recorded under QA-01. The initial cross-engine process overlapped the next patch; use the isolated first-round Chrome reproduction as the pre-fix evidence for MC-04.
3. **Second return.** Fixed MC-04 and repeated all nine journeys. Chrome's retry showed two distinct rows. The suite passed, including all 40 render checks. Fresh exploration separated a sandbox launch problem from application behavior. The unrestricted Firefox rerun passed its four checks. This round still had an outstanding WebKit test limitation.
4. **Third return.** No new application edits. All nine reran against the same fixed source. Compared denied versus successful MP3 decoding in bare WebKit. Replaced the intercepted failure with an actual loopback 404. The corrected cross-engine matrix passed. Added real 200% Chromium tab zoom and independent recovery/duplicate-action checks. Greg reinspected the article and editor.
5. **Fourth return.** Repeated the full suite, all nine journeys, the slow-device measurement, and the corrected cross-engine checks. The two final corrected matrices and the repeated Chrome suites found no new significant application fault. The longer listening run is reported independently below.

## E. Before-and-after evidence

- Guest article during a vote service outage, same route, viewport and disposable content. [Before](baseline/article-outage.jpg) · [After](round1/article-outage.jpg)
- Successful draft save on a phone-sized viewport. The success link remains; the second “Saved” line is gone. [Before](baseline/editor-saved.jpg) · [After](round1/editor-saved.jpg)
- Original identity and final homepage, each at 768 pixels. The randomized approved splash and animation phase may differ. [Baseline](baseline/home.jpg) · [Final](round4/home.jpg)
- Native Chromium tab zoom returned **2.0** at a 1280-pixel viewport. Home, Articles, Music, Characters and Account each reflowed to a 640-CSS-pixel viewport with zero horizontal overflow. This is separate from the CSS zoom stress in the per-round runner. [Native zoom evidence](native-zoom.log)

## F. Performance and playback

The controlled loop alternates Home and Articles while the real MP3 plays. Network settings request 80 ms latency, 300,000 bytes/sec download and 125,000 bytes/sec upload; the fixture database and intercepted SDK paths bypass a real WAN. CPU is throttled 4×. Navigation time includes waiting for the destination's first content row. Runs shared the machine with other tests and browser startup. These are observations, not a speedup claim.

| Run | Journeys | Median navigation, ms | Requests | Renderer task seconds / elapsed seconds | JS heap start → end, MiB | Audio seconds advanced |
|---|---:|---:|---:|---:|---:|---:|
| baseline | 32 | 1404 | 487 | 8.40 / 65.69 | 17 to 13 | 65.73 |
| round1 | 32 | 1416 | 487 | 9.69 / 65.39 | 26 to 13 | 65.44 |
| round2 | 33 | 1040 | 498 | 9.60 / 66.25 | 12 to 13 | 66.30 |
| round3 | 32 | 1419 | 486 | 10.25 / 65.61 | 12 to 14 | 65.67 |
| round4 | 32 | 1407 | 486 | 10.69 / 65.81 | 13 to 13 | 65.86 |

No 65-second run logged an unexpected load, seek, pause, stall or error. After explicit garbage collection, baseline and final snapshots each had six documents, 858 nodes and 126 event listeners. Intermediate counts varied with the active frame. Endpoint samples do not establish a universal absence of leaks. The recurrent media test measured approximately 439.45 Hz at 1× and 222.66 Hz at 0.5×. All five public routes fit at each of 320, 360, 390, 768, 1024, 1280 and 1920 pixels in the targeted Chrome sweep.

Raw comparative measurements: [baseline](baseline/observations.json), [first](round1/observations.json), [second](round2/observations.json), [third](round3/observations.json), [fourth](round4/observations.json).

## G. Regression results and reproduction

| Test group | What actually ran | Result |
|---|---|---|
| Database | Existing migration, role, social and editorial policy suites in PGlite. Author-only writes, private messages, blocked actors, unpublished articles, vote uniqueness, featured moderation and image references. | Passed in the baseline and each of four return suites. |
| Community | Existing browser workflows, member journeys, editorial interactions and Humanization checks. Includes mock signup/login, MP3 and artwork publishing, visible release/credits, post sharing, profile editing, comment/reply notifications, rejecting invalid media, stale revisions, queue sequencing and pitch analysis. | Passed on each complete suite run. |
| Homepage | Drift, orbit, navigation labels, family visit and route review. Includes reduced effects, OS reduced motion, offscreen pause, link targets, keyboard and touch, browser history and internal Back. | All five suites ended with 40 rendered page/viewport combinations, zero reported overflow, zero reported page errors. |
| Additional focused | Deny only vote counts; save over a pending recovery prompt; inspect actual navigation destinations; measure 35 route/width combinations, CSS zoom, slowdown and media events. | Two failures at baseline, all pass in each return. Broken-link sweep checks rendered same-origin destination paths on disk. It does not certify external sites, fragments or case-sensitive hosting. |
| Cross-engine | Menu and character navigation, published article reading, reduced motion, invalid MP3 rejection with retry available, failed-audio recovery, and an interrupted paginated article list. | Final two corrected matrices each passed 12/12 checks. [First confirmation](verified-engines/engines.json) · [Second confirmation](round4/engines.json) |
| Further exploration | Signed out between composing and publishing a local article. Activated Publish track twice synchronously. | Failed save retained the title and inserted zero articles. Two activations inserted one recording. |
| Desktop zoom | Temporary Chromium profile; browser tab zoom explicitly set and read back via a local test extension. | Five routes at 200% passed the width check. |
| Extended listening | Real bundled MP3, queued fixture tracks, timed sampling, normal player navigation, automatic progression. | See the five-minute result below. |

**Run from the repository root.** Install the locked dependencies with `npm ci`. The main suite expects installed Chrome. For the extended tests, install the Playwright engines with `npx playwright install firefox webkit`. Then run `npm test` and `npm run test:stress`. They use loopback and disposable fixtures; no Supabase CLI login is required. The standard suite writes historical QA capture paths, so use a disposable checkout when those captures need preserving.

For comparable evidence in a named folder, run `node _qa/nine/stress.cjs my-round` and `node _qa/nine/engines.cjs my-round`. To run only the longer queue test, use `node _qa/nine/soak.cjs`. Firefox and WebKit on this Windows machine required the normal local browser runtime outside the filesystem sandbox for full playback testing. Default listening durations are 65 and 300 seconds respectively. A failed check gives a nonzero exit code. Keep current result directories distinct from the reference captures.

## H. Final return visits

1. **Musician.** “I gave it a file named MP3 that wasn't music. It told me exactly that, kept the title and let me try again. Then I hit Publish twice; you still owe me only one track.” The released recording was visible and shareable through the existing profile/post flow. No upload-progress percentage or existing-track editor was found. He can finish the publishing task, and he would still like an editing decision from the owner.
2. **Archaeologist.** “I followed a recording back to a person, found their release name and went looking through the cats. The list no longer grows an extra copy of an article because the network sneezed.” The two-row retry and artist/profile discovery support the functional part of that judgment. The preference for the page's character art is his own.
3. **Grandpa.** “That time the story was actually there. I could read the heading, go home and keep the music.” In the repeated vote outage he could read the title and prose. The normal journey also opened Characters from the keyboard, returned to Articles and opened a real fixture article in three engines. A simulated journey cannot measure whether an unprompted human would find the menu equally easily.
4. **Hater.** “I still have the receipt for the time two articles became three.” On the final retry the receipt now reads exactly two unique titles. His obsolete restore button disappeared after the successful replacement save. Expiring the local identity before Publish denied the write and kept the title. He found no further significant failure in those repeated scenarios.
5. **Listener.** “A navigation click doesn't earn the right to touch the needle.” The traces support him on Home, Articles, internal Back, browser Back and Forward. The dial moved the measured pitch; a failed real audio URL also recovered on the next valid selection in each engine. He wanted the longer queue run counted separately from the short history tests, and it is.
6. **Broke Computer Guy.** “I checked the heap after the party. Same six documents. Same 126 listeners. Good enough to leave the cats where they are.” The two comparable post-collection endpoints support that specific observation. Median navigation varied between runs, so he claims no performance win from the bug fixes. Physical low-end hardware still has the last word.
7. **Artist.** “My border stayed my border on somebody else's screen.” The visible profile retained the tested biography ink, border color and background; the signed-out profile rendered after saving. Invalid images and unreadable choices produced feedback, and another account could not alter the profile. She has no new theme request.
8. **Silent Visitor.** “I got to the story, the track and the character page without negotiating with a login box.” The failed vote request now leaves a public article readable, while writing, private messages, chat and member discussions retain their existing requirements. This visitor did not need an exception to the privacy rules.
9. **Greg.** **STAYS.** “One save message. The same cream paper under the article. Cats still out front. I'm going back to the music.” He inspected the changed editor and failed-vote article in the first return, the retry result in later returns, and the last homepage capture. The mock article text is explicitly disposable QA content. His judgment covers the screens reviewed; it does not speak for actual visitors.

## I. Victory conditions

| Persona | Baseline | Final | Evidence or remaining objection |
|---|---|---|---|
| Musician | PASS | PASS | Existing publish/discover/share path. Real mailbox and hosted storage remain unverified. |
| Archaeologist | PASS | PASS | Discovery worked; perceived individuality is subjective. |
| Grandpa | FAIL | PASS | Public reading recovered under the original outage. Native zoom and normal navigation passed. |
| Hater | FAIL | PASS | Previously reproducible stale recovery and duplicate rows resolved. Verdict limited to exercised scenarios. |
| Listener | PASS | PASS | Media time, pitch, event traces, recovery and queue checks; physical devices untested. |
| Broke Computer Guy | PASS | PASS | Emulated slowdown, layout, memory samples and reduced motion. Physical-old-laptop claim remains **BLOCKED**. |
| Artist | PASS | PASS | Local customization, persistence, readability, public view and ownership tests. |
| Silent Visitor | FAIL | PASS | Anonymous reading works under vote-service failure; private actions remain account-only. |
| Greg | LEAVES | STAYS | Subjective binary assessment; duplicate completion message removed. |

## J. Owner decisions

The musician would use an existing-track editor and dedicated album publishing. Both are proposals, not authorized bug fixes. No other creative change was needed to close the measured failures. Original artwork, character names, splash messages, typography, effects, music and widget colors remain the owner's.

## K. Limits

These are simulated task journeys, not recruitment or observation of nine real people. Browser-engine tests on Windows do not establish behavior on an iPhone, Android handset, actual Safari, a physical low-end laptop or assistive technology. The seven-width sweep was Chrome; the other engines got focused journeys. Signed-out posts follow the existing member-only design. The tests did not verify real transactional email, live network subscription delivery, production auth expiry timing, browser-background behavior on a mobile OS, remote storage durability, or an hours-long playback soak. The historical freeze/resume test reports that headless Chrome did not deliver a hidden visibility event in that scenario. Resource results describe this machine, these fixtures, and these intervals.

## L. Deployment status

All work is local. Application edits are confined to article rendering, save feedback and list retries in `js/articles.js`, and optional vote loading in `js/social.js`. New permanent QA scripts, an npm command, evidence and this report are included. There were no changes to SQL, auth settings, artwork, CSS or production data. No push, deployment, or production migration was performed.

### Five-minute listening result

The independent soak advanced **303.06 seconds of audio in 303.21 wall seconds** across **62 navigation samples**. All samples observed the original audio element playing. There were two natural ends at 104.10 seconds, each followed by the expected source change and next-track load. No seek, stall, error, or extra pause/load cycle was recorded. This distinguishes expected queue progression from a navigation interruption. [Full event trace and samples](soak.json)
