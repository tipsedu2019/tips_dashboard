import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationDirectory = new URL("../supabase/migrations/", import.meta.url);
const baselineName = "20260814035710_operations_scoped_reads.sql";
const draftName = "20261006183148_operations_annual_board_range.sql";
const definitionPattern = /create(?: or replace)? function public\.get_operations_annual_board_v1\(p_academic_year integer\)[\s\S]*?\n\$function\$;/gi;
const definitions = [];

for (const name of (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort()) {
  const sql = await readFile(new URL(name, migrationDirectory), "utf8");
  for (const match of sql.matchAll(definitionPattern)) definitions.push({ name, body: match[0], sql });
}

const baseline = definitions.find(({ name }) => name === baselineName);
const final = definitions.at(-1);

const newEndProjection = `      case
        when stored_range.range_end >= event.date then stored_range.range_end
        else event.date
      end as end_date,`;
const newRangeJoin = `    cross join lateral (
      select case
        when pg_catalog.jsonb_typeof(metadata.event_meta -> 'rangeEnd') = 'string'
          and (metadata.event_meta ->> 'rangeEnd') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
          and pg_catalog.pg_input_is_valid(metadata.event_meta ->> 'rangeEnd', 'date')
        then (metadata.event_meta ->> 'rangeEnd')::date
        else null::date
      end as range_end
    ) as stored_range
`;

test("ordered migration chain selects the additive annual RPC definition", () => {
  assert.deepEqual(definitions.map(({ name }) => name), [baselineName, draftName]);
  assert.equal(final.name, draftName);
  assert.match(final.body, /^create or replace function/);
  assert.equal(final.sql.replace(/^--.*\n/gm, "").trim(), final.body);
});

test("annual read draft preserves every original expression outside the inclusive range projection", () => {
  const restored = final.body
    .replace("create or replace function", "create function")
    .replace(newEndProjection, "      event.date as end_date,")
    .replace(newRangeJoin, "")
    .replace("          'rangeEnd', bounded_entries.event_meta ->> 'rangeEnd',\n", "");

  assert.equal(restored, baseline.body);
  assert.match(final.body, /stable\nsecurity invoker\nset search_path = ''/);
  assert.doesNotMatch(final.sql, /\b(?:insert into|update public\.|delete from|alter table|drop function|grant|revoke)\b/i);
  assert.match(final.body, /operations_academic_year_invalid' using errcode = '22023'/);
});

test("stored range cast is guarded inside CASE and reversed or missing ends retain the start", () => {
  assert.equal(final.body.split(newRangeJoin).length - 1, 1);
  assert.equal(final.body.split(newEndProjection).length - 1, 1);
  assert.match(final.body, /'displayMeta', pg_catalog\.jsonb_strip_nulls\(pg_catalog\.jsonb_build_object\(\n\s*'rangeEnd', bounded_entries\.event_meta ->> 'rangeEnd'/);
  assert.match(final.body, /when bounded_entries\.start_date = bounded_entries\.end_date then bounded_entries\.start_date::text\n\s*else bounded_entries\.start_date::text \|\| ' ~ ' \|\| bounded_entries\.end_date::text/);
  assert.doesNotMatch(final.body, /range_end\s*[+-]\s*(?:1|interval)/i);
});

test("subject detail dates and fallback identities keep their original producer contracts", () => {
  const subjectBody = final.body.split("  ), subject_events as (")[1].split("  ), fallback_subject_entries as (")[0];
  const fallbackBody = final.body.split("  ), fallback_subject_entries as (")[1].split("  ), bounded_entries as (")[0];

  assert.match(subjectBody, /coalesce\(detail\.exam_date, event\.date\) as start_date,\n\s*coalesce\(detail\.exam_date, event\.date\) as end_date/);
  assert.doesNotMatch(subjectBody, /stored_range/);
  assert.match(fallbackBody, /base\.start_date,\n\s*base\.end_date/);
  assert.match(final.body, /'examDateLabel', bounded_entries\.start_date/);
  assert.match(final.body, /'parentEventId', bounded_entries\.parent_event_id/);
  assert.match(final.body, /'sourceKind', bounded_entries\.source_kind/);
});
