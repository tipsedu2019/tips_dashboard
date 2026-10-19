-- DESIGN ONLY: not a repository migration and not approved for production.
-- Execute only in the owned disposable synthetic database for this review.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '30s';
DO $preflight$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             WHERE n.nspname = 'public' AND p.proname = 'move_academic_event_dates_v1') THEN
    RAISE EXCEPTION USING ERRCODE = '42723', MESSAGE = 'academic_move_name_already_exists';
  END IF;
END;
$preflight$;

CREATE FUNCTION public.move_academic_event_dates_v1(
  p_event_id uuid,
  p_expected_date date,
  p_expected_end_date date,
  p_expected_note_sha256 text,
  p_next_date date,
  p_next_end_date date
) RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
CALLED ON NULL INPUT
SECURITY INVOKER
SET search_path = ''
SET lock_timeout = '2s'
AS $function$
DECLARE
  v_current_date date;
  v_stored_note text;
  v_current_hash text;
  v_original_date text;
  v_original_end text;
  v_next_date text;
  v_next_end text;
  v_written_id uuid;
  v_written_date date;
  v_written_note text;
  v_affected bigint;
-- DESIGN ONLY. Paste declarations inside a private helper / the single RPC.
-- No CREATE, schema change, table read/write, dynamic SQL, or public entry point.
-- Inputs supplied by the caller:
--   v_stored_note text (nullable, from the authorized, locked row)
--   v_original_date, v_original_end, v_next_date, v_next_end text
--     (snapshot/new inclusive day keys; strict validation occurs below)
-- Outputs, assigned only after all source checks:
v_moved_note text;
v_note_write_required boolean := false; -- JS patch has a note property, not byte inequality
v_stored_range_end date;

-- Internal names are deliberately prefixed; get_byte offsets are ZERO based.
am_days date[] := ARRAY[]::date[];
am_day_key text;
am_day date;
am_note_bytes bytea;
am_json_bytes bytea;
am_marker_bytes bytea := pg_catalog.convert_to('[[TIPS_META]]', 'UTF8');
am_marker_position integer; -- position() is ONE based; 0 means absent
am_json_start integer; -- ZERO-based offset into full note
am_json_length integer;
am_json_text text;
am_json_valid boolean;
am_cursor integer;
am_key_start integer;
am_key_end integer;
am_key text;
am_value_start integer;
am_value_end integer;
am_range_start integer := NULL;
am_range_end integer := NULL;
am_range_text text;
am_depth integer;
am_byte integer;
am_in_string boolean;

BEGIN
  IF pg_catalog.current_setting('request.method', true) IS DISTINCT FROM 'POST' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'academic_move_invalid_request';
  END IF;
  IF auth.uid() IS NULL OR public.current_dashboard_role() NOT IN ('admin', 'staff')
     OR public.current_dashboard_role() IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'academic_move_forbidden';
  END IF;
  IF p_event_id IS NULL OR p_expected_date IS NULL OR p_expected_end_date IS NULL
     OR p_next_date IS NULL OR p_next_end_date IS NULL
     OR p_expected_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
     OR p_expected_end_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
     OR p_next_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
     OR p_next_end_date NOT BETWEEN DATE '0001-01-01' AND DATE '9999-12-31'
     OR p_expected_end_date < p_expected_date OR p_next_end_date < p_next_date
     OR p_expected_end_date - p_expected_date <> p_next_end_date - p_next_date
     OR (p_expected_note_sha256 IS NOT NULL AND
         (pg_catalog.length(p_expected_note_sha256) <> 64
          OR p_expected_note_sha256 COLLATE "C" !~ '^[0-9a-f]{64}$')) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'academic_move_invalid_request';
  END IF;

  -- Match the existing agent API table-before-row order. This is UPDATE's
  -- ordinary table lock strength; unrelated ordinary writers remain compatible.
  LOCK TABLE public.academic_events IN ROW EXCLUSIVE MODE;
  SELECT e.date, e.note INTO v_current_date, v_stored_note
  FROM public.academic_events AS e WHERE e.id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'academic_move_conflict';
  END IF;
  v_current_hash := CASE WHEN v_stored_note IS NULL THEN NULL ELSE
    pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_stored_note, 'UTF8')), 'hex') END;
  IF v_current_date IS DISTINCT FROM p_expected_date
     OR v_current_hash COLLATE "C" IS DISTINCT FROM p_expected_note_sha256 COLLATE "C" THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'academic_move_conflict';
  END IF;
  v_original_date := pg_catalog.to_char(p_expected_date, 'YYYY-MM-DD');
  v_original_end := pg_catalog.to_char(p_expected_end_date, 'YYYY-MM-DD');
  v_next_date := pg_catalog.to_char(p_next_date, 'YYYY-MM-DD');
  v_next_end := pg_catalog.to_char(p_next_end_date, 'YYYY-MM-DD');
