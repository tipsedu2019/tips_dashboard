import assert from "node:assert/strict";
import test from "node:test";
import {
  ContentValidationError,
  normalizeDraft,
  normalizeChanges,
  maskPublicName,
} from "../src/features/public-content/content-contract.ts";
import {
  approvedSeedChanges,
  createContentAdminHandlers,
  createPublicContentHandler,
  servePublicContentAsset,
} from "../src/features/public-content/server/content-routes.ts";
const id = "a0000000-0000-4000-8000-000000000001",
  requestId = "b0000000-0000-4000-8000-000000000001";
const review = (data = {}) => ({
  kind: "review",
  data: {
    name: "홍길동",
    role: "학생",
    content: "원문을 그대로 보존합니다.",
    ...data,
  },
  sortOrder: 0,
  isPublished: false,
});
test("public names cannot smuggle raw names behind an existing mask", () => {
  for (const [input, expected] of [
    ["김ㅇ민", "김ㅇ민"],
    ["김*수, 홍길동", "김*수, 홍*동"],
    ["홍길동(홍*동)", "홍*동"],
    ["홍길동ㅇ", "홍*동"],
    ["김*수, 박*영", "김*수, 박*영"],
    ["김*수 / 홍*동", "김*수 / 홍*동"],
    ["김*수 , 홍*동", "김*수 , 홍*동"],
  ])
    assert.equal(maskPublicName(input), expected);
});
test("review whitespace and 8000-character Korean text retain exact content", () => {
  for (const content of ["  첫 줄\n둘째 줄  ", "가".repeat(8000)])
    assert.equal(normalizeDraft(review({ content })).data.content, content);
  assert.throws(
    () => normalizeDraft(review({ content: " \n " })),
    ContentValidationError,
  );
});
test("scores stay strings and blank scores are not changed to zero", () => {
  const base = {
    kind: "result",
    data: {
      name: "학생",
      year: "2026",
      exam: "기말",
      school: "모의고",
      grade: "고1",
      subject: "수학",
      score: "",
      rating: "1등급",
    },
    sortOrder: 0,
    isPublished: true,
  };
  assert.equal(normalizeDraft(base).data.score, "");
  assert.equal(
    normalizeDraft({ ...base, data: { ...base.data, score: "95.8" } }).data
      .score,
    "95.8",
  );
  assert.throws(
    () => normalizeDraft({ ...base, data: { ...base.data, score: "101" } }),
    ContentValidationError,
  );
});
test("only approved local asset paths or typed upload references are accepted", () => {
  const base = {
    kind: "teacher",
    data: {
      name: "모의 교사",
      subject: "",
      portraitUrl: "/assets/landing/v14/teachers/02/frame-000.webp",
    },
    sortOrder: 0,
    isPublished: false,
  };
  assert.equal(normalizeDraft(base).data.subject, "");
  for (const portraitUrl of [
    "https://example.org/photo.png",
    "javascript:alert(1)",
    "/assets/landing/v14/../secret.png",
    "storage:teachers/a0000000-0000-4000-8000-000000000001.mp4",
  ])
    assert.throws(
      () => normalizeDraft({ ...base, data: { ...base.data, portraitUrl } }),
      ContentValidationError,
    );
});
test("mutation snapshot rejects duplicate IDs, bad version, hidden fields and mismatched types", () => {
  const change = { id, expectedVersion: 0, action: "save", entry: review() };
  assert.equal(
    normalizeChanges({ requestId, changes: [change] }).changes[0].entry.data
      .name,
    "홍*동",
  );
  for (const changes of [
    [change, change],
    [{ ...change, expectedVersion: -1 }],
    [
      {
        ...change,
        entry: { ...review(), data: { ...review().data, rawName: "private" } },
      },
    ],
    [{ ...change, entry: { ...review(), isPublished: "true" } }],
  ])
    assert.throws(
      () => normalizeChanges({ requestId, changes }),
      ContentValidationError,
    );
});
test("approved seed preserves all 3921 source records and stable identities", () => {
  const a = approvedSeedChanges(),
    b = approvedSeedChanges();
  assert.equal(a.length, 3921);
  assert.deepEqual(a, b);
  assert.equal(new Set(a.map((row) => row.id)).size, 3921);
  assert.equal(a.filter((row) => row.entry.kind === "result").length, 3804);
});
const env = {
  PUBLIC_CONTENT_MANAGEMENT_ENABLED: "true",
  PUBLIC_CONTENT_PUBLIC_READ_ENABLED: "true",
};
const req = (body, origin = "http://localhost:3190") =>
  new Request("http://localhost:3190/api/admin/public-content", {
    method: "POST",
    headers: {
      Authorization: "Bearer fixture",
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify(body),
  });
test("only an authenticated actual admin can apply, and cross-origin requests never call store", async () => {
  let calls = 0;
  const store = {
    apply: async () => {
      calls++;
      return {};
    },
  };
  for (const identity of [{ status: 401 }, { role: "staff", store }]) {
    const response = await createContentAdminHandlers({
      env,
      authenticate: async () => identity,
    }).entries(req({ requestId, changes: [] }));
    assert.equal(response.status, "status" in identity ? 401 : 403);
  }
  const handler = createContentAdminHandlers({
    env,
    authenticate: async () => ({ role: "admin", store }),
  }).entries;
  assert.equal(
    (
      await handler(
        req({ requestId, changes: [] }, "https://not-allowed.example"),
      )
    ).status,
    403,
  );
  assert.equal(calls, 0);
});
test("server repeats review validation before a single atomic apply", async () => {
  let captured;
  const handler = createContentAdminHandlers({
    env,
    authenticate: async () => ({
      role: "admin",
      store: {
        apply: async (...args) => {
          captured = args;
          return { applied: 1 };
        },
      },
    }),
  }).entries;
  const response = await handler(
    req({
      requestId,
      changes: [{ id, expectedVersion: 0, action: "save", entry: review() }],
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(captured[0], requestId);
  assert.equal(captured[1][0].entry.data.name, "홍*동");
});
test("public kind read respects successful empty data, masks names and projects no draft/private data", async () => {
  const row = {
    id,
    kind: "review",
    data: {
      ...normalizeDraft(review()).data,
      name: "김*수, 홍길동",
      privateNote: "never",
    },
    sortOrder: 0,
    isPublished: true,
  };
  let requested;
  const handler = createPublicContentHandler({
    env,
    read: async (kind) => {
      requested = kind;
      return [row, { ...row, id: "draft", isPublished: false }];
    },
  });
  const response = await handler(
    new Request("http://localhost/api/public-content?kind=reviews"),
  );
  const data = await response.json();
  assert.equal(requested, "review");
  assert.equal(data.records.length, 1);
  assert.equal(data.records[0].name, "김*수, 홍*동");
  assert.equal(data.records[0].privateNote, undefined);
  assert.match(response.headers.get("cache-control"), /s-maxage=60/);
  const empty = await createPublicContentHandler({ env, read: async () => [] })(
    new Request("http://localhost/api/public-content?kind=teachers&refresh=1"),
  );
  assert.deepEqual((await empty.json()).records, []);
  assert.equal(empty.headers.get("cache-control"), "no-store");
});
test("disabled public reading and failed source are unavailable, never a fabricated empty success", async () => {
  for (const handler of [
    createPublicContentHandler({ env: {}, read: async () => [] }),
    createPublicContentHandler({
      env,
      read: async () => {
        throw Error("fixture unavailable");
      },
    }),
  ])
    assert.equal(
      (
        await handler(
          new Request("http://localhost/api/public-content?kind=results"),
        )
      ).status,
      503,
    );
});

test("initialization can use management while public reads and assets remain explicitly closed", async () => {
  const preparing = { PUBLIC_CONTENT_MANAGEMENT_ENABLED: "true" };
  let publicReads = 0;
  const response = await createPublicContentHandler({
    env: preparing,
    read: async () => {
      publicReads++;
      return [];
    },
  })(new Request("http://localhost/api/public-content?kind=teachers"));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, "content_not_enabled");
  assert.equal(publicReads, 0);
  const asset = await servePublicContentAsset(
    new Request(
      "http://localhost/api/public-content/assets/teachers/" + id + ".webp",
    ),
    ["teachers", id + ".webp"],
    preparing,
  );
  assert.equal(asset.status, 503);
  assert.equal((await asset.json()).code, "content_not_enabled");
  const admin = await createContentAdminHandlers({
    env: preparing,
    authenticate: async () => ({
      role: "admin",
      store: { empty: async () => true },
    }),
  }).entries(
    new Request("http://localhost/api/admin/public-content?action=bootstrap"),
  );
  assert.equal(admin.status, 200);
  assert.equal((await admin.json()).canApply, true);
  // Turning off editing later does not remove already published content.
  const published = await createPublicContentHandler({
    env: { PUBLIC_CONTENT_PUBLIC_READ_ENABLED: "true" },
    read: async () => [],
  })(new Request("http://localhost/api/public-content?kind=teachers"));
  assert.equal(published.status, 200);
  assert.deepEqual((await published.json()).records, []);
});
