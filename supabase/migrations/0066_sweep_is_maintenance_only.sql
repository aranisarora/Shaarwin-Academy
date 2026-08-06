-- `sweep_session_status()` is a maintenance job, and only cron ever calls it.
--
-- It has carried PUBLIC execute since 0006, back when it was dead code nobody
-- ran. Scheduling it in 0065 turned that into something real: a SECURITY
-- DEFINER function that writes to `class_sessions`, reachable over PostgREST by
-- an anonymous request. The damage it could do is bounded — it only closes
-- sessions whose hour has already passed, which is exactly what we want to
-- happen anyway — but "bounded" is not a reason to leave a write open to the
-- internet, and nothing in the app calls it: a repo-wide search finds only
-- comments and the cron entry.
--
-- cron runs as the job owner, so revoking the rest costs nothing.

revoke execute on function public.sweep_session_status() from public, anon, authenticated;
