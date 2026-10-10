# Witness

**A camera-and-voice coach for at-home clinical trial procedures, with a time-stamped record for the study team.**

A trial participant props up their phone and performs a procedure in view of the camera. Witness checks each step, coaches by voice one step at a time, and records when each step happened, with an evidence frame. When something goes wrong it stops and routes the participant to their study nurse.

> **Hackathon project. Synthetic data only. No real patient data, no PHI.**
> The demo procedure is a **mock autoinjector** (a pen used as a prop). It is **not medical guidance.**

## Product principles
- **The app flags and records. A human makes every medical decision.**
- No dosing advice, ever. When the app is unsure, it **stops and routes to a human**. It never tells the patient to carry on.
- **The patient never hears model-generated text.** Vision returns issue *codes* from a fixed list, and voice only speaks scripts the app wrote.
- Built for older adults who may live alone:
  - no install
  - one step on screen at a time
  - large text and high contrast
  - voice-first, with a button for every voice command

## Why build this
At-home procedures in decentralized trials are a blind spot: the sponsor can't see whether a self-injection was done correctly, so deviations from the protocol show up late or never. Sponsors already pay for AI video checks of whether participants take their medication. Witness adds **real-time, step-by-step coaching** and an **audit trail**, compiled from any protocol text.

As a product it would need clinical validation, IRB approval, HIPAA compliance, and FDA device-software review (see `PRODUCTION_ROADMAP.md`, coming). The pitch is **verification plus an audit trail**, not "an AI nurse."

## Architecture
| Module | Responsibility |
|---|---|
| `src/engine/` | Pure TypeScript step state machine. No I/O, fully unit tested. **The single source of truth.** |
| `src/protocol/` | Compiles plain-text instructions into validated steps with Gemini structured output and Zod; the coordinator reviews and edits before publishing. |
| `src/vision/` | `VisionProvider` (Gemini + scripted mock). About 1 frame/sec from the camera or a replayed video. |
| `src/voice/` | `VoiceProvider` (browser speech by default, Gemini Live as a stretch goal) and the `VoiceCoach`. Commands: pause, continue, repeat, call my nurse, done. |
| `src/escalation/` | `NotifierProvider` (mock now, SMS/telephony stub for later). Policy for alerting the trusted contact. |
| `src/persistence/` | `Repository` (in-memory + Supabase). |
| `src/app/` | Patient flow `/s/[token]` (mobile), coordinator dashboard `/coordinator` (desktop), API routes. |

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
  - Models: `gemini-3.8-flash` for compiling and vision, `gemini-3.8-live` for voice. Model IDs come from env vars.
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

