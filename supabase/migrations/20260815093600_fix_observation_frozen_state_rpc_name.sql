begin;

-- PostgreSQL truncates identifiers to 63 bytes. The original 67-byte function
-- name therefore exists under a truncated catalog name and is not discoverable
-- through PostgREST using the source-level name.
alter function public.read_registration_observation_notification_delivery_frozen_state_v1(uuid, uuid)
  rename to read_registration_observation_delivery_frozen_state_v1;

commit;
