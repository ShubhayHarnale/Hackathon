# Readiness checks before the showcase

See [NETLIFY_SETUP.md](NETLIFY_SETUP.md) for the selected hosting setup. No hosted database
or site is configured yet. This file explains the remaining physical recording check.

## Record two prop takes

Use ordinary props and a synthetic label, never real medication. Frame the hands, pen,
and clothed thigh/prop surface clearly. Use the nine steps in
`src/demo/protocols/mock-autoinjector.json`; this is a training demonstration only.

- **Clean take:** hold each visual action in view for about 8–10 seconds. Allow time for
  the read-label and expiry button confirmations. Keep the press-hold action visible for
  at least 18 seconds so three observations can start the 10-second hold.
- **Critical skip take:** do the first three steps, omit clean-site, and visibly remove
  the cap for at least 8–10 seconds. The expected result is a critical-miss stop at clean-site.

These suggested recording durations are rehearsal starting points, not measured Gemini
performance guarantees. Keep videos/frames under ignored `eval/`, outside Git.

## Label and evaluate

```sh
mkdir -p eval/clean
ffmpeg -i /absolute/path/to/clean.mp4 -vf fps=1,scale=640:-1 eval/clean/frame_%04d.jpg
```

Label **every** extracted frame in `eval/clean/labels.json`. Use the observed action's
step ID or `none` when no action is visible. Add explicit button actions for verbal steps:

```json
{
  "frame_0001.jpg": "wash-hands",
  "frame_0002.jpg": "wash-hands",
  "frame_0003.jpg": "wash-hands",
  "frame_0004.jpg": {
    "observedStepId": "read-label",
    "commands": [{ "type": "done", "stepId": "read-label" }]
  },
  "frame_0005.jpg": {
    "observedStepId": "check-expiry",
    "commands": [{ "type": "done", "stepId": "check-expiry" }]
  }
}
```

This is a format example, not labels for an actual recording. Frame timestamps default to
one-second intervals starting at zero. Object annotations may provide `atMs` and commands
`pause`/`resume` to match recorded participant actions. Done commands occur before that
frame's classification. They do not fabricate visual confirmation.

```sh
npm run vision:eval -- --protocol mock-autoinjector --frames eval/clean --expect-outcome completed --output eval/clean/report.json
npm run vision:eval -- --protocol mock-autoinjector --frames eval/skip --expect-outcome critical_miss --output eval/skip/report.json
```

The evaluator follows the actual engine to select each frame's expected step. Ground-truth
labels are used only for scoring. It uses the same four-second provider budget as the app,
reports errors in the accuracy denominator, records per-frame verdicts and the engine event
log, and fails on provider errors or an unexpected outcome. Frames after a stop/completion
or during pause are reported as unchecked, not silently counted as correct.

This is **offline engine replay**, not a real-time browser replay: procedure time comes from
annotations and API latency is reported separately. After it passes, rehearse both videos
through `/demo` → Recorded video using Gemini, including Done taps. Check completion/stop,
evidence and escalation in the dashboard. Do not make accuracy claims from a black-frame
smoke test or the scripted browser walkthrough.

## Browser walkthrough recording

```sh
npx playwright install ffmpeg
PLAYWRIGHT_CHANNEL=chrome PLAYWRIGHT_RECORD_DEMO=1 npm run test:e2e -- --workers=1
```

Videos are stored under ignored `test-results/`. The happy demo, critical skip, no-response,
outage and synthetic replay tests verify the mock app flow. They are clearly simulated and
do not use a real camera, patient recording, or Gemini classification. Use a selected clip
for the showcase rehearsal; host the final edited video outside Git.
