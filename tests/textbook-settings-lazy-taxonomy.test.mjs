import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (file) => readFile(new URL(file, root), "utf8");

test("settings workspace consumes lazy projected pages and the one atomic save boundary", async () => {
  const [workspace, hook, migration] = await Promise.all([
    read("src/features/textbooks/textbook-supplier-settings-workspace.tsx"),
    read("src/features/textbooks/use-textbook-settings-pages.ts"),
    read("supabase/migrations/20260630093000_textbook_sub_subject_id_default.sql"),
  ]);
  assert.match(workspace, /useTextbookSettingsPages/);
  assert.match(workspace, /saveTextbookSettingsDraft/);
  assert.match(workspace, /SubSubjectDraft \| null/);
  assert.match(workspace, /draftState\.subSubjectOperations/);
  assert.match(hook, /enabled: activeSection === "subSubjects"/);
  assert.match(hook, /listTextbookSubSubjectPage/);
  assert.match(hook, /textbooks:subsubjects/);
  assert.doesNotMatch(workspace, /\bsupabase\b/);
  assert.doesNotMatch(workspace, /supabase\.from|\.from\("textbook_/);
  assert.doesNotMatch(workspace, /\.upsert\(|\.delete\(|loadRows|loadSubSubjectRows/);
  assert.match(migration, /alter table public\.textbook_sub_subject_settings/);
  assert.match(migration, /alter column id set default gen_random_uuid\(\)/);
});

test("settings tabs keep explicit pointer fallbacks and real search semantics", async () => {
  const source = await read("src/features/textbooks/textbook-supplier-settings-workspace.tsx");
  for (const value of ["publishers", "suppliers", "subSubjects"]) {
    assert.match(source, new RegExp(`<TabsTrigger value="${value}" onClick=\\{\\(\\) => changeSection\\("${value}"\\)\\}`));
  }
  assert.match(source, /role="search" aria-label=\{toolbarPlaceholder\}/);
  assert.match(source, /type="search"/);
  assert.match(source, /autoComplete="off"/);
  assert.match(source, /enterKeyHint="search"/);
});

test("server relationship metadata and the same prepared page feed both renderers", async () => {
  const source = await read("src/features/textbooks/textbook-supplier-settings-workspace.tsx");
  assert.match(source, /supplier\.linkedPublisherNames/);
  assert.match(source, /supplier\.linkedPublisherCount - supplier\.linkedPublisherNames\.length/);
  assert.match(source, /publisher\.textbookCount/);
  assert.match(source, /data-testid="textbook-publishers-mobile-list"/);
  assert.match(source, /data-testid=\{`textbook-publisher-desktop-row-\$\{publisher\.id\}`\}/);
  assert.match(source, /data-testid="textbook-suppliers-mobile-list"/);
  assert.match(source, /data-testid=\{`textbook-supplier-desktop-row-\$\{supplier\.id\}`\}/);
  assert.match(source, /data-testid="textbook-subsubjects-mobile-list"/);
  assert.match(source, /data-testid=\{`textbook-subsubject-desktop-row-\$\{row\.id\}`\}/);
  assert.match(source, /<PublisherSupplierPicker/);
  assert.match(source, /<CommandInput/);
  assert.match(source, /<DataTablePagination/);
});
