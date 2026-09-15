import test from "node:test";
import assert from "node:assert/strict";
import { formatStudentContact } from "../src/lib/student-contact-display.ts";

test("only raw eleven-digit 010 numbers receive domestic display separators", () => {
  assert.equal(formatStudentContact("01012345678"), "010-1234-5678");
  for (const value of ["010-1234-5678", "+82 10 1234 5678", "+1-202-555-0123", "01112345678", "0101234567", "010123456789", " 01012345678 ", "미확인"]) {
    assert.equal(formatStudentContact(value), value);
  }
});

test("missing contacts use an em dash without changing the record", () => {
  for (const value of [null, undefined, ""]) assert.equal(formatStudentContact(value), "—");
  const record = Object.freeze({ contact: "01012345678" });
  assert.equal(formatStudentContact(record.contact), "010-1234-5678");
  assert.equal(record.contact, "01012345678");
});
