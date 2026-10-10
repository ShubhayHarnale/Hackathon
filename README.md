# Witness

**A camera-and-voice coach for at-home clinical trial procedures, with a time-stamped record for the study team.**

A trial participant props up their phone and performs a procedure in view of the camera. Witness checks each step, coaches by voice one step at a time, and records when each step happened, with an evidence frame. When something goes wrong it stops and routes the participant to their study nurse.

> **Hackathon project. Synthetic data only. No real patient data, no PHI.**
> The demo procedure is a **mock autoinjector** (a pen used as a prop). It is **not medical guidance.**

## Product principles

- **The app flags and records. A human makes every medical decision.**
- No dosing advice, ever. When the app is unsure, it **stops and routes to a human**. It never tells the patient to carry on.
- **The patient never hears model-generated text.** Vision returns issue _codes_ from a fixed list, and voice only speaks scripts the app wrote.
- Built for older adults who may live alone:
  - no install
  - one step on screen at a time
  - large text and high contrast
  - voice-first, with a button for every voice command

## Why build this

At-home procedures in decentralized trials are a blind spot: the sponsor can't see whether a self-injection was done correctly, so deviations from the protocol show up late or never. Sponsors already pay for AI video checks of whether participants take their medication. Witness adds **real-time, step-by-step coaching** and an **audit trail**, compiled from any protocol text.

As a product it would need clinical validation, IRB approval, HIPAA compliance, and FDA device-software review (see [PRODUCTION_ROADMAP.md](PRODUCTION_ROADMAP.md)). The pitch is **verification plus an audit trail**, not "an AI nurse."

## Architecture

