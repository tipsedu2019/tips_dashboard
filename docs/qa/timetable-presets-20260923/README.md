# Timetable preset UI — local evidence, 2026-09-23

Task6 verifies the shared preset editor in teacher-weekly, classroom-weekly, daily-teacher and daily-classroom views. These are synthetic localhost records, not production data or deployment evidence.

## Evidence

- `browser-results.json` and `1440/390-light/dark-0..3.png`: all 16 view/viewport/theme combinations passed. Each rendered the same 14 unique canonical slots, with no page overflow or JavaScript page errors. The four `operational-*.png` images retain the operational reference view. View indices: 0 teacher-weekly, 1 classroom-weekly, 2 daily-teacher, 3 daily-classroom.
- `pointer-results.json`: actual browser pointer move and palette drop in every view; same-time cross-resource move; unchanged sibling slot IDs/minutes; resize by five minutes; Escape, pointercancel and capture-loss cancellation without save; centered cell click uses its labeled start and the selected lesson duration; 60-character form input; exact end24:00; uncertain-save retry preserves identical command/key; conclusive rejection correction uses a new key. `pointer-interaction-mobile.png` records the isolated touch context, whose native scroll was exercised through CDP touch events.
- `panel-export.png` is the **actual downloaded image**, not a page screenshot: 3369×3369, 499332 bytes. Preset name, view, timestamp, Monday–Sunday and the complete09:00–24:00 axis are visible without cropping. `panel-export.json` contains the actual filename. Export uses minimum1123px width and scale3, and hides editing handles.

## Independent manual checks

Root used CUA against the same loopback app and actual isolated DB. The original Monday slot was edited to09:10–10:10 while Wednesday17:13–18:13 and both IDs stayed intact; actual resource drags succeeded in all four views. Friday and Saturday23:30–24:00 were saved atomically and reread as endMinute1440. A teacher conflict retained form inputs/focus; Escape→continue retained them; five ordered recommendations were usable. At390px the Sheet selected an item, closed, then cell/form placement added Tuesday while preserving Monday/Wednesday. Empty preset creation, rename, clone, archive(readonly), restore(editable) were checked. Root independently inspected the actual exported PNG. Detailed contemporaneous notes are in the ignored Task6 working report directory.

## Reproduction and boundaries

The existing annual fixture server is extended by `scripts/qa/timetable-plan-rpc-bridge.mjs`. It allowlists typed RPCs, fixes the synthetic actor, and calls PostgreSQL through docker exec in network-none container `tips_timetable_20260923`. It has no database-network or production fallback. `scripts/qa/timetable-plan-fixture-seed.sql` supplies the matching operational labels and DB shadow records; seed only the designated synthetic fixture, never an unrelated database. The original annual fixture remains available.

With Next on3261 and the fixture proxy/API on3260/3262:

```sh
node scripts/qa/timetable-plan-browser.mjs
node scripts/qa/timetable-plan-pointer-browser.mjs
node scripts/qa/timetable-plan-export-browser.mjs
```

Scripts launch their own isolated Chromium, not the user's existing browser. Pointer QA creates its own synthetic plan and archives it after success. Runtime uses the existing bundled Playwright package; no package install is required.

The bridge has no Supabase Realtime provider; WebSocket delivery is unverified. Product watcher code was preserved; fixture DB save/read and polling/focus paths were checked separately. Sharing across actual actors, Task7 transfer, Task9 import, CI/build, production migrations/deployment and operational promotion are separate gates. No sends were performed.
