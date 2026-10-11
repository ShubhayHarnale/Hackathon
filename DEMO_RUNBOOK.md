# Witness demo runbook

The primary demo uses only hands and a phone or laptop camera. Use synthetic participants;
no medication, pen, labels, or other equipment is needed.

## Live teammate test

Open [Try Witness](https://witness-hackathon-shubhay.netlify.app/demo). Keep the default
**Hands-only camera demo**, choose a synthetic participant, then tap **Start live camera demo**.
The hosted site uses Gemini. There is no outcome selector in the live flow.

1. Prop up the device in good light, with both hands able to fit in the camera preview.
2. Tap **Start**, allow the camera and optionally the microphone. Buttons remain available
   if voice commands are unsupported. Browser speech reads the reviewed instructions.
3. For camera practice, show **one open hand** until practice completes.
4. Tap **Start my procedure**. Show **both open hands**, fingers spread and palms facing
   the camera. Keep them visible until Witness advances.
5. Give a **thumbs-up** with one hand; lower the other hand. Wait for confirmation.
6. Close that hand into a **fist**, with your thumb folded across your fingers. Keep it
   visible through the five-second verified hold until **All done** appears. Detection
   requires consecutive observations, so the total time can exceed five seconds.
7. Sign into the coordinator dashboard to see steps, timestamps and selected evidence.

For a mistake test, return to `/demo` and launch a **fresh** session. Complete the one-hand
practice. At the first real step, show a **thumbs-up instead of both open hands** and keep
it visible. If Gemini consistently recognizes the later gesture, the same product engine
stops for a critical miss and records evidence and simulated escalation. Do not choose a
scripted failure. If it does not recognize the gesture, record that as a test failure;
do not present simulated recognition as a real result.

To film for the judges, record the screen and visible hand gestures during both runs,
including the stop message and corresponding coordinator record. Use a second device to
film, or screen recording if available; recording is optional for trying the app. Keep
clips and extracted frames outside Git under ignored `eval/`.

The demo shares the real patient camera, Gemini, voice, engine, persistence and review
flow. The procedure is synthetic. **No texts or automatic calls are sent**, and the demo
nurse number is fictional. Physical recognition accuracy and clinical use are not validated.

## Local setup and developer rehearsal

1. Install dependencies with `npm ci` (Node 22 LTS recommended).
2. Configure `.env.local` for Gemini and Supabase, or use the keyless mock providers for
   development. Mock camera checks are explicitly identified on the launcher.
3. Run `npm run dev`, then open `/demo` and `/coordinator` in separate tabs.

Live camera is the default for both `/demo` and `/s/demo`. Each visit creates a fresh session.
Existing patient links cannot restart an already-recorded run. The dashboard requires the
configured coordinator passcode.

Open **Developer test tools** for recorded replay or scripted regression scenarios.
Scripted tests ask for no camera/microphone access and do not test Gemini recognition.
The older prop procedures remain available for broader rehearsals; they require their
listed materials and pen practice. For the autoinjector scenario, tap Done for the label
and expiry checks, then inspect evidence and simulated alerts in the dashboard.

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

Open Developer test tools and select Recorded video in `/demo` or create a replay link in the coordinator dashboard.
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

1. Apply **all** files in `supabase/migrations/`, in filename order. The phase 7 migration
   adds alert delivery receipts and the atomic `append_session_events` RPC.
2. Set `PERSISTENCE=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`, then `npm run seed`.
3. Configure the same variables on the deployment and set a coordinator passcode.
4. Verify a fresh patient link, evidence upload, signed evidence URL, alert, and review.
   Confirm that the session survives an application restart. Hosted Supabase checks have passed; local SQL tests alone do not validate
   Supabase Storage/PostgREST.
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

Database checks, on a disposable/local database after all migrations:

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
