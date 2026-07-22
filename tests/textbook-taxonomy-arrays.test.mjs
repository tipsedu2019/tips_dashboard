import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import { registerHooks } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  TEXTBOOK_SUBJECT_OPTIONS,
  getTextbookGradeSummary,
  getTextbookSchoolLevelSummary,
  getTextbookTaxonomySelection,
  matchesTextbookTaxonomy,
  normalizeTextbookSubject,
  parseTextbookSubjectForWrite,
  toggleTextbookGradeLevel,
  toggleTextbookSchoolLevel,
  validateTextbookTaxonomy,
} from "../src/features/textbooks/textbook-taxonomy.ts";

let textbookServicePromise;

function loadTextbookService() {
  if (!textbookServicePromise) {
    const supabaseStubUrl = `data:text/javascript,${encodeURIComponent('export const supabase = null; export const supabaseConfigError = "";')}`;
    const withKnownExtension = (url) => {
      const path = fileURLToPath(url);
      if (extname(path)) return url;
      for (const extension of [".ts", ".js"]) {
        if (existsSync(`${path}${extension}`)) return pathToFileURL(`${path}${extension}`).href;
      }
      return url;
    };
    registerHooks({
      resolve(specifier, context, nextResolve) {
        if (specifier === "@/lib/supabase") {
          return { url: supabaseStubUrl, shortCircuit: true };
        }
        if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL) {
          return nextResolve(withKnownExtension(new URL(specifier, context.parentURL).href), context);
        }
        return nextResolve(specifier, context);
      },
    });
    textbookServicePromise = import("../src/features/textbooks/textbook-service.ts");
  }
  return textbookServicePromise;
}

function makeMissingSubjectAreaColumnClient(scienceSubjectAreas = []) {
  const payloads = [];
  let attempt = 0;
  return {
    payloads,
    async rpc(name) {
      assert.equal(name, "list_active_science_subject_areas_v1");
      return { data: scienceSubjectAreas, error: null };
    },
    from(table) {
      assert.equal(table, "textbooks");
      return {
        upsert(payload) {
          payloads.push(payload);
          const result = attempt === 0
            ? {
                data: null,
                error: {
                  code: "PGRST204",
                  message: "Could not find the 'subject_area_key' column of 'textbooks' in the schema cache",
                },
              }
            : { data: payload, error: null };
          attempt += 1;
          return {
            select() {
              return { single: async () => result };
            },
          };
        },
      };
    },
  };
}

function makeSuccessfulTextbookClient(scienceSubjectAreas = []) {
  const payloads = [];
  const rpcCalls = [];
  return {
    payloads,
    rpcCalls,
    async rpc(name) {
      rpcCalls.push(name);
      assert.equal(name, "list_active_science_subject_areas_v1");
      return { data: scienceSubjectAreas, error: null };
    },
    from(table) {
      assert.equal(table, "textbooks");
      return {
        upsert(payload) {
          payloads.push(payload);
          return {
            select() {
              return { single: async () => ({ data: payload, error: null }) };
            },
          };
        },
      };
    },
  };
}

test("science subject aliases are explicit and ordered before other", () => {
  assert.deepEqual(
    TEXTBOOK_SUBJECT_OPTIONS.map((option) => [option.value, option.label]),
    [
      ["english", "영어"],
      ["math", "수학"],
      ["science", "과학"],
      ["other", "기타"],
    ],
  );
  assert.equal(normalizeTextbookSubject("science"), "science");
  assert.equal(normalizeTextbookSubject("과학"), "science");
  assert.deepEqual(
    ["english", "영어", "math", "수학", "science", "과학", "other", "기타"]
      .map((subject) => parseTextbookSubjectForWrite(subject)),
    ["english", "english", "math", "math", "science", "science", "other", "other"],
  );
  assert.equal(parseTextbookSubjectForWrite("social"), null);
  assert.equal(parseTextbookSubjectForWrite("  "), null);
  assert.equal(normalizeTextbookSubject("legacy-unknown"), "other");
});

