import test from "node:test";
import assert from "node:assert/strict";

import {
  buildManagedLoginTransition,
  findDuplicateTransitionTargets,
} from "../scripts/lib/shortLoginMigration.mjs";

test("buildManagedLoginTransition shortens full-phone logins for managed users", () => {
  assert.deepEqual(
    buildManagedLoginTransition({
      loginId: "010-9954-2979",
      email: "010-9954-2979@tipsedu.co.kr",
    }),
    {
      currentEmail: "010-9954-2979@tipsedu.co.kr",
      currentLoginId: "010-9954-2979",
      nextEmail: "99542979@tipsedu.co.kr",
      nextLoginId: "99542979",
    },
  );
});

test("buildManagedLoginTransition keeps tipsedu as an explicit exception", () => {
  assert.equal(
    buildManagedLoginTransition({
      loginId: "tipsedu",
      email: "tipsedu@tipsedu.co.kr",
    }),
    null,
  );
});

test("buildManagedLoginTransition skips legacy non-phone logins", () => {
  assert.equal(
    buildManagedLoginTransition({
      loginId: "yeoyuasset",
      email: "yeoyuasset@naver.com",
    }),
    null,
  );
});

test("findDuplicateTransitionTargets detects conflicting short ids", () => {
  assert.deepEqual(
    findDuplicateTransitionTargets([
      { nextEmail: "99542979@tipsedu.co.kr" },
      { nextEmail: "99542979@tipsedu.co.kr" },
      { nextEmail: "51463075@tipsedu.co.kr" },
    ]),
    ["99542979@tipsedu.co.kr"],
  );
});
