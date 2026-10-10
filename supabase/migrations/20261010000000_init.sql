-- Witness: initial schema. Synthetic data only.
--
-- Access model: the browser never talks to Supabase. Every read and write goes through
-- the Next.js server with the secret (service role) key, which bypasses RLS. RLS is on for
-- every table with NO policies, so the anon and authenticated roles can read and write
-- nothing: deny by default.

-- Participants (synthetic: display name and trial number only, no PHI) ---------------
create table public.participants (
  id text primary key,
  display_name text not null,
  trial_number text not null unique,
  trusted_contact_name text,
  trusted_contact_phone text,
  trusted_contact_consented boolean not null default false,
  created_at timestamptz not null default now()
);

-- Protocols: versioned; a published version is immutable ------------------------------
create table public.protocols (
  id text not null,
  version integer not null check (version > 0),
  status text not null check (status in ('draft', 'published')),
  source_text text,
  protocol jsonb not null,
  created_at timestamptz not null default now(),
  published_at timestamptz,
  primary key (id, version),
  check ((status = 'published') = (published_at is not null))
);

-- At most one draft per protocol id.
create unique index protocols_one_draft on public.protocols (id) where status = 'draft';

create function public.protocols_published_immutable() returns trigger
language plpgsql as $$
begin
  if old.status = 'published' then
    raise exception 'published protocol % v% is immutable', old.id, old.version;
  end if;
  return new;
end $$;

create trigger protocols_published_immutable
  before update or delete on public.protocols
  for each row execute function public.protocols_published_immutable();

-- Sessions ---------------------------------------------------------------------------
create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  participant_id text not null references public.participants (id),
  protocol_id text not null,
  protocol_version integer not null,
  -- SHA-256 of the link token; the raw token only ever exists in the patient's link.
  token_hash text not null unique,
  mode text not null check (mode in ('live', 'replay', 'mock')),
  status text not null default 'created'
    check (status in ('created', 'practice', 'active', 'paused', 'completed', 'stopped')),
  stop_reason jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  foreign key (protocol_id, protocol_version) references public.protocols (id, version)
);

create index sessions_created_at on public.sessions (created_at desc);

-- Step events: the audit trail. Append-only ------------------------------------------
create table public.step_events (
  session_id uuid not null references public.sessions (id),
  event_seq integer not null check (event_seq >= 0),
  type text not null,
  step_id text,
  run text check (run in ('practice', 'real')),
  occurred_at timestamptz not null, -- the participant's clock (event.at)
  recorded_at timestamptz not null default now(), -- the server's clock
  event jsonb not null,
  primary key (session_id, event_seq)
);

create function public.step_events_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'step_events is append-only';
end $$;

create trigger step_events_append_only
  before update or delete on public.step_events
  for each row execute function public.step_events_append_only();

-- Evidence frames: metadata here, JPEG bytes in the private "evidence" bucket ---------
create table public.evidence_frames (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  step_id text not null,
  seq integer not null,
  captured_at timestamptz not null,
  storage_path text not null unique,
  vision_result jsonb,
  created_at timestamptz not null default now(),
  unique (session_id, step_id, seq)
);

-- Alerts (escalation; Phase 7) -------------------------------------------------------
create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.sessions (id),
  kind text not null check (kind in ('critical_miss', 'needs_human', 'no_response', 'nurse_called')),
  recipient jsonb not null,
  message text not null,
  status text not null default 'open' check (status in ('open', 'reviewed')),
  created_at timestamptz not null default now(),
  reviewed_at timestamptz
);

create index alerts_open on public.alerts (created_at desc) where status = 'open';

-- Flag reviews: the study team's sign-off on flagged events --------------------------
create table public.flag_reviews (
  session_id uuid not null,
  event_seq integer not null,
  reviewed_at timestamptz not null default now(),
  note text,
  primary key (session_id, event_seq),
  foreign key (session_id, event_seq) references public.step_events (session_id, event_seq)
);

-- RLS: on everywhere, no policies => anon/authenticated get nothing ------------------
alter table public.participants enable row level security;
alter table public.protocols enable row level security;
alter table public.sessions enable row level security;
alter table public.step_events enable row level security;
alter table public.evidence_frames enable row level security;
alter table public.alerts enable row level security;
alter table public.flag_reviews enable row level security;

revoke all on all tables in schema public from anon, authenticated;

-- Private storage bucket for evidence frames (served to the dashboard via signed URLs).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('evidence', 'evidence', false, 2097152, array['image/jpeg'])
on conflict (id) do nothing;
