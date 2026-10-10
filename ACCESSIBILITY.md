# Accessibility verification

The patient flow uses large text, 64px main controls, visible focus outlines, high-contrast
light/dark tokens, fixed correction announcements, focus on changing screen headings, and
reduced-motion styles. Every voice command has a button. Scripted demos need no media
permissions. Timers avoid continuous screen-reader announcements.

Phase 7 changes remove forced single-line nurse controls/phone numbers on narrow screens,
focus new step headings, label replay inputs and previews, and expose delivery/review state
as text instead of relying on color. Replay footage is muted demonstration input; procedure
instructions remain visible as text.

## Automated browser coverage

`npm run test:e2e` runs axe-core WCAG A/AA checks (WCAG 2 and 2.1 tags) on the launcher,
patient stop screen, replay setup, and coordinator alert detail. It checks launcher light/dark
themes, reduced motion, keyboard tab order, and 320px horizontal overflow on the launcher
and stop screen. It also exercises consent, alert review, evidence, replay, and reload handling.

Passing axe checks is not an accessibility certification. Automated checks cannot establish
that spoken instructions, announcements, timing, or permission dialogs work well for people.

## Physical-device release checks

These require real devices and remain manual acceptance checks:

- iOS Safari + VoiceOver, Android Chrome + TalkBack: heading announcements, action labels,
  reading order, interruption/repeat, and no focus traps.
- Large text/200% zoom, portrait/landscape, and safe-area behavior on phones.
- Camera denied, microphone denied, unsupported recognition, reconnect, and screen lock.
- Speech synthesis audibility while recognition is enabled; no commands from the app's own speech.
- Keyboard-only protocol editing, launcher, patient controls, and coordinator review.
- Observe an older-adult usability session with appropriate consent before generalizing usability.

Use only the synthetic demo participants and a prop. Do not test with medication or real
patient data. Record device, browser, date, scenario, and result when completing this checklist.
