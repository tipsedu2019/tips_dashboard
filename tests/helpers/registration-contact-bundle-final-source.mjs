import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFileSync, readdirSync } from "node:fs"

const hash = (value) => createHash("sha256").update(value).digest("hex")
const root = new URL("../../supabase/migrations/", import.meta.url)
const sourcePins = [
  ["20260819012301_registration_customer_message_bundles.sql", "ae876875c6744b1967b5cee04886a4527d501cf3c777e996b018c9d69ba7ff04"],
  ["20260819012401_fix_registration_customer_message_bundle_coalesce.sql", "8295101faafb8feb37984a076b27ba93408e9ee22aeb98c7910066c9697e7db6"],
  ["20260901110900_registration_archived_subject_delivery_fence.sql", "ad75e49923afa71d3bab42b977f6e7877ce5bf643adb74614984549b934ef08c"],
]
export function one(source, before, after) {
  assert.equal(source.split(before).length - 1, 1, "exact sequential source anchor")
  return source.replace(before, after)
}
/** Ordered textual reconstruction only: never PostgreSQL parsing or execution. */
export function readFinalContactBundleSources() {
  const sources = sourcePins.map(([file, pin]) => {
    const source = readFileSync(new URL(file, root), "utf8")
    assert.equal(hash(source), pin, `exact baseline migration ${file}`)
    return source
  })
  const names = ["dashboard_private.collect_registration_customer_message_bundle_items_v1",
    "dashboard_private.materialize_registration_customer_message_bundle_v1", "public.resolve_registration_customer_message_bundle_source_v1"]
  const bodies = new Map(names.map(name => {
    const pattern = new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?as \\$\\$([\\s\\S]*?)\\$\\$;`, "u")
    return [name, sources[0].match(pattern)?.[1]]
  }))
  for (const [name, body] of bodies) { assert.ok(body, name); bodies.set(name, body.replaceAll("pg_catalog.coalesce", "coalesce")) }
  const collector = names[0]
  let body = bodies.get(collector)
  for (const activity of ["level_test", "consultation"]) {
    const anchor = `join public.ops_registration_subject_tracks track on track.id = ${activity}.track_id`
    body = one(body, anchor, `${anchor}\n     and track.task_id = p_task_id\n     and track.archived_at is null`)
  }
  const observation = "join public.ops_registration_appointments appointment on appointment.id = observation.appointment_id"
  body = one(body, observation, `${observation}\n    join public.ops_registration_subject_tracks track\n      on track.id = observation.track_id\n     and track.task_id = p_task_id\n     and track.archived_at is null`)
  bodies.set(collector, body)
  const marker = "  select detail.customer_message_recipient_revision into strict v_recipient_revision"
  const materializer = sources[2].match(/\$replacement\$([\s\S]*?)\$replacement\$/gu)
    .map(literal => literal.slice("$replacement$".length, -"$replacement$".length))
    .find(literal => literal.startsWith("  perform track.id"))
  assert.ok(materializer)
  bodies.set(names[1], one(bodies.get(names[1]), marker, materializer))
  const expected = ["fad5fd10d5cbab8bf7e0314dadd3fb8b2c9b8f9d0fce1536ea62ef7bf72667e0",
    "9a97a489b8c9552d130b80de0c18c2fc12878dee54881f838a9b86c773704705",
    "ca7efd48fcf71726f141c1505c8e21b2e5ded84edf28cac0a5895b4682a459c4"]
  names.forEach((name, index) => assert.equal(hash(bodies.get(name)), expected[index], `final reconstructed ${name}`))
  // An unreviewed later direct definition or pg_get_functiondef target rewrite
  // must not silently reuse these older pins.
  for (const file of readdirSync(root).filter(file => file.endsWith(".sql") && file > sourcePins.at(-1)[0])) {
    const source = readFileSync(new URL(file, root), "utf8")
    for (const name of names) {
      const escaped = name.replaceAll(".", "\\.")
      assert.doesNotMatch(source, new RegExp(`create(?: or replace)? function ${escaped}\\(|pg_get_functiondef\\([\\s\\S]{0,180}'${escaped}\\(`, "iu"), `later target rewrite requires review: ${file}`)
    }
  }
  return bodies
}
