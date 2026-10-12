import { readFile, readdir } from "node:fs/promises";

// Resolve the final definition from the ordered migration chain, including the
// patch under test. This probe never reads an environment file or production DB.
export async function finalTimetableFunction(root, name) {
  let final;
  for (const file of (await readdir(`${root}/supabase/migrations`)).filter(f => f.endsWith(".sql")).sort()) {
    const source = await readFile(`${root}/supabase/migrations/${file}`, "utf8");
    const marker = new RegExp(`create\\s+(?:or\\s+replace\\s+)?function\\s+dashboard_private\\.${name}\\s*\\(`, "ig");
    for (const match of source.matchAll(marker)) {
      const start = match.index;
      const body = /\bas\s+(\$[a-z_]*\$)/i.exec(source.slice(start));
      if (!body) throw new Error(`missing function body: ${name}`);
      const end = source.indexOf(`${body[1]};`, start + body.index + body[0].length);
      if (end < 0) throw new Error(`missing function end: ${name}`);
      final = { file, sql: source.slice(start, end + body[1].length + 1) };
    }
  }
  if (!final) throw new Error(`missing final function: ${name}`);
  return final;
}

export async function timetableValidationProbeSetup(root) {
  const names = ["timetable_occupancy_key_v1", "timetable_intersects_v1", "timetable_blocker_intersects_v2",
    "timetable_effective_date_v1", "validate_timetable_operating_reference_v1", "assert_timetable_operational_conflicts_v1"];
  const definitions = await Promise.all(names.map(name => finalTimetableFunction(root, name)));
  return { definitions, sql: `
    create extension if not exists pgtap;
    create schema dashboard_private;
    create table public.classes(id uuid primary key,name text);
    create table public.teacher_catalogs(id uuid primary key,name text);
    create table public.classroom_catalogs(id uuid primary key,name text);
    create table dashboard_private.timetable_operating_write_baselines(transaction_id bigint primary key,reference jsonb);
    create function dashboard_private.read_timetable_operating_reference_v1() returns jsonb language sql as $$select '{}'::jsonb$$;
    -- The focused probe has no approved past-state-correction context. The full
    -- schema suite tests the real correction helper and all writer/ACL contracts.
    create function dashboard_private.past_lesson_state_correction_allows_blocker_v1(jsonb,jsonb,jsonb)
      returns boolean language sql as $$select false$$;
    ${definitions.map(({ sql }) => sql).join("\n")}
  ` };
}
