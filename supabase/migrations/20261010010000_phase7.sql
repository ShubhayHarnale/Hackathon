-- Idempotent mock escalation receipts. Existing alerts remain readable.
alter table public.alerts add column dedupe_key text unique;
alter table public.alerts add column delivery jsonb;

-- Serialize event ingestion per session, and derive status from the canonical log.
-- This prevents an old pagehide beacon/retry from undoing a newer resume.
create function public.append_session_events(p_session_id uuid, p_events jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare
  item jsonb;
  entry record;
  next_status text := 'created';
  start_time timestamptz := null;
  end_time timestamptz := null;
  reason jsonb := null;
begin
  perform id from public.sessions where id = p_session_id for update;
  if not found then raise exception 'session not found'; end if;
  for item in select value from jsonb_array_elements(p_events) loop
    insert into public.step_events(session_id, event_seq, type, step_id, run, occurred_at, event)
    values (p_session_id, (item->>'event_seq')::integer, item->>'type', item->>'step_id',
      item->>'run', (item->>'occurred_at')::timestamptz, item->'event')
    on conflict (session_id, event_seq) do nothing;
  end loop;
  for entry in select * from public.step_events where session_id = p_session_id order by event_seq loop
    exit when next_status in ('completed', 'stopped');
    case entry.type
      when 'practice_started' then next_status := 'practice';
      when 'practice_completed' then next_status := 'created';
      when 'run_started' then
        next_status := 'active'; start_time := coalesce(start_time, entry.occurred_at);
      when 'paused' then next_status := 'paused';
      when 'resumed' then next_status := case when entry.run = 'practice' then 'practice' else 'active' end;
      when 'completed' then next_status := 'completed'; end_time := entry.occurred_at;
      when 'stopped' then
        next_status := 'stopped'; end_time := entry.occurred_at; reason := entry.event->'reason';
      else null;
    end case;
  end loop;
  update public.sessions set status = next_status, started_at = start_time,
    ended_at = end_time, stop_reason = reason where id = p_session_id;
end $$;
revoke all on function public.append_session_events(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.append_session_events(uuid, jsonb) to service_role;
