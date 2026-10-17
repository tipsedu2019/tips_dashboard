import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, readdir } from 'node:fs/promises';

const migrations = new URL('../supabase/migrations/', import.meta.url);
const legacy = await readFile(new URL('20260923081138_timetable_plan_storage.sql', migrations), 'utf8');
const filename = (await readdir(migrations)).filter(name => name.endsWith('_timetable_plan_atomic_batch_save.sql')).sort().at(-1);
const source = filename ? await readFile(new URL(filename, migrations), 'utf8') : '';
const oldBody = legacy.match(/create function public\.mutate_timetable_plan_item_v1\(p_command jsonb\)[\s\S]*?as \$\$\n([\s\S]*?)\nend \$\$;/i)?.[1];
const receipt = " response:=dashboard_private.timetable_receipt_v1('item.'||op,p_command);if response is not null then return response;end if;\n";

test('atomic batch migration extends only the established item RPC without schema, ACL or role changes', () => {
    assert.ok(filename, 'a CLI-created append-only batch migration must exist');
    const definitions = [...source.matchAll(/create\s+(?:or\s+replace\s+)?function\s+([\w.]+)\s*\(/gi)].map(match => match[1]);
    assert.deepEqual(definitions, ['public.mutate_timetable_plan_item_v1']);
    assert.match(source, /returns jsonb language plpgsql volatile security definer set search_path='' as \$\$/);
    assert.doesNotMatch(source, /\b(?:alter\s+(?:table|role|function)|create\s+(?:table|role|policy)|grant|revoke|drop|set\s+(?:role|session\s+authorization))\b/i);
    assert.doesNotMatch(source, /errcode\s*=\s*'40001'/);
});

test('original save/delete branches remain bytewise intact behind the new operation', () => {
    assert.ok(oldBody);
    const receiptEnd = oldBody.indexOf(receipt) + receipt.length;
    assert.ok(receiptEnd > receipt.length);
    const oldPrelude = oldBody.slice(oldBody.indexOf('\nbegin\n') + 1, receiptEnd);
    const oldCompatibilityBranch = oldBody.slice(receiptEnd);
    assert.ok(source.includes(oldPrelude), 'authorization, lock, receipt order must stay identical');
    assert.ok(source.includes(oldCompatibilityBranch), 'old validation, save/delete, response and exception branches must stay identical');
});

test('batch candidates and baselines are validated before any batch writes', () => {
    const begin = source.indexOf(" if op='save_batch' then");
    const end = source.indexOf(' -- Existing single-item save/delete compatibility branch.');
    assert.ok(begin >= 0 && end > begin);
    const batch = source.slice(begin, end);
    const writeBoundary = batch.indexOf(' -- All baseline/final-candidate checks have passed; write the batch once.');
    assert.ok(writeBoundary > 0);
    const validation = batch.slice(0, writeBoundary);
    assert.doesNotMatch(validation, /\b(?:insert\s+into|update\s+public\.|delete\s+from)\b/i);
    assert.match(validation, /expectedChangeSequence/);
    assert.match(validation, /baseline_slots/);
    assert.match(validation, /candidate_slots/);
    assert.match(validation, /timetable_blocker_intersects_v2/);
    assert.match(validation, /sourceSlotId/);
    assert.match(validation, /datedUnresolvedOccupancies/);
    assert.match(validation, /datedSessions/);
    assert.doesNotMatch(batch, /perform dashboard_private\.validate_timetable_item_slots_v1/);
    assert.doesNotMatch(batch, /public\.mutate_timetable_plan_item_v1\s*\(/);
});

test('batch acknowledgements and authoritative snapshot share one receipt and sequence update', () => {
    const batch = source.slice(source.indexOf(" if op='save_batch' then"), source.indexOf(' -- Existing single-item save/delete compatibility branch.'));
    assert.match(batch, /'committedMetaRevision',p\.meta_revision/);
    assert.match(batch, /'committedChangeSequence',p\.change_sequence/);
    assert.match(batch, /'acknowledgements',acknowledgements/);
    assert.match(batch, /'snapshot',public\.get_timetable_plan_v1\(pid\)/);
    assert.match(batch, /timetable_record_receipt_v1\('item\.save_batch',p_command,response\)/);
    assert.equal((batch.match(/update public\.timetable_plans set change_sequence=change_sequence\+1/g) ?? []).length, 1);
    assert.doesNotMatch(batch, /\b(?:notify|http|net\.|notification|outbox|students|profiles|classes\s+set)\b/i);
});
