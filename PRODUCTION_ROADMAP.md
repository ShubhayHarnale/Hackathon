# Beyond the Witness hackathon

Witness currently demonstrates a workflow with synthetic participants and prop procedures.
It is not validated for clinical use, emergency monitoring, or treatment decisions.

## Before a public demo with live services

- Validate hosted Supabase end to end, including PostgREST, Storage, signed URLs, migration
  rollout, and persistence across deployments. Local Postgres checks cover SQL behavior only.
- Vision requests and Gemini Live token issuance now require a patient session token or
  coordinator access when the coordinator passcode is set. Add durable abuse/rate controls;
  public demo-link creation and per-instance limits are not a quota-management system.
- Add observability and retention limits for demo sessions, evidence, and provider failures.
- Record and label prop videos, run the vision evaluation, and publish actual measurements
  separately from deterministic mock tests. Test the exact target phone/browser setup.
- Complete the physical-device accessibility checks in [ACCESSIBILITY.md](ACCESSIBILITY.md).

## Reliability and escalation

- Replace the mock notifier only after defining recipient verification, explicit contact
  consent, delivery receipts, provider idempotency keys, retries, and failure ownership.
- Use a durable transactional outbox/worker for real notifications. The current mock can
  be retried safely, but concurrent requests may call its no-op provider more than once.
- Define and implement background no-response monitoring if needed. The demo only maps an
  active step timeout to an alert; closed tabs and long voluntary pauses are not monitored.
- Persist queued browser events/evidence across crashes if required. The current queue is
  in memory; `sendBeacon` is best effort. Evidence retries are bounded.
- Add an atomic session claim to prevent simultaneous tabs from starting the same unused link.
  The current reload guard prevents restarting sessions that already have persisted events.
- Design clinically reviewed interrupted-session recovery. Do not resume or repeat a physical
  procedure merely by reconstructing a browser state machine.

## Clinical, privacy, and governance work

- Have qualified clinical teams define protocols, stop rules, escalation ownership, and
  representative validation criteria for each intended procedure and population.
- Conduct a formal assessment of the intended use and applicable clinical, privacy, security,
  and regulatory requirements with appropriate specialists before any real-world deployment.
- Replace the shared coordinator passcode with individual authentication, authorization,
  session expiry/revocation, and an attributable review audit trail.
- Establish data minimization, retention/deletion, access auditing, vendor arrangements,
  incident response, and consent language that matches the actual data flows.
- Evaluate error rates and failure modes across lighting, devices, movement, assistive needs,
  and participant groups. Model confidence alone is not evidence of clinical correctness.

## Phase 8: showcase

Build the public-facing pitch, how-it-works walkthrough, safety principles, team and roadmap
sections, and hosted demonstration video using the finished phase 7 flow. Keep recordings
outside Git. `/demo` is the functional scenario launcher; the `/` showcase is still a later phase.
