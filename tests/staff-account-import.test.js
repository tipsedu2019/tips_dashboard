import test from "node:test";
import assert from "node:assert/strict";

import {
  ACCOUNT_EMAIL_DOMAIN,
  DEFAULT_INITIAL_PASSWORD,
  buildStaffAccountRecord,
  parseStaffCsvText,
  summarizeStaffAccounts,
} from "../scripts/lib/staffAccountImport.mjs";

test("buildStaffAccountRecord normalizes login ids into tipsedu emails", () => {
  assert.deepEqual(
    buildStaffAccountRecord({
      이름: "허승주",
      아이디: "010-9954-2979",
      역할: "teacher",
    }),
    {
      name: "허승주",
      loginId: "010-9954-2979",
      email: "010-9954-2979@tipsedu.co.kr",
      role: "teacher",
      password: DEFAULT_INITIAL_PASSWORD,
      mustChangePassword: true,
    },
  );

  assert.equal(ACCOUNT_EMAIL_DOMAIN, "tipsedu.co.kr");
});

test("parseStaffCsvText reads the uploaded staff CSV headers and builds a role summary", () => {
  const csvText = "\uFEFF이름,아이디,역할\n허승주,010-9954-2979,teacher\n정보영,010-5146-3075,admin\n";
  const accounts = parseStaffCsvText(csvText);

  assert.equal(accounts.length, 2);
  assert.equal(accounts[0].email, "010-9954-2979@tipsedu.co.kr");
  assert.equal(accounts[1].role, "admin");
  assert.deepEqual(summarizeStaffAccounts(accounts), {
    total: 2,
    byRole: {
      admin: 1,
      staff: 0,
      teacher: 1,
    },
  });
});

test("buildStaffAccountRecord rejects unsupported roles", () => {
  assert.throws(
    () =>
      buildStaffAccountRecord({
        이름: "테스트",
        아이디: "010-0000-0000",
        역할: "viewer",
      }),
    /Unsupported role/i,
  );
});
