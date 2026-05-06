import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

test("textbook settings loads editable taxonomy only when that tab is opened", async () => {
  const source = await readFile(
    new URL("src/features/textbooks/textbook-supplier-settings-workspace.tsx", root),
    "utf8",
  );

  assert.match(source, /useState<TextbookSubSubjectSettingRecord\[\]>\(\(\) =>\s*mergeTextbookSubSubjectSettings\(\[\]\)/);
  assert.match(source, /const loadSubSubjectRows = useCallback/);
  assert.match(source, /activeSection === "subSubjects"/);
  assert.match(source, /void loadSubSubjectRows\(\)/);
  assert.match(source, /const shouldPersistSubSubjects = subSubjectsTouched \|\| deletedSubSubjectIds\.length > 0/);
  assert.match(source, /shouldPersistSubSubjects && nextSubSubjects\.length > 0/);

  const loadRowsBody = source.slice(source.indexOf("const loadRows = useCallback"), source.indexOf("const loadSubSubjectRows"));
  assert.doesNotMatch(loadRowsBody, /textbook_sub_subject_settings/);
});

test("textbook settings tabs keep explicit pointer fallbacks", async () => {
  const source = await readFile(
    new URL("src/features/textbooks/textbook-supplier-settings-workspace.tsx", root),
    "utf8",
  );

  assert.match(
    source,
    /<TabsTrigger\s+value="publishers"\s+onClick=\{\(\) => handleSectionChange\("publishers"\)\}/,
  );
  assert.match(
    source,
    /<TabsTrigger\s+value="suppliers"\s+onClick=\{\(\) => handleSectionChange\("suppliers"\)\}/,
  );
  assert.match(
    source,
    /<TabsTrigger\s+value="subSubjects"\s+onClick=\{\(\) => handleSectionChange\("subSubjects"\)\}/,
  );
});

test("textbook supplier tab shows linked publisher names instead of count-only spacing", async () => {
  const source = await readFile(
    new URL("src/features/textbooks/textbook-supplier-settings-workspace.tsx", root),
    "utf8",
  );

  assert.match(source, /const publisherNamesBySupplierId = useMemo/);
  assert.match(source, /const visiblePublisherNames = linkedPublisherNames\.slice\(0, 3\)/);
  assert.match(source, /hiddenPublisherCount > 0/);
  assert.match(source, /<TableHead className=\{`w-\[42%\] \$\{settingsTableHeadClass\}`\}>총판<\/TableHead>/);
  assert.match(source, /<TableHead className=\{`w-\[46%\] \$\{settingsTableHeadClass\}`\}>연결 출판사<\/TableHead>/);
});
