import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const root = new URL("../", import.meta.url);

test("textbook management migration defines the unified ledger schema", async () => {
  const source = await readFile(
    new URL("supabase/migrations/20260429110000_textbook_management.sql", root),
    "utf8",
  );

  for (const table of [
    "textbook_publishers",
    "textbook_suppliers",
    "textbook_supplier_links",
    "textbook_inventory_locations",
    "textbook_purchase_orders",
    "textbook_purchase_order_lines",
    "textbook_stock_moves",
    "textbook_sales",
    "textbook_sale_lines",
    "textbook_stock_counts",
    "textbook_monthly_closings",
  ]) {
    assert.match(source, new RegExp(`create table if not exists public\\.${table}`));
    assert.match(source, new RegExp(`alter table public\\.${table} enable row level security`));
  }

  assert.match(source, /alter table public\.textbooks[\s\S]*isbn13 text[\s\S]*barcode text[\s\S]*subject text[\s\S]*source_notion_url text/);
  assert.match(source, /create unique index if not exists textbooks_isbn13_key[\s\S]*where isbn13 is not null/);
  assert.match(source, /create unique index if not exists textbooks_barcode_key[\s\S]*where barcode is not null/);
  assert.match(source, /requested_by text/);
  assert.match(source, /requested_quantity integer not null default 0/);
  assert.match(source, /status text not null default 'requested' check \(status in \('requested', 'ordered', 'partially_received', 'received', 'cancelled', 'returned'\)\)/);
  assert.match(source, /status text not null default 'draft' check \(status in \('draft', 'charged', 'paid', 'issued', 'cancelled'\)\)/);
  assert.match(source, /status text not null default 'charged' check \(status in \('charged', 'paid', 'issued', 'excluded', 'cancelled', 'returned'\)\)/);
  assert.match(source, /student_id uuid references public\.students\(id\) on delete set null/);
  assert.match(source, /class_id uuid references public\.classes\(id\) on delete set null/);
  assert.match(source, /textbook_id uuid not null references public\.textbooks\(id\)/);
  assert.match(source, /current_dashboard_role\(\) in \(''admin'', ''staff''\)/);
});

test("textbook schema supports publisher-level supplier settings", async () => {
  const migrationDir = new URL("supabase/migrations/", root);
  const migrationNames = await readdir(migrationDir);
  const combinedSource = (
    await Promise.all(
      migrationNames
        .filter((name) => name.endsWith(".sql"))
        .map((name) => readFile(new URL(name, migrationDir), "utf8")),
    )
  ).join("\n");

  assert.match(combinedSource, /create table if not exists public\.textbook_publisher_supplier_links/);
  assert.match(combinedSource, /publisher_id uuid not null references public\.textbook_publishers\(id\) on delete cascade/);
  assert.match(combinedSource, /supplier_id uuid not null references public\.textbook_suppliers\(id\) on delete cascade/);
  assert.match(combinedSource, /textbook_publisher_supplier_links_publisher_supplier_key/);
  assert.match(combinedSource, /alter table public\.textbook_publisher_supplier_links enable row level security/);
});

test("textbook purchase requests can be captured before master registration", async () => {
  const migrationDir = new URL("supabase/migrations/", root);
  const migrationNames = await readdir(migrationDir);
  const combinedSource = (
    await Promise.all(
      migrationNames
        .filter((name) => name.endsWith(".sql"))
        .map((name) => readFile(new URL(name, migrationDir), "utf8")),
    )
  ).join("\n");

  assert.match(combinedSource, /add column if not exists requested_textbook_title text not null default ''/);
  assert.match(combinedSource, /alter column textbook_id drop not null/);
  assert.match(combinedSource, /textbook_purchase_order_lines_requested_title_idx/);
});