| Rule | Default |
|---|---|
| A step counts as seen after N consecutive matching frames with confidence ≥ 0.7 | 3 |
| A later step seen N frames in a row is a skip. Skipping a critical step stops with `critical_miss`; skipped non-critical steps are flagged and the app follows the patient | 3 |
| **Hold** (visual step + timer): the timer runs only while the step stays visible. Releasing early on a critical hold is a `critical_miss`. Losing sight of it for 3 frames is `needs_human` | 3 frames |
| **Wait** (verbal step + timer): counted from when the step starts; also needs the spoken or tapped confirmation | – |
| `needs_human` after this many frames on one step that don't show it | 25 |
| `needs_human` after this many interrupted holds (non-critical steps) | 3 |
| `needs_human` after this much active time on one step (plus the step's own timer) | 240 s |
| Vision errors in a row before a system pause | 5 |
| Vision outage before `needs_human` | 30 s |

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
  - `gemini` (server-only): Interactions API, `store: false`, low image resolution, `thinking_level: "minimal"`, temperature 0, a 4 s timeout, and structured output whose step ids are restricted to the candidates or `"none"`.
  - `mock`: always sees the current step.
  - **Scripted scenarios** (browser-side, no camera or key needed): `happy`, `flicker`, `poor-camera`, `skip-critical`, `early-release` and `outage`.
- **What the model is asked:** the current step plus the next 3 steps, so skips are visible. It only classifies frames: it picks an id and an issue code from a fixed list, and never writes text for the patient.
- **API route** (`POST /api/vision/check`):
  - Validates requests with Zod.
  - Rate-limits each session with a token bucket (burst of 4, refilling 2 per second; in-memory, per server instance).
  - Errors come back as typed kinds (`timeout` 504, `rate_limited` 429, `provider` 502). The client turns them into `frame_error`, so the engine pauses and then routes to a human, and never guesses.
- **Client:** the browser times out a request after 6 s. Only one check is in flight at a time, so slow responses are skipped rather than queued. The last 8 frames are kept so the frame that confirmed a step can be uploaded as evidence (Phase 6).
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
  - `POST /api/voice/token` mints a **single-use, 30-minute** ephemeral token, locked to `GEMINI_LIVE_MODEL` and a config with only the five command functions. It's rate-limited per client.
  - The browser streams 16 kHz PCM16 from an AudioWorklet and acts on the model's function calls. `continue` and `done` count only when the app's own parser agrees with the input transcript.
  - **Live's audio output is discarded.** Speech still comes from `speechSynthesis`, reading the coach's text verbatim, because a speech model can paraphrase.
  - Untested against the real API (no key in development). `LIVE_API_VERSION` in `gemini-live-config.ts` is `v1beta` per the docs, while the SDK comments say `v1alpha`.
- **Try it:** in the vision lab, tick **Voice on** and start a scripted run. The voice panel logs every line spoken, transcript heard and command handled.

## Build phases
0. Scaffold, env config, folder structure, interfaces for every module
1. **Step engine + thorough unit tests** (flicker, skipped critical step, pause/resume timers, retries leading to needs_human, fast-check invariants)
2. Protocol compiler + coordinator review screen
3. Vision provider (mock, then Gemini) + frame capture + API route + an eval on a recorded demo video
4. Patient app UI wired to the engine
5. Voice (browser speech first; Gemini Live is a stretch goal)
6. Supabase persistence + coordinator dashboard + evidence frames
7. Escalation mock, demo/replay mode, accessibility pass, docs
8. Showcase landing page at `/`: pitch, demo video (hosted on YouTube or Vercel Blob, not in git), how it works, safety principles, "try it" links into the live demo, roadmap, team. Built last so the video and screenshots show the finished product.

**24h split (2 devs).**
- **Dev A:** engine → vision → patient UI → voice.
- **Dev B:** compiler → Supabase → dashboard → escalation/replay → docs.
- **Checkpoint at hour 12:** the whole flow runs end-to-end on mocks and is deployed to Vercel.

## Demo mode
- Seeded mock autoinjector protocol. "Clean the site" and "hold 10 seconds" are critical steps.
- Two more seeded protocols, to show the approach generalizes.
- **Replay mode**: runs the full pipeline from a recorded video. This is the backup demo.
- **Mock vision toggle**: scripted scenarios (happy path, flicker, skipped critical step, early release).

## Stack
Next.js (App Router), TypeScript (strict), Tailwind, Zod, Vitest, Supabase (Postgres + Storage), Gemini API, Vercel.

## Getting started
Requires Node 20.9+ and npm.

```bash
npm install
cp .env.example .env.local   # optional: every provider defaults to its mock
npm run dev                  # http://localhost:3000
```

| Script | What it does |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Unit tests (Vitest) |
| `npm run typecheck` | Generates Next route types, then `tsc --noEmit` |
| `npm run lint` | ESLint, including the engine purity rules |
| `npm run build` | Production build |

### Environment variables
See [`.env.example`](.env.example). With no `.env.local`, everything runs on mocks: no Gemini key, no Supabase.

| Variable | Default | Purpose |
|---|---|---|
| `VISION_PROVIDER` | `mock` | `mock` or `gemini` frame checks |
| `PROTOCOL_COMPILER` | `mock` | `mock` or `gemini` protocol compilation |
| `PERSISTENCE` | `memory` | `memory` or `supabase` |
| `NOTIFIER` | `mock` | Escalation delivery (a real SMS provider is stubbed) |
| `NEXT_PUBLIC_VOICE_PROVIDER` | `browser` | `browser` speech or `gemini-live` |
| `GEMINI_API_KEY` | – | Required when any Gemini provider is selected |
| `GEMINI_*_MODEL` | `gemini-3.8-flash` / `gemini-3.8-live` | Model IDs, overridable |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY` | – | Server-only; required when `PERSISTENCE=supabase` |
| `COORDINATOR_PASSCODE` | – | Hackathon gate for the dashboard |
| `NEXT_PUBLIC_TRIAL_NURSE_PHONE` | `+1-555-0100` | The trial's 24/7 line (fictional number) |

### Testing on a phone
The camera only works over HTTPS on a phone. Use a Vercel preview deployment or a tunnel to your dev server.