test("textbook write form preserves legacy unknown and blank subjects until an explicit selection", async () => {
  const taxonomy = await import("../src/features/textbooks/textbook-taxonomy.ts");

  assert.equal(typeof taxonomy.getTextbookSubjectWriteValue, "function");
  assert.equal(typeof taxonomy.validateTextbookTaxonomyForWrite, "function");
  assert.equal(taxonomy.getTextbookSubjectWriteValue(" legacy-unknown "), "legacy-unknown");
  assert.equal(taxonomy.getTextbookSubjectWriteValue("  "), "");
  assert.equal(taxonomy.getTextbookSubjectWriteValue("기타"), "other");
  assert.deepEqual(
    taxonomy.validateTextbookTaxonomyForWrite({
      subject: "legacy-unknown",
      schoolLevels: ["high"],
      gradeLevels: ["h1"],
      subSubject: "기타",
    }),
    { valid: false, field: "subject", message: "지원하는 교재 과목만 저장할 수 있습니다." },
  );
});

test("legacy unknown textbook edit fails until the user explicitly selects other", async () => {
  const taxonomy = await import("../src/features/textbooks/textbook-taxonomy.ts");
  const { upsertTextbookMaster } = await loadTextbookService();
  const client = makeSuccessfulTextbookClient();
  const draft = {
    id: "legacy-textbook",
    title: "레거시 교재",
    subject: taxonomy.getTextbookSubjectWriteValue("legacy-unknown"),
    schoolLevels: ["high"],
    gradeLevels: ["h1"],
    subSubject: "기타",
    publisher: "수정 출판사",
  };

  await assert.rejects(
    () => upsertTextbookMaster(draft, client),
    /지원하는 교재 과목만 저장할 수 있습니다/,
  );
  assert.equal(client.payloads.length, 0);

  const saved = await upsertTextbookMaster({ ...draft, subject: "other" }, client);
  assert.equal(saved.subject, "other");
  assert.equal(client.payloads.length, 1);
  assert.equal(client.rpcCalls.length, 0);
});

test("science taxonomy is fixed to high school and requires an authoritative area key", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({
      subject: "과학",
      school_levels: ["middle"],
      grade_levels: ["m2"],
    }),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
  assert.deepEqual(
    validateTextbookTaxonomy({
      subject: "science",
      schoolLevels: ["high"],
      gradeLevels: ["h1", "h2", "h3"],
      subSubject: "물리학",
    }),
    { valid: false, field: "subjectAreaKey", message: "과학 영역을 선택하세요." },
  );
  assert.deepEqual(
    validateTextbookTaxonomy({
      subject: "science",
      subjectAreaKey: "physics",
      schoolLevels: ["high"],
      gradeLevels: ["h1", "h2", "h3"],
      subSubject: "물리학",
    }),
    { valid: true },
  );
  assert.deepEqual(
    validateTextbookTaxonomy({
      subject: "english",
      subjectAreaKey: "physics",
      schoolLevels: ["high"],
      gradeLevels: ["h1"],
      subSubject: "독해",
    }),
    { valid: false, field: "subjectAreaKey", message: "과학 교재에서만 과학 영역을 선택할 수 있습니다." },
  );
});

test("textbook master rejects a blank subject before persistence", async () => {
  const { upsertTextbookMaster } = await loadTextbookService();
  const client = makeSuccessfulTextbookClient();

  await assert.rejects(
    () => upsertTextbookMaster({
      title: "미분류 교재",
      subject: "  ",
      schoolLevels: ["high"],
      gradeLevels: ["h1"],
      subSubject: "기타",
    }, client),
    /과목을 선택하세요/,
  );
  assert.equal(client.payloads.length, 0);
  assert.equal(client.rpcCalls.length, 0);
});

test("textbook master rejects an unknown subject instead of normalizing it to other", async () => {
  const { upsertTextbookMaster } = await loadTextbookService();
  const client = makeSuccessfulTextbookClient();

  await assert.rejects(
    () => upsertTextbookMaster({
      title: "사회 교재",
      subject: "social",
      schoolLevels: ["high"],
      gradeLevels: ["h1"],
      subSubject: "사회",
    }, client),
    /지원하는 교재 과목만 저장할 수 있습니다/,
  );
  assert.equal(client.payloads.length, 0);
  assert.equal(client.rpcCalls.length, 0);
});

