import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("textbook notion import covers both stock tables and publisher tables", async () => {
  const importerSource = await readFile(
    new URL("scripts/import-textbook-notion-data.mjs", root),
    "utf8",
  );

  assert.match(importerSource, /englishStock/);
  assert.match(importerSource, /mathStock/);
  assert.match(importerSource, /englishPublishers/);
  assert.match(importerSource, /mathPublishers/);
  assert.match(importerSource, /e361ef13-bef2-4439-b256-1de4a4ac8d80/);
  assert.match(importerSource, /ac1e8238-ff81-43e4-940c-fcfdab9a7b9f/);
  assert.match(importerSource, /fd272781-35ae-4b5f-a62d-b938187b4c96/);
  assert.match(importerSource, /4b425166-a433-4930-a6ec-8a85adec9e13/);
  assert.match(importerSource, /textbook_publisher_supplier_links/);
  assert.match(importerSource, /source_notion_url/);
  assert.match(importerSource, /입시플라이", "math", "현대서점/);
  assert.match(importerSource, /동아출판", "english", "우생당/);
  assert.match(importerSource, /EBS", "math", "우생당/);
});

test("textbook notion import completes publisher supplier links", async () => {
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260429151000_complete_textbook_publisher_supplier_links.sql", root),
    "utf8",
  );

  assert.match(migrationSource, /textbook_publisher_supplier_links/);
  assert.match(migrationSource, /\('입시플라이', '현대서점'\)/);
  assert.match(migrationSource, /\('수경출판사', '영주교육'\)/);
  assert.match(migrationSource, /\('EBS', '우생당'\)/);
});

test("textbook settings exposes publisher supplier management", async () => {
  const navigationSource = await readFile(new URL("src/lib/navigation.ts", root), "utf8");
  const pageSource = await readFile(
    new URL("src/app/admin/settings/textbook-suppliers/page.tsx", root),
    "utf8",
  );
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-supplier-settings-workspace.tsx", root),
    "utf8",
  );

  assert.match(navigationSource, /\/admin\/settings\/textbook-suppliers/);
  assert.match(navigationSource, /교재 설정/);
  assert.match(pageSource, /TextbookSupplierSettingsWorkspace/);
  assert.match(workspaceSource, /textbook_publishers/);
  assert.match(workspaceSource, /textbook_suppliers/);
  assert.match(workspaceSource, /textbook_publisher_supplier_links/);
  assert.match(workspaceSource, /출판사/);
  assert.match(workspaceSource, /총판/);
  assert.match(workspaceSource, /세부과목/);
});

test("textbook supplier settings shows publisher textbook counts and selectable subjects", async () => {
  const workspaceSource = await readFile(
    new URL("src/features/textbooks/textbook-supplier-settings-workspace.tsx", root),
    "utf8",
  );

  assert.match(workspaceSource, /publisherTextbookCounts/);
  assert.match(workspaceSource, /textbookResult/);
  assert.match(workspaceSource, /\.from\("textbooks"\)/);
  assert.match(workspaceSource, /function PublisherSubjectSelect/);
  assert.match(workspaceSource, /togglePublisherSubject/);
  assert.match(workspaceSource, /SUBJECT_OPTIONS/);
  assert.match(workspaceSource, /getPublisherTextbookCount/);
  assert.match(workspaceSource, /formatQuantity\(getPublisherTextbookCount\(publisher\)\)/);
  assert.doesNotMatch(workspaceSource, /event\.target\.value\.split\(","\)/);
});

test("textbook publisher cleanup merges sukyung variants into sukyung publisher company", async () => {
  const migrationSource = await readFile(
    new URL("supabase/migrations/20260430090000_merge_sukyung_textbook_publisher.sql", root),
    "utf8",
  ).catch(() => "");

  assert.match(migrationSource, /merge_sukyung_textbook_publisher/);
  assert.match(migrationSource, /textbook_publishers/);
  assert.match(migrationSource, /textbook_publisher_supplier_links/);
  assert.match(migrationSource, /textbook_supplier_links/);
  assert.match(migrationSource, /textbooks/);
  assert.match(migrationSource, /publisher_id = keeper\.id/);
  assert.match(migrationSource, new RegExp("publisher = '\\uC218\\uACBD\\uCD9C\\uD310\\uC0AC'", "u"));
  assert.match(migrationSource, new RegExp("name = '\\uC218\\uACBD\\uCD9C\\uD310'", "u"));
  assert.match(migrationSource, new RegExp("name = '\\uC218\\uACBD\\uCD9C\\uD310\\uC0AC'", "u"));
  assert.match(migrationSource, /delete from public\.textbook_publishers/);
});
