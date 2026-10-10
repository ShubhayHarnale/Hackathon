-- Run AFTER both migrations on a disposable/local database. All data rolls back.
-- psql "$TEST_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-phase7.sql
begin;
insert into public.participants (id, display_name, trial_number)
values ('phase7-test', 'Synthetic test', 'TEST');
insert into public.protocols (id, version, status, protocol, published_at)
values ('phase7-test', 1, 'published', '{}', now());
insert into public.sessions (id, participant_id, protocol_id, protocol_version, token_hash, mode)
values ('00000000-0000-4000-8000-000000000007', 'phase7-test', 'phase7-test', 1, 'phase7-test', 'mock');

select public.append_session_events('00000000-0000-4000-8000-000000000007', '[
  {"event_seq":0,"type":"run_started","run":"real","occurred_at":"2026-10-10T12:00:00Z","event":{"type":"run_started","eventSeq":0}},
  {"event_seq":2,"type":"resumed","run":"real","occurred_at":"2026-10-10T12:00:02Z","event":{"type":"resumed","eventSeq":2}}
]');
-- Older pause arrives after resume, then is retried.
select public.append_session_events('00000000-0000-4000-8000-000000000007', '[
  {"event_seq":1,"type":"paused","run":"real","occurred_at":"2026-10-10T12:00:01Z","event":{"type":"paused","eventSeq":1}},
  {"event_seq":1,"type":"paused","run":"real","occurred_at":"2026-10-10T12:00:01Z","event":{"type":"paused","eventSeq":1}}
]');
do $$ begin
  if (select status from public.sessions where token_hash = 'phase7-test') <> 'active' then
    raise exception 'old batch regressed status'; end if;
  if (select count(*) from public.step_events where session_id = '00000000-0000-4000-8000-000000000007') <> 3 then
    raise exception 'event dedupe failed'; end if;
  if has_function_privilege('anon', 'public.append_session_events(uuid,jsonb)', 'execute') or
     has_function_privilege('authenticated', 'public.append_session_events(uuid,jsonb)', 'execute') then
    raise exception 'patient database roles must not ingest directly'; end if;
end $$;

select public.append_session_events('00000000-0000-4000-8000-000000000007', '[
  {"event_seq":3,"type":"stopped","run":"real","occurred_at":"2026-10-10T12:00:03Z","event":{"type":"stopped","reason":{"kind":"needs_human","cause":"step_timeout","stepId":"a"}}},
  {"event_seq":4,"type":"resumed","run":"real","occurred_at":"2026-10-10T12:00:04Z","event":{"type":"resumed"}}
]');
do $$ begin
  if (select status from public.sessions where token_hash = 'phase7-test') <> 'stopped' then
    raise exception 'terminal session reopened'; end if;
  if (select stop_reason->>'cause' from public.sessions where token_hash = 'phase7-test') <> 'step_timeout' then
    raise exception 'stop reason missing'; end if;
end $$;

insert into public.alerts (session_id, dedupe_key, kind, recipient, message)
values ('00000000-0000-4000-8000-000000000007', 'phase7-test-alert', 'no_response', '{"kind":"study_team"}', 'Synthetic mock alert')
on conflict (dedupe_key) do nothing;
insert into public.alerts (session_id, dedupe_key, kind, recipient, message)
values ('00000000-0000-4000-8000-000000000007', 'phase7-test-alert', 'no_response', '{"kind":"study_team"}', 'Synthetic mock alert')
on conflict (dedupe_key) do nothing;
update public.alerts set delivery = '{"ok":true,"channel":"mock","ref":"test"}', status = 'reviewed', reviewed_at = now()
where dedupe_key = 'phase7-test-alert';
do $$ begin
  if (select count(*) from public.alerts where dedupe_key = 'phase7-test-alert') <> 1 then
    raise exception 'alert dedupe failed'; end if;
end $$;
rollback;
