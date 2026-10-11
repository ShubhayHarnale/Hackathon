-- Trigger bodies use OLD/NEW only; lock their lookup path to avoid mutable defaults.
alter function public.protocols_published_immutable() set search_path = public;
alter function public.step_events_append_only() set search_path = public;
