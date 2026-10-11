# Witness: Supabase + Netlify setup

## Current deployment

The Netlify project already exists:
[witness-hackathon-shubhay](https://app.netlify.com/projects/witness-hackathon-shubhay).
The app is live at [Try Witness](https://witness-hackathon-shubhay.netlify.app/demo).
The local checkout is linked to this project; GitHub auto-deploy has not been connected.

Production-only provider settings, the approved Gemini key, and a generated coordinator
passcode are configured. The passcode is saved privately in the ignored file
`.netlify/coordinator-passcode.local`. Supabase project `Witness-demo`
(`wisyuvvlxggpjwjumofg`) is configured, migrated and seeded with synthetic data. Database,
private storage, separate-process persistence, hosted API reviews, coordinator gating and
real Gemini compiler/vision connectivity checks passed. Camera recognition of an actual
prop procedure and physical-phone voice checks still require human testing.

Share `/demo` with your teammate. Choose **Live camera** to use Gemini, or **Scripted demo**
for simulated checks without camera permissions. The coordinator dashboard requires the
private passcode; patient demos do not. Secrets remain in `.env.local` and Netlify's
production environment, outside Git and the browser bundle.

Netlify runs this Next.js app with its automatically installed OpenNext adapter, including
App Router and API routes. Keep the app as a server app; do not use static export or a
drag-and-drop deployment of source files. [Netlify Next.js documentation](https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/).

## 1. Create the Supabase project

1. Open [Supabase](https://supabase.com/dashboard), sign in, and create a project named
   `witness-demo` in your organization. Choose a region near your demo users.
2. Generate a database password and save it privately. The app uses an API secret key,
   so the database password does not go into this repository.
3. Wait until the project is ready. In **SQL Editor**, run these complete files one at a time,
   in this order, against the new project:
   - `supabase/migrations/20261010000000_init.sql`
   - `supabase/migrations/20261010010000_phase7.sql`
   - `supabase/migrations/20261011012058_harden_trigger_search_path.sql`
4. Open **Storage** and confirm that an `evidence` bucket exists and is private. The first
   migration creates it; do not create a public replacement.
5. Find the project URL via the project's **Connect** panel or API settings. Find/create a
   server secret key under **Settings → API Keys**. Use the secret (`sb_secret_…`), not the
   publishable (`sb_publishable_…`) or anon key. A legacy `service_role` key also works.
   [Supabase key documentation](https://supabase.com/docs/guides/getting-started/api-keys).

## 2. Configure and verify locally

Edit `.env.local`. Preserve your existing Gemini key and model settings, and set:

```dotenv
PERSISTENCE=supabase
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_SECRET_KEY=YOUR_SERVER_SECRET_KEY
COORDINATOR_PASSCODE=YOUR_RANDOM_PASSCODE_AT_LEAST_16_CHARACTERS
NOTIFIER=mock
NEXT_PUBLIC_VOICE_PROVIDER=browser
```

These example values are placeholders. Keep real secrets in `.env.local` and hosting
environment settings; never paste them into chat or commit them. The `.gitignore` excludes
local environment files. Supabase secret keys belong only in server code.

From the project directory:

```sh
npm run seed
ffmpeg -loglevel error -y -f lavfi -i color=c=blue:s=320x240 -frames:v 1 /private/tmp/witness-storage-check.jpg
npm run supabase:smoke -- --write --jpeg /private/tmp/witness-storage-check.jpg
```

The smoke check creates one synthetic stopped session and leaves its record/evidence in
the project for inspection. It exercises PostgREST, event deduplication, Storage upload,
private bucket configuration, a signed download, simulated alerts and reviews. It prints
a session ID and the following command. Run that command in a separate process:

```sh
npm run supabase:smoke -- --session THE_PRINTED_SESSION_ID
```

That confirms reads survive the original process exiting. Also run `npm run dev`, create
a scripted session at `/demo`, inspect it at `/coordinator`, restart the dev server, and
confirm its record and evidence still exist. The Supabase script is a storage test, not
a Gemini image-recognition test.

## 3. Import the GitHub repository into Netlify

The existing project above can be deployed from the linked checkout with the Netlify CLI
after configuration and storage verification. The steps below describe GitHub auto-deploy
for a fresh project; do not create a duplicate when continuing the prepared project.

1. Sign in at [Netlify](https://app.netlify.com/). Choose **Add new project → Import an
   existing project**, then GitHub. Authorize access to `ShubhayHarnale/Hackathon`.
2. Choose that repository and branch `main`. Use the repository root as the base directory.
   Name the project `witness-demo` or another available name.
3. The committed `netlify.toml` supplies Node 22, build command
   `npm run check:deploy && npm run build`, and publish directory `.next`.
   Netlify detects Next.js and applies its current adapter automatically; no pinned plugin
   or SPA catch-all redirect is needed.
4. Before deploying, add the environment variables below. If import starts a build before
   you can set them, the configuration guard will fail it; add the variables and redeploy.

## 4. Set Netlify environment variables

Under **Project configuration → Environment variables**, add:

| Variable                        | Initial value                                                     |
| ------------------------------- | ----------------------------------------------------------------- |
| `PERSISTENCE`                   | `supabase`                                                        |
| `SUPABASE_URL`                  | Your project URL                                                  |
| `SUPABASE_SECRET_KEY`           | Your server secret key                                            |
| `COORDINATOR_PASSCODE`          | Your private random passcode, at least 16 characters              |
| `VISION_PROVIDER`               | `mock` initially; change to `gemini` after the hosted flow passes |
| `PROTOCOL_COMPILER`             | `mock` initially; change to `gemini` when ready                   |
| `NOTIFIER`                      | `mock`                                                            |
| `NEXT_PUBLIC_VOICE_PROVIDER`    | `browser`                                                         |
| `NEXT_PUBLIC_TRIAL_NURSE_PHONE` | `+1-202-555-0100` (fictional demo number)                         |

When enabling Gemini, also set `GEMINI_API_KEY`, `GEMINI_COMPILER_MODEL=gemini-3.8-flash`,
and `GEMINI_VISION_MODEL=gemini-3.5-flash-lite` to match the current local configuration.
`GEMINI_LIVE_MODEL=gemini-3.8-live` is optional; keep browser voice for the first deployment.

Make app settings available to **Builds and Functions**. On plans that do not expose
individual scopes, use the available all-scopes setting. Mark server keys/passcode as
sensitive where offered. Apply them to the production context and only trusted preview
contexts. Do not give production secrets to untrusted fork previews.
`NEXT_PUBLIC_*` values enter the browser bundle; none may contain secrets. Changes to them
require a rebuild. [Netlify environment settings](https://docs.netlify.com/build/environment-variables/overview/).

## 5. Verify the HTTPS deployment

After deploying, send the `https://…netlify.app` URL so the hosted checks can be run:

1. `/demo` opens; `/coordinator` requests the passcode; sign in.
2. A scripted clean run completes and its record shows step evidence.
3. A critical-skip run stops, has evidence, and shows simulated study-team/contact alerts.
4. Review a flag/alert; reload and confirm the review persists.
5. Visit the same record after a redeploy; verify it still exists.
6. Enable Gemini compiler/vision and redeploy; compile a synthetic protocol and try replay.
7. On your physical phone, open HTTPS, allow camera/mic, and check spoken instructions,
   commands, buttons, focus/zoom, and pause/resume. Desktop mobile emulation is not a
   replacement for these checks.

## Current acceptance status

- Local key/provider smoke checks passed for compilation, frame classification, and Live
  token creation; full prop-procedure recognition is still awaiting recordings.
- Hosted Supabase storage and separate-process persistence passed. Netlify is deployed;
  hosted coordinator gating, synthetic session/evidence/review APIs, and real Gemini
  compiler/vision negative-control requests passed.
- Physical-device VoiceOver/TalkBack and microphone behavior remains pending.
- Notifications remain simulated. No SMS, automatic phone calls, or unattended monitoring.

Phase 8 can use the scripted walkthrough recording. Label it as simulated rather than
presenting it as evidence of Gemini recognition accuracy.