-- DESIGN ONLY; no database execution has been performed by this author.
-- Requires the caller inputs and parser.declarations.sql in the same block.
-- Must execute before UPDATE. Do not catch its failure and continue a mutation.
-- Business/source conflicts use fixed 22023, never transaction-conflict 40001.

BEGIN -- nested block sanitizes native parser/resource errors before RPC response
IF pg_catalog.current_setting('server_encoding') <> 'UTF8' THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_UNSUPPORTED_ENCODING';
END IF;

FOREACH am_day_key IN ARRAY ARRAY[v_original_date, v_original_end, v_next_date, v_next_end]
LOOP
  IF am_day_key IS NULL OR pg_catalog.length(am_day_key) <> 10
     OR am_day_key !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     OR pg_catalog.left(am_day_key, 5) = '0000-' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
  END IF;
  BEGIN
    am_day := pg_catalog.make_date(
      pg_catalog.substring(am_day_key, 1, 4)::integer,
      pg_catalog.substring(am_day_key, 6, 2)::integer,
      pg_catalog.substring(am_day_key, 9, 2)::integer);
  EXCEPTION WHEN datetime_field_overflow THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
  END;
  am_days := pg_catalog.array_append(am_days, am_day);
END LOOP;
IF am_days[2] < am_days[1] OR am_days[4] < am_days[3]
   OR am_days[2] - am_days[1] <> am_days[4] - am_days[3] THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
END IF;

