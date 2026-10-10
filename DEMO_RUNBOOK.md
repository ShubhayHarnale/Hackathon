# Witness demo runbook

Use synthetic participants and a pen-shaped prop only. No real medication or patient data.

## Local setup

1. Install dependencies with `npm ci` (Node 22 LTS recommended).
2. Copy `.env.example` to `.env.local` if needed. For a repeatable, keyless rehearsal use
   `PERSISTENCE=memory`, `VISION_PROVIDER=mock`, `PROTOCOL_COMPILER=mock`, `NOTIFIER=mock`,
   and `NEXT_PUBLIC_VOICE_PROVIDER=browser`.
3. Run `npm run dev`, then open `/demo` and `/coordinator` in separate tabs.

The default scripted demo asks for no camera or microphone permissions. It speaks prompts
when browser speech synthesis is available; tap Done for spoken-confirmation steps. A new
launch creates a fresh session. Existing session links cannot restart an already-recorded run.
The coordinator dashboard requires the configured passcode if `COORDINATOR_PASSCODE` is set.

## Suggested presentation (about 4 minutes)

1. Explain: Witness guides a synthetic trial procedure one step at a time and records what
   could be verified. The study team makes decisions when something cannot be verified.
2. Open `/demo`. Choose Ruth, mock autoinjector, scripted source, and Everything goes right.
   Start, complete the short simulated practice, then Start my procedure.
3. Tap Done for the label and expiry checks. Show Pause/Continue and Repeat. Let the hold
   finish while frames keep arriving. The session ends with All done.
4. Open its coordinator record. Show the ordered steps, timestamps, evidence thumbnails,
   and raw event log. Scripted evidence is visibly labeled as a demo frame.
5. Launch a new demo with **Skips the first critical step**. After the two Done buttons, it
   stops at the cleaning step. Show the critical flag and evidence.
6. Show **Escalation alerts**: simulated study-team delivery plus Ruth's consented trusted
   contact. Review an alert. This records a review; it does not change the procedure history.

Say explicitly: **No texts or calls are sent.** The Call my nurse link opens the phone dialer;
the demo number is fictional. A voice request pauses and asks the user to tap the call link.

## Additional demonstrations

| Scenario        | Expected result                                                                                                                                                      |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Flicker         | Isolated bad frames do not confirm a step or trigger a critical skip.                                                                                                |
| Poor camera     | Fixed correction messages, followed by recovery.                                                                                                                     |
| Early release   | Stops during the critical hold and records escalation.                                                                                                               |
| No response     | After practice, the first procedure step times out after 15 seconds; a `no_response` alert is recorded. This shortened limit applies only to this scripted scenario. |
| Outage          | Vision failures cause a pause, then a needs-human stop after 30 seconds. Do not press Continue during this demonstration.                                            |
| Contact consent | Repeat a critical-stop demo with Walter or June. Only the study team receives a simulated alert.                                                                     |

Real procedure step timeout remains 240 seconds plus any step timer. No-response is based
on a running step reaching that limit. There is **no unattended/background no-response
monitor** for closed pages, sleeping phones, or indefinite user pauses.

## Recorded video replay

Select Recorded video in `/demo` or create a replay link in the coordinator dashboard.
Choose a local MP4/WebM supported by the browser and tap Start replay. Replay skips practice:
the recording must begin with the first procedure step. The video is muted and never uploaded
as a whole; sampled JPEGs go through the server vision route and selected evidence is stored.

Use a synthetic prop recording with generous time on each step. Tap Done for verbal steps.
Pause freezes playback and the engine; Continue resumes both. Ending the recording before
completion stops the session. An unreadable/frozen source cannot finish a hold from a timer
alone. Rehearse the exact recording in the target browser before presenting.

- With `VISION_PROVIDER=mock`, the server simulates visual matches regardless of video content.
- With `VISION_PROVIDER=gemini`, frames are actually classified. A Gemini key and connectivity
  are required; record and label a representative take before making accuracy claims.
- Video files and extracted frames stay out of Git. The browser test generates a synthetic
  moving-pattern recording to verify playback and persistence; it is not a clinical/vision eval.

## Supabase and deployment

The selected host is Netlify. Follow [NETLIFY_SETUP.md](NETLIFY_SETUP.md) for account,
migration, environment-variable and deployment steps.

1. Apply **both** files in `supabase/migrations/`, in filename order. The phase 7 migration
   adds alert delivery receipts and the atomic `append_session_events` RPC.
2. Set `PERSISTENCE=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`, then `npm run seed`.
3. Configure the same variables on the deployment and set a coordinator passcode.
4. Verify a fresh patient link, evidence upload, signed evidence URL, alert, and review.
   Confirm that the session survives an application restart. Hosted Supabase remains a
   deployment acceptance check; local SQL tests do not validate Supabase Storage/PostgREST.
5. Use HTTPS for live camera/microphone access on a phone. Use Supabase for shared persistence:
   the memory repository belongs to one process and is unsuitable for multi-instance hosting.

## Repeatable verification

```sh
npm test
npm run typecheck
npm run lint
npm run build
npx playwright install chromium
npm run test:e2e
```

The browser suite starts a production server on port 3107 with mock providers. Build with
`NEXT_PUBLIC_VOICE_PROVIDER=browser` before running it; public variables are fixed at build
time. Keep port 3107 free. If Chrome is already installed, use
`PLAYWRIGHT_CHANNEL=chrome npm run test:e2e` instead of downloading Chromium.

Database checks, on a disposable/local database after both migrations:

```sh
psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-phase7.sql
```

This SQL script rolls its synthetic data back. Browser artifacts go to ignored
`test-results/`; failing runs retain a trace. See [ACCESSIBILITY.md](ACCESSIBILITY.md) for
the automated coverage and remaining physical-device checks.

## Troubleshooting

- **No session or invalid link after restarting:** memory data was lost. Launch a new demo
  or use Supabase. Never restart a real procedure just to repair a link.
- **Already started:** return to the original patient tab; otherwise request a new study-team
  link. Rehydrating an interrupted procedure is intentionally not implemented.
- **Evidence/alerts missing:** inspect the event request and server logs. Failed delivery
  retains a record and retries through the event outbox while the page stays open.
- **Supabase says function/column missing:** apply the phase 7 migration before running this code.
- **Replay stops early:** use a longer recording, check codec support, and allow enough time
  for three observations and verbal confirmations. Start a fresh replay session.
- **Turbopack repeats an old sandbox port failure instantly:** stop the build, preserve/remove
  the build cache `.next/cache`, then retry in an environment that permits local worker ports.
  Do not remove a running dev server's `.next/dev` directory.
