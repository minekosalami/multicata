# mCata Radio release review

**Catalog rotation, November 25, 2026.** All 32 catalog songs are eligible for rotation. New uploads enter rotation when published. The 28 existing WAV recordings have 128 kbps MP3 playback copies for radio. Their combined size is 71,307,300 bytes, compared with 843,862,522 bytes for the original WAVs. Profiles use the uploaded originals. New songs stream their original until a smaller copy is available.

## Who can do what

| Visitor | Capabilities |
| --- | --- |
| Guest | Read the public station, history, schedule and vote counts. Tune in and adjust personal audio settings. |
| Signed-in member | The same public access, plus favorites and one changeable vote per round. |
| @lliosette | Approve catalog music, manage the station, record and upload announcements, schedule shows and edit the queue. |

The database checks the verified account UUID from MultiCata’s existing article-moderation migration **and** its current moderator grant. Changing a display name or assigning article moderation to another member cannot transfer radio control. Removing the grant closes access to subsequent management operations. The radio migration adds no members to article moderation.

Public clients get a sanitized JSON station snapshot. Private station tables are behind a separate schema. The only public Realtime table contains a revision number, has row-level security and grants clients read access. Every management operation checks the caller, serializes against other station operations and records the account, time, action and arguments. Anonymous callers can cause an elapsed transition to be materialized through the public state read. Its timestamp and choice are determined by the database.

Announcement uploads have a dedicated bucket, owner-only insert policy, path restrictions, MIME allowlist and 50 MiB storage limit. The Edge Function validates the authenticated caller, the radio grant, the object path and bytes fetched from storage. Registration also checks that the object exists and has been verified. The service credential stays in the function environment. The byte check identifies container signatures. Browser metadata supplies the duration and the compatibility preview. Full server-side decoding and moderation of audio content are outside this implementation.

## Broadcast clock and operating decisions

PostgreSQL stores the start and end of each broadcast. Its clock advances at actual item boundaries, even if a timer wakes late. A single advisory transaction lock and a locked station row serialize edits, votes and transitions. A minute-level Supabase Cron job maintains history while the website is closed. During playback, clients also request state at the next scheduled interruption or item end. A delayed job can reconstruct elapsed items, with a limit of 256 transitions per transaction. Subsequent clock ticks or public reads continue recovery.

The browser anchors the server timestamp to the midpoint of the request using a monotonic clock. It seeks on joining, changing broadcasts or returning with more than 1.25 seconds of drift. It calculates progress locally. Realtime invalidations are debounced. Connected receivers refresh at broadcast boundaries and at least once every five minutes. Without Realtime they poll once a minute. The idle homepage widget releases its subscription when it leaves the viewport.

- **Rotation and voting.** Automatic rounds choose up to four distinct approved recordings, favoring songs outside recent history. A vote is keyed by account and round. The most votes wins, and SQL selects randomly among ties. With no votes, rotation favors less recently played music. Revoking approval removes the song from ballots and pending queues while the current broadcast finishes.
- **Priority.** Play Now interrupts immediately. An exact-time event can interrupt a playing recording. After Song Ends becomes eligible at its scheduled time and waits for a boundary. At a shared boundary, due exact events precede due after-song events, followed by the ordered manual queue. Equal timestamps resolve by queue order and row ID. An exact event displaced by another event at the identical instant stays queued for the next boundary. History records shortened airtime when a broadcast is interrupted.
- **Interrupted votes.** A winning choice displaced by a queued or scheduled broadcast is held for the next available automatic selection. Switching to manual mode closes the ballot. Switching back opens a fresh eligible round. An empty manual queue falls back to approved rotation. An empty library produces an off-air state when there is nothing queued.
- **Media and recording.** The persistent host owns one radio audio element and one EQ graph on supporting browsers. Normal music pauses when radio starts. Playing normal music powers the radio down and preserves the normal queue. Stored settings affect the listener’s own gain and shelving filters. The Windows WebKit build used for QA lacks Web Audio, so it uses native volume and disables EQ. The UI validates upload headers, offers a local preview and shows duration before scheduling. Microphone access requires a click. Recording uses one-second chunks and requests 64 kbit/s where supported. The real 50 MiB upload ceiling governs the resulting file. An oversized recording can be saved locally for a smaller export.
- **Presence.** Observers subscribe without marking themselves as listeners. A persistent host tracks a random session key while audio is playing and untracks on buffering, power-off or end. Supabase expires disconnected sessions. The UI omits the count until presence synchronizes. A session count is distinct from a verified count of individual people.

## Observed local results

Tests used disposable PGlite data, the existing recording, test identities and separate browser contexts. Sample titles, votes and recorded test audio stayed in the fixtures. These are nine review perspectives based on test actions.

| Perspective | Observation |
| --- | --- |
| Regular listener | Two Chrome sessions joined at different times, with one client’s wall clock shifted two hours. Its audio joined about 38.7 seconds into the broadcast. Voting, changing votes, tie eligibility and one ballot per member passed. |
| Listener navigating | Audio advanced through Articles, Back and Forward. One radio element and one EQ context remained in the listening host. Power-off returned control to normal music playback. |
| Musician | Approval referenced an existing catalog ID and object. Removing approval kept the current item playing and removed future eligibility. The public page provided artwork, artist links and the existing favorite action. |
| Moderator recording | Chrome’s local test microphone produced a preview, then a replacement recording of about six seconds. The test also uploaded an existing MP3. An over-limit file retained a local save link and could not be submitted. Recorded announcement bytes played through the listener’s EQ graph. |
| Moderator scheduling | The control panel closed before an exact-time recording. An independent observer saw the recorded announcement and its stored start time matched the requested instant. Database tests also exercised Play Now, next-in-queue and after-song scheduling. |
| Owner | The verified account searched the catalog, approved a track and used the queue. Tests exercised both DJ modes, reordering, removal, a stale skip, and two competing skip requests targeting the same item. One skip succeeded. |
| Mobile visitor | Chrome rendered the receiver at 360 px and a throttled session at 320 px without horizontal overflow. Firefox and Windows WebKit played advancing audio in a 390 px viewport. These were simulated mobile sizes. |
| Unauthorized visitor | The guest control URL showed an access message. Guests, members and a second article moderator could not change station state. Removing the owner’s grant blocked access. The actual Edge handler rejected an expired identity, a different account path and a mismatched file header in local adapter tests. |
| Slower visitor | A Chrome run with 4× CPU throttling, 150 ms latency and 256 KiB/s downstream observed advancing audio 556 ms after pressing power on loopback. Buffering and reconnection were exercised locally. Actual mobile network behavior can differ. |