IF v_stored_note IS NOT NULL THEN
  am_note_bytes := pg_catalog.convert_to(v_stored_note, 'UTF8');
  am_marker_position := position(am_marker_bytes in am_note_bytes);
  IF am_marker_position > 0 THEN
    am_json_start := am_marker_position - 1 + pg_catalog.octet_length(am_marker_bytes);
    am_json_bytes := pg_catalog.substring(am_note_bytes, am_json_start + 1);
    -- The existing helper rejects any second literal marker, even in a string.
    IF position(am_marker_bytes in am_json_bytes) > 0 THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
    END IF;
    am_json_length := pg_catalog.octet_length(am_json_bytes);
    am_json_text := pg_catalog.convert_from(am_json_bytes, 'UTF8');
    am_json_valid := true;
    BEGIN
      -- json input validation keeps unknown numeric lexemes and Unicode escapes.
      -- Do not substitute jsonb, json_each_text, or whole-document extraction.
      PERFORM am_json_text::json;
    EXCEPTION WHEN invalid_text_representation THEN
      -- JSON.parse also fails: preserve raw note; single-day-only below.
      am_json_valid := false;
    END;

    IF am_json_valid THEN
      am_cursor := 0;
      WHILE am_cursor < am_json_length LOOP
        EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_cursor) NOT IN (9, 10, 13, 32);
        am_cursor := am_cursor + 1;
      END LOOP;
      IF am_cursor < am_json_length AND pg_catalog.get_byte(am_json_bytes, am_cursor) = 123 THEN
        am_cursor := am_cursor + 1; -- validated top-level object '{'
        LOOP
          WHILE am_cursor < am_json_length LOOP
            EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_cursor) NOT IN (9, 10, 13, 32);
            am_cursor := am_cursor + 1;
          END LOOP;
          IF am_cursor >= am_json_length THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
          END IF;
          EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_cursor) = 125; -- '}'
          IF pg_catalog.get_byte(am_json_bytes, am_cursor) <> 34 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
          END IF;
          am_key_start := am_cursor;
          am_cursor := am_cursor + 1;
          LOOP
            IF am_cursor >= am_json_length THEN
              RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
            END IF;
            am_byte := pg_catalog.get_byte(am_json_bytes, am_cursor);
            IF am_byte = 92 THEN -- backslash: escaped quote cannot end the string
              am_cursor := am_cursor + 2;
            ELSE
              am_cursor := am_cursor + 1;
              EXIT WHEN am_byte = 34;
            END IF;
          END LOOP;
          am_key_end := am_cursor;
          am_key := NULL;
          -- A decoded 8-character 'rangeEnd' occupies at most 8*6+2 raw bytes.
          -- No unknown key is materialized at arbitrary length.
          IF am_key_end - am_key_start BETWEEN 10 AND 50 THEN
            BEGIN
              am_key := (pg_catalog.convert_from(pg_catalog.substring(
                am_json_bytes, am_key_start + 1, am_key_end - am_key_start), 'UTF8')::json #>> '{}');
            EXCEPTION WHEN untranslatable_character OR invalid_text_representation THEN
              -- A NUL/lone-surrogate key cannot equal ASCII rangeEnd in JS.
              am_key := NULL;
            END;
          END IF;
          WHILE am_cursor < am_json_length LOOP
            EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_cursor) NOT IN (9, 10, 13, 32);
            am_cursor := am_cursor + 1;
          END LOOP;
          IF am_cursor >= am_json_length OR pg_catalog.get_byte(am_json_bytes, am_cursor) <> 58 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
          END IF;
          am_cursor := am_cursor + 1; -- ':'
          WHILE am_cursor < am_json_length LOOP
            EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_cursor) NOT IN (9, 10, 13, 32);
            am_cursor := am_cursor + 1;
          END LOOP;
          am_value_start := am_cursor;
          am_depth := 0;
          am_in_string := false;
          WHILE am_cursor < am_json_length LOOP
            am_byte := pg_catalog.get_byte(am_json_bytes, am_cursor);
            IF am_in_string THEN
              IF am_byte = 92 THEN
                am_cursor := am_cursor + 2;
                CONTINUE;
              ELSIF am_byte = 34 THEN
                am_in_string := false;
              END IF;
            ELSIF am_byte = 34 THEN
              am_in_string := true;
            ELSIF am_depth = 0 AND am_byte IN (44, 125) THEN
              EXIT; -- top-level ',' or '}', outside strings
            ELSIF am_byte IN (91, 123) THEN
              am_depth := am_depth + 1;
            ELSIF am_byte IN (93, 125) THEN
              am_depth := am_depth - 1;
              IF am_depth < 0 THEN
                RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
              END IF;
            END IF;
            am_cursor := am_cursor + 1;
          END LOOP;
          IF am_cursor >= am_json_length OR am_in_string OR am_depth <> 0 THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
          END IF;
          am_value_end := am_cursor;
          WHILE am_value_end > am_value_start LOOP
            EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_value_end - 1) NOT IN (9, 10, 13, 32);
            am_value_end := am_value_end - 1;
          END LOOP;
          IF am_value_end <= am_value_start THEN
            RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
          END IF;
          IF am_key COLLATE "C" = 'rangeEnd' THEN
            IF am_range_start IS NOT NULL THEN
              -- Detect duplicate decoded top-level keys, including escaped aliases.
              -- Unknown duplicate keys and nested rangeEnd duplicates remain raw.
              RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
            END IF;
            am_range_start := am_value_start;
            am_range_end := am_value_end;
          END IF;
          EXIT WHEN pg_catalog.get_byte(am_json_bytes, am_cursor) = 125;
          am_cursor := am_cursor + 1; -- ','
        END LOOP;
      END IF;
    END IF;
  END IF;
END IF;

