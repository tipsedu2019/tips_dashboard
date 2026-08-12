create policy "No direct client access"
on public.science_consultation_requests
as restrictive
for all
to anon, authenticated
using (false)
with check (false);