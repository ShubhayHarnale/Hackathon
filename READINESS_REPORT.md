# Witness readiness report — 10 October 2026

## Verified locally

- **278 unit/property/API tests**, 29 test files; typecheck, lint and production build passed.
- **Seven recorded Chrome browser flows** passed: launcher keyboard/accessibility checks,
  critical-stop consent cases (two participants), no-response and reload guard, synthetic
  video replay/evidence, phone-sized happy run with Pause/Repeat/Continue, and vision outage
  followed by escalation. Browser flows used memory storage and mock providers.
- **Gemini compiler:** the configured real provider compiled three synthetic prop instructions
  into three valid steps in approximately 18.5 seconds.
- **Gemini vision:** three real requests for synthetic black/blue/white empty frames returned
  no matching procedure step, with darkness/blocked-camera issue codes and no provider errors.
  This checks connectivity and negative controls, not physical procedure recognition accuracy.
- **Gemini Live:** ephemeral token creation succeeded. Browser voice remains the selected
  provider; microphone command recognition was not retested in this readiness pass.
- **Provider authorization:** tests cover coordinator gating, valid/invalid patient link
  tokens, cross-session rejection, terminal sessions, unknown step context, and anonymous
  Live token denial. Open local demos remain available when no passcode is configured.
- **Evaluator correction:** expected step context now follows the real engine. Ground-truth
  labels are scoring inputs only; explicit participant actions handle verbal confirmations.
  Provider errors count in accuracy. Reports include frame verdicts, event logs and outcome.
- **Deployment guard:** tests verify missing persistence/credentials, insecure URLs, short
  passcodes and missing Gemini keys are blocked without logging credential values.

## Hands-only live demo update

- `/demo` and `/s/demo` default to a fresh live camera session using `hands-only`.
  No success/failure choice is required. Scripted scenarios and replay are separate
  developer tools; mock environments are explicitly labeled.
- The same patient controller checks one open hand in practice, then verifies both
  open hands, a thumbs-up and a five-second closed-fist hold. Skipping the critical
  first step uses the existing stop/evidence/escalation pipeline.
- All **10 Chrome flows** passed, including the new live launcher and hands-only
  completion/critical-stop records. Recognition in these browser tests is simulated.
- Hands-only practice is authorized against the saved session's protocol; unrelated
  pen practice is rejected. Holds cannot complete from elapsed time alone.
- Typecheck, lint and production build passed. Physical Gemini gesture recognition
  remains unverified until a person runs the camera demo. Notifications remain mocked.

## Prepared artifacts

- `NETLIFY_SETUP.md`: complete Supabase → local verification → Netlify setup.
- `netlify.toml`: Node 22, configuration guard, Next.js build and `.next` publish directory.
- `scripts/supabase-smoke.ts`: hosted synthetic storage/event/evidence/alert/review test
  and separate-process verification both passed.
- Ignored `eval/readiness-controls/report.json`: real Gemini negative-control verdicts.
- Ignored `eval/readiness-videos/scripted-patient-walkthrough.mp4` and
  `scripted-critical-stop.mp4`: silent browser walkthroughs, synthetic and simulated.
  They are rehearsal clips, not prop recordings or Gemini recognition evidence. Media is
  kept outside Git and has not been published to a video host.

## Verified on Supabase and Netlify

- Live demo: [Try Witness](https://witness-hackathon-shubhay.netlify.app/demo).
- Supabase project `Witness-demo` (`wisyuvvlxggpjwjumofg`): all three migrations applied,
  three synthetic participants and four published demo protocols seeded (including hands-only).
- Private evidence upload and signed download, event/alert retry deduplication, persisted
  stop reasons and flag/alert reviews passed, including a fresh-process read.
- Hosted coordinator gating rejects anonymous API requests and redirects dashboard visits;
  sign-in sets a secure httpOnly cookie. The hosted function reads the separately created
  storage-test session.
- Coordinator sign-in now uses relative redirects, keeping Netlify's internal deployment
  hostname out of browser navigation so the cookie remains usable on the public site.
  Three new redirect regression tests and seven provider-access tests passed; lint and the
  Netlify production build passed.
- The hosted browser's scripted happy walkthrough completed with 36 saved events and
  nine evidence frames. After a second deployment, that record and both synthetic stopped
  test sessions remained readable with their evidence and reviewed alerts.
- Hosted session creation, patient event/evidence ingestion and coordinator review APIs
  passed with a synthetic critical-skip fixture.
- Hosted real Gemini vision returned no match for a blue empty frame (`camera_blocked`);
  hosted Gemini compiler returned a valid three-step synthetic prop protocol. These verify
  server configuration and connectivity, not physical procedure recognition accuracy.
- Supabase advisor search-path warnings resolved by the third migration. Remaining
  no-policy RLS notices are informational and intentional: tables deny browser access;
  only the Next.js server uses the privileged key.
- Local credentials and coordinator passcode are ignored by Git. Netlify secrets are
  production-only. This deployment uses the CLI; GitHub auto-deploy is not connected.

## Still awaiting physical inputs and Phase 8

1. Run and record clean and critical-skip hands-only camera takes with Gemini, label them,
   then evaluate and rehearse both in real-time browser replay.
2. Check the physical phone camera, microphone, speech recognition and screen reader.
3. Publish an edited demonstration video and build the Phase 8 showcase.

Netlify and Supabase are deployed and hosted API/storage checks passed. Escalation is still mocked; no
texts or automatic calls are sent. No physical-device or clinical-validation claim is made.