test("science textbook master uses a preloaded active area label without a write-time RPC", async () => {
  const { upsertTextbookMaster } = await loadTextbookService();
  const scienceSubjectAreas = [
    {
      subject: "과학",
      area_key: "physics",
      label: "물리학",
      sort_order: 20,
      is_active: true,
    },
  ];
  const client = makeSuccessfulTextbookClient(scienceSubjectAreas);

  const saved = await upsertTextbookMaster({
    title: "과학 개념서",
    subject: "과학",
    subjectAreaKey: "physics",
    schoolLevels: ["middle"],
    gradeLevels: ["m2"],
    subSubject: "화학",
  }, { client, scienceSubjectAreas });

  assert.deepEqual(client.rpcCalls, []);
  assert.equal(client.payloads.length, 1);
  assert.equal(client.payloads[0].subject, "science");
  assert.equal(client.payloads[0].subject_area_key, "physics");
  assert.equal(client.payloads[0].sub_subject, "물리학");
  assert.equal(saved.sub_subject, "물리학");
});

test("science textbook master rejects an inactive or unknown area key", async () => {
  const { upsertTextbookMaster } = await loadTextbookService();
  const scienceSubjectAreas = [
    {
      subject: "과학",
      area_key: "chemistry",
      label: "화학",
      sort_order: 30,
      is_active: true,
    },
  ];
  const client = makeSuccessfulTextbookClient(scienceSubjectAreas);

  await assert.rejects(
    () => upsertTextbookMaster({
      title: "잘못된 과학 교재",
      subject: "science",
      subjectAreaKey: "physics",
      schoolLevels: ["high"],
      gradeLevels: ["h1", "h2", "h3"],
      subSubject: "물리학",
    }, { client, scienceSubjectAreas }),
    /활성 과학 영역을 선택하세요/,
  );
  assert.equal(client.payloads.length, 0);
  assert.equal(client.rpcCalls.length, 0);
});

test("bulk science textbook saves reuse one preloaded area map with zero area RPCs", async () => {
  const { upsertTextbookMaster } = await loadTextbookService();
  const scienceSubjectAreas = [
    { subject: "과학", area_key: "physics", label: "물리학", sort_order: 20, is_active: true },
    { subject: "과학", area_key: "chemistry", label: "화학", sort_order: 30, is_active: true },
  ];
  const client = makeSuccessfulTextbookClient(scienceSubjectAreas);

  await Promise.all([
    ["physics", "화학"],
    ["chemistry", "물리학"],
  ].map(([subjectAreaKey, subSubject]) => upsertTextbookMaster({
    title: `${subjectAreaKey} 교재`,
    subject: "science",
    subjectAreaKey,
    schoolLevels: ["high"],
    gradeLevels: ["h1", "h2", "h3"],
    subSubject,
  }, { client, scienceSubjectAreas })));

  assert.equal(client.rpcCalls.length, 0);
  assert.deepEqual(client.payloads.map((payload) => payload.sub_subject), ["물리학", "화학"]);
});

test("textbook master retries a missing area column only for non-science payloads", async () => {
  const { upsertTextbookMaster } = await loadTextbookService();
  const englishClient = makeMissingSubjectAreaColumnClient();
  const saved = await upsertTextbookMaster({
    title: "영어 독해",
    subject: "english",
    schoolLevels: ["high"],
    gradeLevels: ["h1"],
    subSubject: "독해",
  }, englishClient);

  assert.equal(englishClient.payloads.length, 2);
  assert.equal(Object.hasOwn(englishClient.payloads[0], "subject_area_key"), true);
  assert.equal(Object.hasOwn(englishClient.payloads[1], "subject_area_key"), false);
  assert.equal(saved.subject, "english");

  const scienceClient = makeMissingSubjectAreaColumnClient([
    {
      subject: "과학",
      area_key: "physics",
      label: "물리학",
      sort_order: 20,
      is_active: true,
    },
  ]);
  await assert.rejects(
    () => upsertTextbookMaster({
      title: "물리학",
      subject: "science",
      subjectAreaKey: "physics",
      schoolLevels: ["high"],
      gradeLevels: ["h1", "h2", "h3"],
      subSubject: "물리학",
    }, scienceClient),
    (error) => error?.code === "PGRST204",
  );
  assert.equal(scienceClient.payloads.length, 1);
});