**Synchronization and resources.** In a 132.7-second run with one natural broadcast transition, the largest difference between the two audio positions across 26 periodic samples was 54 ms rounded up. The test also requested a 2.5-second Chrome lifecycle freeze and resume. The host issued three station reads during the timed interval. Its sampled JavaScript heap measured 9.42 MB at the start and 5.06 MB at the end. These are point samples, not a memory-leak or long-duration guarantee.

The home widget made zero audio requests before tuning in. Chrome reported two media requests and approximately 5.0 MB transferred by the instrumented listener across that longer journey, which included the switch back to normal music. In a separate shorter run, the local Realtime adapter recorded 15 presence calls and six station-change signals across the fixture clients. Those counts include fixture subscription setup. Production WebSocket message counts, billing and egress require measurement on the linked project.

**Unattended scheduling.** A simulated six-hour interval produced 182 contiguous history entries in the fixture, including an exact interruption and an after-end recording. A separate 48-hour horizon exercised bounded recovery over multiple calls. PGlite serializes requests on one engine. The competing-request tests verified consistent results locally. Independent Postgres sessions and a hosted Cron worker still need a staging run.

**Regression.** The existing database, community and homepage suites passed. They covered the 50 MiB music upload boundary, profile customization, favorites, likes, the slow dial, playback continuity, authentication fixtures, articles, featured moderation, posts, messaging and the homepage orbit. The route review rendered 44 page/viewport combinations with zero reported overflow or page errors.

[Desktop receiver](desktop.png) · [Mobile receiver](mobile.png) · [Homepage widget](widget.png) · [Control panel](control.png)

## Files and repeatable checks

- Public pages and styles are in `html/index.html`, `html/radio.html`, `html/radio-control.html` and `css/radio.css`.
- `js/player.js` integrates radio into the existing host. `js/radio-host.js`, `js/radio-view.js`, `js/radio-media.js` and `js/radio-control.js` implement transport, rendering, storage access and administration.
- `supabase/migrations/20261125000100_radio.sql` creates the station, policies, clock, audit trail and announcement bucket. `supabase/functions/radio-verify/index.ts` and `supabase/config.toml` configure announcement verification.
- `_qa/radio/station.cjs`, `verify.cjs` and `browser.cjs` cover the database, Edge handler and browser journeys. `_qa/next/bridge.cjs`, `package.json` and `.gitignore` expose the fixture identity, test command and evidence.

Run `npm test` and `npm run test:radio` with the project’s Node 24 environment, installed Chrome and Playwright Firefox/WebKit binaries. Set `RADIO_SOAK=128` to include the longer timed run. The browser suite uses a local presence/change adapter and the real SQL functions. Edge handler tests use local Auth and Range-response adapters.

## Supabase configuration and release

After owner approval, first use a staging Supabase project with the same migrations, Auth, Storage and Realtime configuration. The migration enables the available pg_cron extension and registers `mc-radio-clock`. The clock job should run as the database migration owner. If Cron is enabled later, register the job with the SQL below. Verify that the Realtime publication includes `public.radio_updates` and that the project accepts the public Presence channel. The application uses the existing project and requests no additional hosting service. [Supabase Cron](https://supabase.com/docs/guides/cron) · [Realtime Presence](https://supabase.com/docs/guides/realtime/presence) · [Storage file limits](https://supabase.com/docs/guides/storage/uploads/file-limits)

```sql
select cron.schedule('mc-radio-clock', '* * * * *', 'select mc_radio.tick()');
select jobname, schedule, active from cron.job where jobname = 'mc-radio-clock';
```

For the approved release, confirm the CLI project target and run the following from the repository root. Deploy the static pages through the existing GitHub Pages main branch after the backend is ready.

```powershell
npx supabase db push --remote --dry-run
npx supabase db push --remote
npx supabase functions deploy radio-verify
```

The function validates bearer sessions with Supabase Auth itself and requires the existing owner grant. It uses the standard hosted URL, anon key and server-only service-role environment variables. Verify CORS and range delivery on both audio buckets. Check a signed-out receiver, a second signed-in listener and the owner?s rotation controls. Confirm Cron history with every browser closed. An idle or suspended project cannot provide a hosting uptime guarantee. The clock reconstructs missed elapsed boundaries when service resumes.

**Future R2 move.** Preserve catalog IDs, object paths, artist associations and durations. Copy and validate the objects, configure range responses and CORS for the site, then change the URL/upload resolver in `radio-media.js` and the trusted verifier’s storage backend. The timeline, votes and favorites keep their IDs. No R2 account or paid service was activated.

**Still unverified.** Production multi-listener playback and Realtime disconnect expiry, physical phones and microphones, OS background suspension, multi-hour audio capture and real-world sync under sustained congestion require staging or device testing. The upload pipeline does not provide resumable multi-part uploads. Interrupted uploads can leave unregistered files for the owner to review in Storage.