test("textbook management schema separates student and teacher copy lifecycles", async () => {
  const migrationDir = new URL("supabase/migrations/", root);
  const migrationNames = await readdir(migrationDir);
  const combinedSource = (
    await Promise.all(
      migrationNames
        .filter((name) => name.endsWith(".sql"))
        .map((name) => readFile(new URL(name, migrationDir), "utf8")),
    )
  ).join("\n");

  for (const table of [
    "textbook_purchase_order_lines",
    "textbook_sale_lines",
    "textbook_stock_moves",
    "textbook_stock_counts",
  ]) {
    assert.match(combinedSource, new RegExp(`alter table public\\.${table}[\\s\\S]*add column if not exists copy_scope text`));
  }

  assert.match(combinedSource, /copy_scope in \('student', 'teacher'\)/);
  assert.match(combinedSource, /add column if not exists teacher_id uuid references public\.teacher_catalogs\(id\) on delete set null/);
  assert.match(combinedSource, /add column if not exists teacher_name text not null default ''/);
});

test("textbook migrations keep master writes compatible with updated_at payloads", async () => {
  const migrationDir = new URL("supabase/migrations/", root);
  const migrationNames = await readdir(migrationDir);
  const combinedSource = (
    await Promise.all(
      migrationNames
        .filter((name) => name.endsWith(".sql"))
        .map((name) => readFile(new URL(name, migrationDir), "utf8")),
    )
  ).join("\n");

  const textbookAlterStatements = combinedSource.match(/alter table public\.textbooks[\s\S]*?;/g) || [];
  assert.ok(
    textbookAlterStatements.some((statement) => /add column if not exists updated_at timestamptz/.test(statement)),
    "public.textbooks must add updated_at in its own alter statement",
  );
});

test("textbook teacher request migration creates only server-owned requested rows", async () => {
  const sql = await readFile(
    new URL("supabase/migrations/20260813053000_textbook_teacher_request_access.sql", root),
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /create or replace function public\.create_textbook_request_v1\(/);
  assert.match(sql, /v_actor_id uuid := auth\.uid\(\)/);
  assert.match(sql, /v_role text := coalesce\(public\.current_dashboard_role\(\), ''\)/);
  assert.match(sql, /v_role not in \('admin', 'staff', 'teacher'\)/);
  assert.match(sql, /status, requested_by, created_by[\s\S]*'requested', v_requester_name, v_actor_id/);
  assert.match(sql, /ordered_quantity, received_quantity[\s\S]*0, 0/);
  assert.match(sql, /copy_scope[\s\S]*'student'/);
  assert.match(sql, /copy_scope[\s\S]*'teacher'/);
  assert.match(sql, /revoke all on function public\.create_textbook_request_v1[\s\S]*from public, anon/);
  assert.match(sql, /grant execute on function public\.create_textbook_request_v1[\s\S]*to authenticated/);
});

test("textbook teacher request pgTAP covers RPC and direct-write authorization", async () => {
  const sql = await readFile(
    new URL("supabase/tests/textbook_teacher_request_access_test.sql", root),
    "utf8",
  );

  assert.match(sql, /^begin;/);
  assert.match(sql, /select no_plan\(\)/);
  assert.match(sql, /set local role authenticated/);
  assert.match(sql, /public\.create_textbook_request_v1\(/);
  assert.match(sql, /teacher RPC stores the server-owned requester and creator/);
  assert.match(sql, /teacher RPC creates requested-only zero-fulfillment lines/);
  assert.match(sql, /teacher RPC creates no stock moves/);
  assert.match(sql, /viewer cannot call the textbook request RPC/);
  assert.match(sql, /assistant cannot call the textbook request RPC/);
  assert.match(sql, /teacher cannot directly update a textbook request/);
  assert.match(sql, /teacher cannot directly delete a textbook request/);
  assert.match(sql, /teacher cannot directly update textbook request lines/);
  assert.match(sql, /teacher cannot directly delete textbook request lines/);
  assert.match(sql, /select \* from finish\(\);\s*rollback;\s*$/);
});