test("arrays are authoritative and canonical", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({
      school_levels: ["high", "elementary", "high"],
      grade_levels: ["h3", "e6", "h1", "h3"],
      school_level: "middle",
      grade_level: "m2",
    }),
    {
      schoolLevels: ["elementary", "high"],
      gradeLevels: ["e6", "h1", "h3"],
    },
  );
});

test("a scalar school without a grade expands to every grade in that school", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({ school_level: "high" }),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
});

test("a scalar grade derives its school", () => {
  assert.deepEqual(
    getTextbookTaxonomySelection({ grade_level: "e6" }),
    { schoolLevels: ["elementary"], gradeLevels: ["e6"] },
  );
});

test("an unclassified legacy textbook becomes broad", () => {
  const result = getTextbookTaxonomySelection({ title: "공용 교재", category: "기타" });
  assert.deepEqual(result.schoolLevels, ["elementary", "middle", "high"]);
  assert.equal(result.gradeLevels.length, 12);
});

test("checking a school adds all of its grades", () => {
  assert.deepEqual(
    toggleTextbookSchoolLevel({ schoolLevels: [], gradeLevels: [] }, "high", true),
    { schoolLevels: ["high"], gradeLevels: ["h1", "h2", "h3"] },
  );
});

test("checking a grade adds its school and removing the final grade removes the school", () => {
  const checked = toggleTextbookGradeLevel({ schoolLevels: [], gradeLevels: [] }, "e6", true);
  assert.deepEqual(checked, { schoolLevels: ["elementary"], gradeLevels: ["e6"] });
  assert.deepEqual(toggleTextbookGradeLevel(checked, "e6", false), { schoolLevels: [], gradeLevels: [] });
});

test("unchecking a school removes all grades in that school", () => {
  assert.deepEqual(
    toggleTextbookSchoolLevel(
      { schoolLevels: ["middle", "high"], gradeLevels: ["m1", "m3", "h2"] },
      "middle",
      false,
    ),
    { schoolLevels: ["high"], gradeLevels: ["h2"] },
  );
});

test("required taxonomy validation returns a Korean field error", () => {
  assert.deepEqual(
    validateTextbookTaxonomy({ subject: "math", schoolLevels: ["high"], gradeLevels: [], subSubject: "기하" }),
    { valid: false, field: "gradeLevels", message: "학년을 하나 이상 선택하세요." },
  );
});

test("broad summaries stay compact", () => {
  const broad = {
    school_levels: ["elementary", "middle", "high"],
    grade_levels: ["e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"],
  };
  assert.equal(getTextbookSchoolLevelSummary(broad), "초·중·고");
  assert.equal(getTextbookGradeSummary(broad), "전 학년");
  assert.equal(getTextbookGradeSummary({ school_levels: ["high"], grade_levels: ["h1", "h2", "h3"] }), "고1–고3");
  assert.equal(getTextbookGradeSummary({ school_levels: ["high"], grade_levels: ["h1", "h3"] }), "고1 · 고3");
});

test("containment includes broad books and excludes unrelated grades", () => {
  const broad = {
    school_levels: ["elementary", "middle", "high"],
    grade_levels: ["e1", "e2", "e3", "e4", "e5", "e6", "m1", "m2", "m3", "h1", "h2", "h3"],
    subject: "math",
    sub_subject: "기타",
  };
  assert.equal(matchesTextbookTaxonomy(broad, { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "" }), true);
  assert.equal(matchesTextbookTaxonomy({ ...broad, grade_levels: ["h1"] }, { subject: "math", schoolLevel: "high", gradeLevel: "h3", subSubject: "" }), false);
});