v_stored_range_end := NULL;
IF am_range_start IS NOT NULL AND am_range_end - am_range_start BETWEEN 12 AND 62
   AND pg_catalog.get_byte(am_json_bytes, am_range_start) = 34 THEN
  -- A ten-character date string is at most 10*6+2 raw bytes. Decode only it.
  BEGIN
    am_range_text := (pg_catalog.convert_from(pg_catalog.substring(
      am_json_bytes, am_range_start + 1, am_range_end - am_range_start), 'UTF8')::json #>> '{}');
  EXCEPTION WHEN untranslatable_character OR invalid_text_representation THEN
    am_range_text := NULL; -- NUL/lone surrogate cannot be a JS valid day key
  END;
  IF pg_catalog.length(am_range_text) = 10
     AND am_range_text ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
     AND pg_catalog.left(am_range_text, 5) <> '0000-' THEN
    BEGIN
      v_stored_range_end := pg_catalog.make_date(
        pg_catalog.substring(am_range_text, 1, 4)::integer,
        pg_catalog.substring(am_range_text, 6, 2)::integer,
        pg_catalog.substring(am_range_text, 9, 2)::integer);
    EXCEPTION WHEN datetime_field_overflow THEN
      v_stored_range_end := NULL;
    END;
  END IF;
END IF;

IF greatest(am_days[1], coalesce(v_stored_range_end, am_days[1])) <> am_days[2] THEN
  RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
END IF;

v_moved_note := v_stored_note;
v_note_write_required := v_stored_range_end IS NOT NULL;
IF v_note_write_required THEN
  -- ZERO-based [start,end) becomes substring(..., 1, start) / from end+1.
  -- Boundaries are ASCII JSON token boundaries, never inside a UTF8 code point.
  -- New end is validated ASCII, so this equals JSON.stringify(nextEnd).
  v_moved_note := pg_catalog.convert_from(
    pg_catalog.substring(am_note_bytes, 1, am_json_start + am_range_start)
      || pg_catalog.convert_to('"' || v_next_end || '"', 'UTF8')
      || pg_catalog.substring(am_note_bytes, am_json_start + am_range_end + 1), 'UTF8');
END IF;
EXCEPTION
  WHEN query_canceled THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'ACADEMIC_MOVE_RESOURCE_LIMIT';
  WHEN program_limit_exceeded THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'ACADEMIC_MOVE_RESOURCE_LIMIT';
  WHEN out_of_memory THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'ACADEMIC_MOVE_RESOURCE_LIMIT';
  WHEN data_exception THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'ACADEMIC_MOVE_INVALID_SOURCE';
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'ACADEMIC_MOVE_PARSE_FAILED';
END;

  IF v_note_write_required THEN
    UPDATE public.academic_events AS e SET date = p_next_date, note = v_moved_note
    WHERE e.id = p_event_id AND e.date = v_current_date
      AND e.note COLLATE "C" IS NOT DISTINCT FROM v_stored_note COLLATE "C"
    RETURNING e.id, e.date, e.note INTO v_written_id, v_written_date, v_written_note;
  ELSE
    UPDATE public.academic_events AS e SET date = p_next_date
    WHERE e.id = p_event_id AND e.date = v_current_date
      AND e.note COLLATE "C" IS NOT DISTINCT FROM v_stored_note COLLATE "C"
    RETURNING e.id, e.date, e.note INTO v_written_id, v_written_date, v_written_note;
  END IF;
  GET DIAGNOSTICS v_affected = ROW_COUNT;
  IF v_affected <> 1 OR v_written_id IS DISTINCT FROM p_event_id
     OR v_written_date IS DISTINCT FROM p_next_date
     OR v_written_note COLLATE "C" IS DISTINCT FROM v_moved_note COLLATE "C" THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'academic_move_conflict';
  END IF;
  RETURN pg_catalog.jsonb_build_object(
    'id', v_written_id, 'date', v_next_date, 'endsAt', v_next_end,
    'noteSha256', CASE WHEN v_written_note IS NULL THEN NULL ELSE
      pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_written_note, 'UTF8')), 'hex') END);
EXCEPTION
  WHEN SQLSTATE 'PT409' THEN
    RAISE EXCEPTION USING ERRCODE = 'PT409', MESSAGE = 'academic_move_conflict';
  WHEN insufficient_privilege THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'academic_move_forbidden';
  WHEN SQLSTATE '22023' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'academic_move_invalid_request';
  WHEN lock_not_available THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'academic_move_busy';
  WHEN query_canceled THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'academic_move_cancelled';
  WHEN assert_failure THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'academic_move_failed';
  WHEN OTHERS THEN
    RAISE EXCEPTION USING ERRCODE = SQLSTATE, MESSAGE = 'academic_move_failed';
END;
$function$;

ALTER FUNCTION public.move_academic_event_dates_v1(uuid,date,date,text,date,date) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.move_academic_event_dates_v1(uuid,date,date,text,date,date)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.move_academic_event_dates_v1(uuid,date,date,text,date,date)
  TO authenticated;
-- Abort instead of silently inheriting broader default function privileges.
DO $acl_check$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      coalesce(p.proacl, pg_catalog.acldefault('f', p.proowner))) a
    WHERE p.oid = 'public.move_academic_event_dates_v1(uuid,date,date,text,date,date)'::regprocedure
      AND (a.grantee NOT IN (p.proowner, 'authenticated'::regrole::oid)
           OR (a.grantee = 'authenticated'::regrole::oid AND a.is_grantable))
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'academic_move_unexpected_acl';
  END IF;
END;
$acl_check$;
COMMIT;
