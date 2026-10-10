# Witness readiness report — 10 October 2026

## Verified locally

- **270 unit/property/API tests**, 27 test files; typecheck, lint and production build passed.
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

## Prepared artifacts

- `NETLIFY_SETUP.md`: complete Supabase → local verification → Netlify setup.
- `netlify.toml`: Node 22, configuration guard, Next.js build and `.next` publish directory.
- `scripts/supabase-smoke.ts`: synthetic storage/event/evidence/alert/review test plus a
  separate-process verification command. No hosted credentials are configured, so this
  pass verified its missing-configuration handling rather than claiming hosted success.
- Ignored `eval/readiness-controls/report.json`: real Gemini negative-control verdicts.
- Ignored `eval/readiness-videos/scripted-patient-walkthrough.mp4` and
  `scripted-critical-stop.mp4`: silent browser walkthroughs, synthetic and simulated.
  They are rehearsal clips, not prop recordings or Gemini recognition evidence. Media is
  kept outside Git and has not been published to a video host.

## Still awaiting setup or physical inputs

1. Create Supabase, run both migrations, set `.env.local`, seed and execute hosted smoke tests.
2. Import the repository into Netlify, set Builds + Functions environment values, deploy,
   and verify the HTTPS patient/coordinator flow and persistence across redeployment.
3. Record a clean prop procedure and a critical-skip take, label them, run the corrected
   Gemini evaluator, then rehearse both in real-time browser replay.
4. Check the physical phone camera, microphone, speech recognition and screen reader.
5. Publish an edited demonstration video and build the Phase 8 showcase.

Netlify and Supabase deployment acceptance is **pending**. Escalation is still mocked; no
texts or automatic calls are sent. No physical-device or clinical-validation claim is made.