| Module             | Responsibility                                                                                                                                           |
| ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/engine/`      | Pure TypeScript step state machine. No I/O, fully unit tested. **The single source of truth.**                                                           |
| `src/protocol/`    | Compiles plain-text instructions into validated steps with Gemini structured output and Zod; the coordinator reviews and edits before publishing.        |
| `src/vision/`      | `VisionProvider` (Gemini + scripted mock). About 1 frame/sec from the camera or a replayed video.                                                        |
| `src/voice/`       | `VoiceProvider` (browser speech by default, Gemini Live as a stretch goal) and the `VoiceCoach`. Commands: pause, continue, repeat, call my nurse, done. |
| `src/escalation/`  | `NotifierProvider` with persisted mock delivery receipts, consent-aware escalation, and coordinator review.                                              |
| `src/persistence/` | `Repository` (in-memory + Supabase).                                                                                                                     |
| `src/app/`         | Patient flow `/s/[token]` (mobile), coordinator dashboard `/coordinator` (desktop), API routes.                                                          |

Every provider has a mock and is selected by an env flag. **The app runs with no API keys.**

## Key design decisions

- **Confirming a step:** a step is confirmed only after **3 consecutive matching frames** above a confidence threshold. Skip detection uses the same 3-frame rule, so one bad frame can't stop someone's procedure.
- **Critical miss:** if a later step is seen while a critical step is still unconfirmed, the app emits `critical_miss` and stops. The prompt shows the vision model the current step plus a few steps ahead, so skips can be detected.
- **Verification type:** each step is checked by camera (`visual`), by spoken or tapped confirmation (`verbal`, e.g. "read the label aloud"), or both.
- **Hold steps** ("press and hold 10 s"): the timer runs only while the step is still visible. Releasing early on a critical step is a critical miss.
- **Pausing:** pause freezes every timer, and only an explicit "continue" resumes.
- **needs_human:** emitted after too many unmatched frames, interrupted holds, or a vision outage.
- **Ordering and latency:** frames are numbered and only one is in flight at a time. Stale results are dropped, and the server times out Gemini after 4 s.
- **Security:** patients reach the app through an unguessable session link. All database access is server-side, and RLS denies everything by default. Step events are append-only. Evidence frames go in a private bucket behind signed URLs.
- **Gemini:**
  - Models: `gemini-3.8-flash` for compiling, `gemini-3.5-flash-lite` for per-frame vision (measured ~0.8 s per frame vs 7–20 s or 503 "high demand" for 3.8 Flash), `gemini-3.8-live` for voice. Model IDs come from env vars.
  - Calls go through the Interactions API with `store: false`.
  - Gemini Live connects from the browser with short-lived ephemeral tokens.

## Step engine (`src/engine/`, Phase 1)

A pure function `transition(state, input, config) → { state, events }`. It performs no I/O and never reads a clock: every input carries its own `at` timestamp. Lint rules enforce this. `EngineRunner` wraps the function and fans events out to the UI, voice and logging.

- **Inputs:** `start_practice`, `start`, `frame`, `frame_error`, `verbal_confirm`, `pause`, `resume`, `call_nurse`, `tick`, `stop`
- **States:** `idle → practice → idle → active ⇄ paused → completed | stopped(reason)`
- **Events:**
  - Progress: `step_activated`, `step_observed`, `step_confirmed` (records how the step was confirmed and which frame is the evidence)
  - Coaching and review: `correction`, `hold_interrupted`, `step_missed`, `flagged`
  - Pausing and the nurse: `paused`, `resumed`, `nurse_called`
  - Vision status: `vision_degraded`, `vision_recovered`
  - Stops: `critical_miss`, `needs_human`, `completed`, `stopped`
  - Every event carries an `eventSeq`, so it can be saved exactly once.

| Rule                                                                                                                                                                                        | Default  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| A step counts as seen after N consecutive matching frames with confidence ≥ 0.7                                                                                                             | 3        |
| A later step seen N frames in a row is a skip. Skipping a critical step stops with `critical_miss`; skipped non-critical steps are flagged and the app follows the patient                  | 3        |
| **Hold** (visual step + timer): the timer runs only while the step stays visible. Releasing early on a critical hold is a `critical_miss`. Losing sight of it for 3 frames is `needs_human` | 3 frames |
| **Wait** (verbal step + timer): counted from when the step starts; also needs the spoken or tapped confirmation                                                                             | –        |
| `needs_human` after this many frames on one step that don't show it                                                                                                                         | 25       |
| `needs_human` after this many interrupted holds (non-critical steps)                                                                                                                        | 3        |
| `needs_human` after this much active time on one step (plus the step's own timer)                                                                                                           | 240 s    |
| Vision errors in a row before a system pause                                                                                                                                                | 5        |
| Vision outage before `needs_human`                                                                                                                                                          | 30 s     |

- **Pausing:** every timer freezes. Frames and ticks during a pause are ignored. **Only an explicit `resume` leaves a pause.** The engine never continues on its own.
- **Stale and in-flight frames** (an older `seq`, or captured before the step started or before the resume) are dropped.
- `stopped` and `completed` are terminal and ignore all further input.

**Tests:**

- 40 scenario tests, covering flicker, a skipped critical step, holds, pause and resume, every `needs_human` trigger, verbal and wait steps, practice mode and purity.
- Property-based tests (fast-check) that run 1,000 random input sequences per test run. They check that:
  - a critical step is never silently skipped
  - completing the procedure means every critical step was confirmed
  - steps resolve in order
  - only `resume` leaves a pause
  - terminal states never change

## Protocol compiler (`src/protocol/`, Phase 2)

Turns pasted procedure text into reviewed, versioned steps. **The compiler drafts; the study team decides.** Nothing is published automatically.

1. **Compile** (`POST /api/protocols/compile`):
   - `PROTOCOL_COMPILER=gemini` uses Gemini structured output: the Interactions API, `store: false`, and a JSON schema generated from Zod. The system prompt forbids adding dosing advice or reordering actions.
   - `mock` (the default) splits numbered lines and understands `(critical)` and "N seconds" markers.
2. **Repair:**
   - Deterministic first: fix ids, renumbering, casing, whitespace and timer ranges. It never invents missing text.
   - Then exactly **one** repair round-trip that sends the Zod errors back to Gemini. If that also fails, the coordinator sees the error and the raw output.
3. **Lint** (non-blocking warnings):
   - dose or amount language
   - more than one action in a step
   - over-long on-screen text
   - no critical step
4. **Review** at `/coordinator/protocols/new`: edit, reorder, add or remove steps, and set critical, how a step is confirmed, and timers. The page re-validates live.
5. **Save and publish:** saving creates a draft. Publishing is an explicit button. Published versions are immutable: editing one creates a new version, and new sessions use the latest published version.

**Seeded demo protocols** live in `src/demo/protocols/*.json` (mock autoinjector, nasal spray, inhaler) along with synthetic participants. They are validated at load time.

**Coordinator access:** if `COORDINATOR_PASSCODE` is set, `/coordinator` and its APIs require a sign-in (an httpOnly cookie holding a hash) via `src/proxy.ts`. If it's unset, the dashboard is open for local demos.

**Persistence:** `PERSISTENCE=memory` (the default) is an in-memory repository with the same rules Supabase will enforce: append-only, idempotent step events and immutable published protocols. Session links store only a SHA-256 hash of the token.

## Vision (`src/vision/`, Phase 3)

```
<video> (camera or replayed file) → canvas → JPEG ≤640px q0.7 → VisionLoop (~1 fps, single-flight, numbered frames)
  → VisionProvider → FrameResult { observedStepId | null, confidence, issue?, handsVisible? } → engine
```

- **Providers:**
  - `gemini` (server-only): Interactions API, `store: false`, low image resolution, `thinking_level: "low"` (3.8 Flash rejects `"minimal"`), temperature 0, a 4 s timeout, and structured output whose step ids are restricted to the candidates or `"none"`.
  - `mock`: always sees the current step.
  - **Scripted scenarios** (browser-side, no camera or key needed): `happy`, `flicker`, `poor-camera`, `skip-critical`, `early-release`, `no-response` and `outage`.
- **What the model is asked:** the current step plus the next 3 steps, so skips are visible. It only classifies frames: it picks an id and an issue code from a fixed list, and never writes text for the patient.
- **API route** (`POST /api/vision/check`):
  - Validates requests with Zod.
  - With a configured coordinator passcode, requires a patient session token or coordinator
    cookie. Patient step text comes from the stored protocol, not the request's supplied text.
  - Rate-limits each session with a token bucket (burst of 4, refilling 2 per second; in-memory, per server instance).
  - Errors come back as typed kinds (`timeout` 504, `rate_limited` 429, `provider` 502). The client turns them into `frame_error`, so the engine pauses and then routes to a human, and never guesses.
- **Client:** the browser times out a request after 6 s. Only one check is in flight at a time, so slow responses are skipped rather than queued. The last 8 frames are kept so the frame that confirmed a step can be uploaded as evidence.
- **Replay mode** uses exactly the same code path with a video file as the source.

**Vision lab** (`/coordinator/vision-lab`): runs the whole pipeline live. You pick a protocol and a source (a scripted scenario, the camera, or a video file) and see the engine state, every frame's verdict and latency, and the event log. Use it to rehearse each safety path and to tune the prompt.

**Vision eval** (measures Gemini on recorded takes):

```bash
ffmpeg -i take1.mp4 -vf fps=1,scale=640:-1 eval/take1/frame_%04d.jpg
```

Label the frames in `eval/take1/labels.json`, e.g. `{ "frame_0001.jpg": "wash-hands", "frame_0002.jpg": "none" }`, then run:

```bash
npm run vision:eval -- --protocol mock-autoinjector --frames eval/take1
```

It reports accuracy, current-step recall, the **false "later step" rate** (the one that causes wrong stops) and latency at p50 and p95.

The evaluator now follows engine state rather than using correct labels to choose expected
steps. Annotate explicit Done taps for verbal requirements. See [READINESS.md](READINESS.md)
for complete recordings, annotations, JSON reports and the limits of offline replay.

## Patient app (`src/patient/`, Phase 4)

The phone flow at `/s/[token]`: one step on screen at a time, big text, and **Pause** and **Call my nurse** always in reach.

```
welcome → camera + mic explainer → camera check + practice (hands visible?) → ready
  → the procedure, one step at a time → all done | stop: "Call your study nurse at …"
```

- **Getting in:**
  - `/s/demo` creates a fresh session for the demo participant (p-001) and the mock autoinjector on every visit.
  - `/s/[token]` opens a session link; a bad, finished, or already-started session shows a plain message and the nurse's number. A persisted unfinished run cannot silently restart after refresh.
  - `POST /api/coordinator/sessions` `{ participantId, protocolId, mode }` → `{ sessionId, link }` (behind the coordinator gate; `GET` lists sessions with event and evidence counts).
- **Demo control:** `?vision=scripted&scenario=<name>` (no camera or microphone permission needed; the default for `/s/demo` and for `mock` sessions) or `?vision=server` (front camera → `/api/vision/check`; the default for `live` sessions). Scenarios are the vision ones: `happy`, `flicker`, `poor-camera`, `skip-critical`, `early-release`, `no-response`, `outage`.
- **`PatientController`** owns the `EngineRunner`, the `VisionLoop`, the 250 ms tick and persistence. Every input (frames, ticks, buttons, voice) goes through `controller.dispatch`, and screens render from one snapshot (`useSyncExternalStore`).
  - **Voice (`PatientVoice`, Phase 5):** the coach hears every engine event batch through `addEngineListener`, sends its commands through `controller.dispatch` (so the screen follows), and the Repeat button reaches it through `onRepeat`. It is created on the welcome tap, so mobile browsers allow speech. Live camera sessions ask for microphone access; scripted/replay demos use speech output and buttons without requesting a microphone. If the mic is denied or the browser can't listen, prompts are still spoken and the buttons do the rest.
- **The screen is derived, not stored:** `deriveScreen` maps engine state plus the pre-run UI phase to one screen. The engine wins: stopped, completed and paused screens can't be skipped by the UI.
- **Persistence never blocks the patient:**
  - Events are batched (300 ms debounce; stops and nurse calls go immediately), posted in order with one request in flight, and retried with backoff (1 s doubling to 15 s). A dead link (4xx) drops the batch rather than wedging the queue.
  - `POST /api/patient/[token]/events` validates event shapes with Zod, appends idempotently on `eventSeq`, derives status from the canonical log, and records mock escalation receipts. Supabase ingestion locks the session row in one transaction; late retries cannot undo a newer resume. This is shape validation, not proof that a client event is genuine.
  - On `step_confirmed` and `critical_miss` the matching frame is uploaded to `POST /api/patient/[token]/evidence` (JPEG checked by its magic bytes; one frame per step and seq).
  - When the connection returns the queue flushes, and on page hide any leftovers go by `sendBeacon`.
- **Error states:** camera denied (how to re-allow it, plus the nurse), offline banner (frame errors pause the engine anyway), and vision unavailable (paused with `SCRIPTS.visionUnavailable` and a **Continue** button).
- **Accessibility:** body text is 20 px or larger (24 px for most), targets are 64 px, contrast uses the AA tokens, the current step and corrections are `aria-live`, each screen's heading takes focus, and motion respects `prefers-reduced-motion`. Also: Wake Lock while running, and a mirrored front-camera preview (`playsInline muted autoPlay`).
- **Copy:** spoken and explanatory sentences come from `src/voice/scripts.ts`. Button labels and screen-only notes are in `src/patient/copy.ts`.

**Tests:** screen derivation, timers and countdown formatting, the outbox's batching, dedupe, backoff and drop rules, the session status patch, the controller end to end on scripted vision (events and evidence persisted, critical-miss frame uploaded, commands, corrections), and the patient and coordinator API routes (valid token, wrong token, idempotent events, non-JPEG evidence).

## Voice (`src/voice/`, Phase 5)

```
engine events → VoiceCoach → SpeechQueue → VoiceProvider.speak (scripts + reviewed step prompts only)
microphone → VoiceProvider (transcript) → parseCommand → VoiceCoach → engine input (source: "voice")
```

- **The patient never hears model-generated text.** The coach speaks only app-authored lines from `scripts.ts` and each step's coordinator-reviewed `spokenPrompt`. A test drives the whole demo procedure by voice and checks that every spoken line comes from those sources.
- **Events to speech:**
  - `step_activated`: the step's prompt, plus "say done" for verbal steps
  - `correction`: the scripted phrase for the issue code
  - hold start: "Hold it there…", then "Three. Two. One." near the end
  - `step_confirmed`: "Good." (or "Done. You can stop holding.")
  - `paused`, `resumed` (and the step again), `nurse_called`, `vision_degraded`, `completed`: their scripts
  - `critical_miss`, `needs_human`, `stopped`: an **urgent** stop line that cuts off anything playing
- **Commands** (`commands.ts`), each also a button:
  - `pause`, `continue`, `repeat`, `call_nurse` and `done`
  - `done` sends `verbal_confirm` only for the current step, and only if that step asks for a spoken confirmation. It never advances a step the camera must confirm.
  - **"hold" never means pause**, because a step says "press and hold", so "hold on" is ignored. A bare **"stop" means pause**: pausing is reversible and only an explicit "continue" resumes, while ending a session is never a voice command.
  - Commands that move things forward (`continue`, `done`) are strict: short utterances only, with no negation ("I'm not done"), hedge ("almost done") or question ("am I done?"). Commands that slow things down match anywhere in a sentence. When a sentence holds several, the most cautious wins.
- **Speech queue:** one line at a time. Urgent lines interrupt and clear the queue, and the same key isn't repeated within 6 s. Lines for a step that has ended are dropped, and at most one correction waits.
- **Browser provider** (the default):
  - Output: `speechSynthesis` at rate 0.9, with a natural English voice (novelty voices excluded).
  - Input: `SpeechRecognition` (continuous), restarted with backoff when it ends.
  - It ignores what it hears while speaking and for 600 ms after. On iOS it stops the recognizer while speaking, because record mode silences speech there.
  - Firefox is speak-only (the buttons still work). Errors map to `not_supported`, `permission_denied`, `network` or `unknown`.
- **Gemini Live** (stretch, `NEXT_PUBLIC_VOICE_PROVIDER=gemini-live`):
  - `POST /api/voice/token` mints a **single-use, 30-minute** ephemeral token, locked to `GEMINI_LIVE_MODEL` and a config with only the five command functions. With a configured passcode, it requires patient/coordinator access and is rate-limited per session or coordinator address.
  - The browser streams 16 kHz PCM16 from an AudioWorklet and acts on the model's function calls. `continue` and `done` count only when the app's own parser agrees with the input transcript.
  - **Live's audio output is discarded.** Speech still comes from `speechSynthesis`, reading the coach's text verbatim, because a speech model can paraphrase.
  - **Tested against the real API** (`gemini-3.8-live`, ephemeral tokens on `v1beta`; the SDK warns about `v1alpha`, but `v1beta` works). Each test streamed synthesized speech, and the results were:
    - "Please pause" → pause
    - "Help, call my nurse" → call_nurse
    - "I'm done", "Okay, I'm finished" and "Checked, the date is fine" → done
    - "Hold on, I am pressing the pen" → no command, as intended
    - Commands land about 2.5–3.5 s after speech ends. A token takes about 0.15 s and connecting about 0.3 s.
  - **High start-of-speech sensitivity is required:** with the defaults, sub-second phrases like "I'm done." were never transcribed.
  - **The model sometimes speaks** despite its instructions. That audio is dropped and never played, but it uses quota (one test session hit "resource exhausted"). This Live model doesn't accept text-only output. Keep `browser` as the default and treat `gemini-live` as an upgrade for devices whose browser recognition is weak.
- **Try it:** open `/s/demo` (voice is on in the patient app), or in the vision lab tick **Voice on** and start a scripted run; the lab's voice panel logs every line spoken, transcript heard and command handled.

## Study team dashboard (`/coordinator`, Phase 6)

- **Sessions** (`/coordinator`):
  - A form creates a patient link: participant, protocol, and demo or live camera. The raw link is shown once, because only its hash is stored.
  - The list shows status, start time, duration, open flags (critical in red) and a plain-language outcome. It refreshes itself while any session is running.
- **Session timeline** (`/coordinator/sessions/[id]`):
  - **Flags**, open first: critical misses, `needs_human` stops, skipped steps, pauses during a critical hold, nurse calls, and pauses caused by vision errors. Each comes with a plain explanation, the time since the run started, the evidence frame if there is one, and a **Mark reviewed** button.
  - **Steps:** each step's outcome (confirmed, skipped, stopped here, or not reached), when it was confirmed, how long it took, how it was confirmed (camera, timed hold, spoken, tapped) and an evidence thumbnail.
  - The raw event log, in a collapsible section.
  - The page updates live (every 2.5 s) while the session runs, then refreshes 12 more times to collect late evidence and alert receipts.
- **Flags come from the append-only event log** (`src/dashboard/timeline.ts`, a pure function with tests). Only the review is stored (`flag_reviews`), so the record itself is never edited. Practice-run events are left out of the record.
- **Evidence:** in memory mode it's served by `GET /api/coordinator/evidence/[id]`, behind the coordinator gate. In Supabase mode it's served with signed URLs that expire after 5 minutes, from a private bucket.

### Supabase

- **Schema** (`supabase/migrations/20261010000000_init.sql`):
  - Tables: `participants`, `protocols` (versioned), `sessions` (stores only the link token's SHA-256 hash), `step_events`, `evidence_frames`, `alerts` and `flag_reviews`, plus a private `evidence` storage bucket.
  - **RLS is on for every table with no policies**, so the anon and authenticated roles get nothing. The server uses the secret key.
  - Triggers make `step_events` **append-only** and **published protocols immutable**, and a partial unique index allows only one draft per protocol.
- **Verified against real Postgres 16:** the migration applies cleanly. Updating or deleting events, editing or deleting a published protocol, a second draft, a review of a non-existent event, and anon or authenticated reads are all rejected. Every column the repository uses exists.
- **Not yet verified:** `SupabaseRepository` (`src/persistence/supabase.ts`) hasn't run against a hosted project. Its row mappers are unit-tested.
- **Setup:**
  1. Create a Supabase project.
  2. Apply **both migrations**, in filename order, in its SQL editor or with `npx supabase db push`. Phase 7 requires the alert receipt columns and `append_session_events` RPC.
  3. In `.env.local`, set `SUPABASE_URL`, `SUPABASE_SECRET_KEY` and `PERSISTENCE=supabase`.
  4. Load the demo participants and protocols:
     ```bash
     npm run seed
     ```
     It's idempotent, so it's safe to run again.
- **Dev note:** the in-memory repository survives hot reloads. If you change `MemoryRepository` itself, restart `npm run dev`.

## Escalation, demo/replay, accessibility and docs (Phase 7)

- **Mock escalation:** real-run `critical_miss` and `needs_human` events create study-team
  alerts; `needs_human(step_timeout)` is classified as `no_response`. Nurse requests also
  create a study-team alert. Practice events never alert.
- **Trusted contacts:** receive a simulated stop alert only when their stored consent is
  true. A nurse request alone does not notify the contact. These are demo receipts, not texts
  or calls. The phone button opens a dialer; voice asks the participant to tap it.
- **Retries and review:** a unique session/event/recipient key deduplicates alert records.
  The mock notifier returns repeatable receipts. Failed delivery is recorded and retried by
  the patient's event outbox. The session detail lists recipients, delivery state, and an
  idempotent Review alert button. Real delivery needs a durable worker (see the roadmap).
- **No-response limit:** the engine's running-step timeout, not a background heartbeat.
  Closed pages, sleeping devices, and indefinite user pauses are not monitored.
- **Launcher:** `/demo` selects a protocol, participant/consent case, source and scenario.
  Each launch creates a fresh session. The `no-response` script shortens the step timeout to
  15 seconds for rehearsal; normal runs retain the 240-second default plus the step timer.
- **Replay:** choose a local video in the patient flow (`?vision=replay` on a fresh demo,
  or a coordinator-created replay session). Frames pass through server vision, the engine,
  event persistence, evidence capture and escalation. Playback pauses with the engine.
  Replay skips practice; recordings start with procedure step one. Early EOF stops the run.
  Mock server vision still simulates matches; use Gemini only for actual visual classification.
- **Media loss:** missing/frozen frames count as vision errors. Holds cannot be completed
  solely by a timer while the camera or replay is unavailable.
- **Accessibility:** narrow-screen wrapping, step-heading focus, accessible replay controls,
  and repeatable axe/keyboard/mobile-width checks. Physical-device VoiceOver/TalkBack testing
  remains a release acceptance check, not an automated-test claim.
- **Docs:** [Demo and deployment runbook](DEMO_RUNBOOK.md),
  [accessibility coverage](ACCESSIBILITY.md), [production roadmap](PRODUCTION_ROADMAP.md).
- **Verification:** unit/API tests, a Playwright browser suite, and rollback-only local
  Postgres checks in `scripts/verify-phase7.sql`. Browser tests use synthetic video and mock
  providers; they do not measure Gemini recognition accuracy.

## Build phases

0. Scaffold, env config, folder structure, interfaces for every module
1. **Step engine + thorough unit tests** (flicker, skipped critical step, pause/resume timers, retries leading to needs_human, fast-check invariants)
2. Protocol compiler + coordinator review screen
3. Vision provider (mock, then Gemini) + frame capture + API route + an eval on a recorded demo video
4. Patient app UI wired to the engine
5. Voice (browser speech first; Gemini Live is a stretch goal)
6. Supabase persistence + coordinator dashboard + evidence frames
7. Escalation mock, demo/replay mode, accessibility pass, docs
8. Showcase landing page at `/`: pitch, demo video (hosted outside Git), how it works, safety principles, "try it" links into the live demo, roadmap, team. Built last so the video and screenshots show the finished product.

**24h split (2 devs).**

- **Dev A:** engine → vision → patient UI → voice.
- **Dev B:** compiler → Supabase → dashboard → escalation/replay → docs.
- **Checkpoint at hour 12:** the whole flow runs end-to-end on mocks and is deployed over HTTPS.

## Demo mode

- Seeded mock autoinjector protocol. "Clean the site" and "hold 10 seconds" are critical steps.
- Two more seeded protocols, to show the approach generalizes.
- **Replay mode**: runs the full pipeline from a recorded video. This is the backup demo.
- **Mock vision toggle**: scripted scenarios (happy path, flicker, skipped critical step, early release).

## Stack

Next.js (App Router), TypeScript (strict), Tailwind, Zod, Vitest, Supabase (Postgres + Storage), Gemini API, Netlify.

## Getting started

For the selected hosting setup, follow [Supabase + Netlify setup](NETLIFY_SETUP.md).

Requires Node 20.9+ and npm.

```bash
npm install
cp .env.example .env.local   # optional: every provider defaults to its mock
npm run dev                  # http://localhost:3000
```

| Script              | What it does                                                                              |
| ------------------- | ----------------------------------------------------------------------------------------- |
| `npm run dev`       | Dev server                                                                                |
| `npm test`          | Unit tests (Vitest)                                                                       |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit`                                           |
| `npm run lint`      | ESLint, including the engine purity rules                                                 |
| `npm run build`     | Production build                                                                          |
| `npm run test:e2e`  | Browser flows and axe accessibility checks against a mock production server (build first) |

### Environment variables

See [`.env.example`](.env.example). With no `.env.local`, everything runs on mocks: no Gemini key, no Supabase.

| Variable                              | Default                                                                             | Purpose                                             |
| ------------------------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------- |
| `VISION_PROVIDER`                     | `mock`                                                                              | `mock` or `gemini` frame checks                     |
| `PROTOCOL_COMPILER`                   | `mock`                                                                              | `mock` or `gemini` protocol compilation             |
| `PERSISTENCE`                         | `memory`                                                                            | `memory` or `supabase`                              |
| `NOTIFIER`                            | `mock`                                                                              | Simulated escalation receipts; no real SMS or calls |
| `NEXT_PUBLIC_VOICE_PROVIDER`          | `browser`                                                                           | `browser` speech or `gemini-live`                   |
| `GEMINI_API_KEY`                      | –                                                                                   | Required when any Gemini provider is selected       |
| `GEMINI_*_MODEL`                      | compiler `gemini-3.8-flash`, vision `gemini-3.5-flash-lite`, live `gemini-3.8-live` | Model IDs, overridable                              |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | –                                                                                   | Server-only; required when `PERSISTENCE=supabase`   |
| `COORDINATOR_PASSCODE`                | –                                                                                   | Hackathon gate for the dashboard                    |
| `NEXT_PUBLIC_TRIAL_NURSE_PHONE`       | `+1-202-555-0100`                                                                   | The trial's 24/7 line (fictional number)            |

### Testing on a phone

The camera only works over HTTPS on a phone. Use the Netlify deployment or an HTTPS tunnel to your dev server.
