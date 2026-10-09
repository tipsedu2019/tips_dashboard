import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import ts from "typescript";
import { canUseRegistrationParentContact, normalizeRegistrationCaseContact, stripRegistrationTaskContact } from "../src/features/tasks/registration-contact-client.ts";
import { buildRegistrationSubjectHistory } from "../src/features/tasks/registration-track-history.js";
import { readRegistrationContactEvents } from "../src/features/tasks/registration-contact-event-reader.ts";

import { parseAcademicSubject } from "../src/lib/academic-subject-registry.ts";
import { normalizeRegistrationLevelTestPlace } from "../src/features/tasks/registration-level-test-place.ts";
import {
  EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
  normalizeRegistrationObservationSummary,
} from "../src/features/tasks/registration-observation-model.ts";
import {
  loadRegistrationObservationFeedback,
  loadRegistrationObservationManagerDetail,
} from "../src/features/tasks/registration-observation-service.ts";
import {
  REGISTRATION_WORKFLOW_STATUSES,
  getRegistrationWorkflowStatusFromLegacyTrack,
} from "../src/features/tasks/registration-workflow-status.js";

const CONTACT_TASK = "73000000-0000-4000-8000-000000000001";
const CONTACT_TRACK = "73000000-0000-4000-8000-000000000030";
const CONTACT_KEY = "73000000-0000-4000-8000-000000000090";
const EVENT_ACTOR = "74000000-0000-4000-8000-000000000090";
const EVENT_FIXTURE_IDS = Object.freeze({
  canonical: "74000000-0000-4000-8000-000000000001",
  legacy: "74000000-0000-4000-8000-000000000002",
  observationReason: "74000000-0000-4000-8000-000000000003",
  observationLegacy: "74000000-0000-4000-8000-000000000004",
  observationV1: "74000000-0000-4000-8000-000000000005",
  publicV2: "74000000-0000-4000-8000-000000000006",
  legacyNull: "74000000-0000-4000-8000-000000000007",
  nonTrack: "74000000-0000-4000-8000-000000000008",
  outerWhitespace: "74000000-0000-4000-8000-000000000009",
  innerWhitespace: "74000000-0000-4000-8000-00000000000a",
  innerArray: "74000000-0000-4000-8000-00000000000b",
  malformed: "74000000-0000-4000-8000-00000000000c",
  jsonNonV2: "74000000-0000-4000-8000-00000000000d",
  stringVersionNearMiss: "74000000-0000-4000-8000-00000000000e",
});
function contactState(overrides = {}) { return {version:1,taskId:CONTACT_TASK,revision:"1",generation:"1",phase:"open",closureReason:null,closedAt:null,parentPhone:null,studentId:null,commonRevision:3,allPhasesClosed:false,currentTrackIds:[CONTACT_TRACK],...overrides}; }
function contactEnvelope(mutation,result = {}) { return {version:1,taskId:CONTACT_TASK,command:mutation.command,requestKey:mutation.requestKey,replayed:false,result:{taskId:CONTACT_TASK,contactState:contactState({revision:"2"}),...result}}; }
function commonContactInput(overrides = {}) { return {taskId:CONTACT_TASK,contactState:contactState(),studentName:"합성학생",schoolGrade:"중2",schoolName:"합성학교",parentPhone:"01000000000",studentPhone:"RETIRED_STUDENT_CANARY",campus:"본관",inquiryAt:"2026-09-01T18:49",requestNote:"업무메모",priority:"normal",expectedCommonRevision:3,requestKey:CONTACT_KEY,...overrides}; }
const BIND_STUDENT = "73000000-0000-4000-8000-000000000081";
function bindingResult(overrides = {}) { return { studentId: BIND_STUDENT, changed: true,
  contactState: contactState({ revision: "2", studentId: BIND_STUDENT }), ...overrides }; }

test("explicit student binding sends only the selected UUID with original exact counters and acknowledges metadata", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const calls = [];
  let invalidations = 0;
  const harness = createClient();
  const opened = contactState({ generation: "9007199254740993", revision: "9007199254740994", parentPhone: "01000000000" });
  const state = contactState({ generation: opened.generation, revision: "9007199254740995", studentId: BIND_STUDENT });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    mutateContact: async (command) => { calls.push(command); return contactEnvelope(command, bindingResult({ contactState: state })); },
    onMutationSuccess: () => invalidations++,
  }));
  const receipt = await service.bindRegistrationStudent({ taskId: CONTACT_TASK, studentId: BIND_STUDENT,
    contactState: opened, requestKey: CONTACT_KEY });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ command: "bind_student", taskId: CONTACT_TASK,
    requestKey: CONTACT_KEY, expectedGeneration: opened.generation, expectedRevision: opened.revision, payload: { studentId: BIND_STUDENT } }]);
  assert.deepEqual(JSON.parse(JSON.stringify(receipt)), { taskId: CONTACT_TASK, ...bindingResult({ contactState: state }) });
  assert.equal(JSON.stringify(calls).includes("01000000000"), false);
  assert.equal(JSON.stringify(receipt).includes("01000000000"), false);
  assert.equal(service.getContactReceipt(CONTACT_TASK).studentId, BIND_STUDENT);
  assert.equal(service.getContactReceipt(CONTACT_TASK).parentPhone, null);
  assert.equal(invalidations, 1);
  assert.equal(harness.queries.length, 0);
  assert.equal(harness.rpcCalls.length, 0);
  assert.equal(opened.parentPhone, "01000000000");
});

test("closed case UUID binding materializes its closure timestamp without opening a contact generation", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const opened = contactState({ phase: "closed", closureReason: "all_current_tracks_terminal", allPhasesClosed: true, closedAt: null });
  const after = { ...opened, revision: "2", studentId: BIND_STUDENT, closedAt: "2026-10-09T12:00:00Z" };
  const service = createRegistrationTrackService(createClient().client, readyOptions({
    mutateContact: async (command) => contactEnvelope(command, bindingResult({ contactState: after })),
  }));
  const receipt = await service.bindRegistrationStudent({ taskId: CONTACT_TASK, studentId: BIND_STUDENT,
    contactState: opened, requestKey: CONTACT_KEY });
  assert.equal(receipt.contactState.phase, "closed");
  assert.equal(receipt.contactState.generation, opened.generation);
  assert.equal(receipt.contactState.parentPhone, null);
  assert.equal(receipt.contactState.closedAt, after.closedAt);
});

test("malformed identity, missing snapshot and a different previously bound UUID fail before HTTP", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let calls = 0;
  const service = createRegistrationTrackService(createClient().client, readyOptions({ mutateContact: async () => { calls++; assert.fail("unexpected mutation"); } }));
  const base = { taskId: CONTACT_TASK, studentId: BIND_STUDENT, contactState: contactState(), requestKey: CONTACT_KEY };
  for (const patch of [{ studentId: "DISPLAY-081" }, { studentId: BIND_STUDENT + "\n" },
    { requestKey: `prefix:${CONTACT_KEY}` }, { contactState: null },
    { contactState: contactState({ generation: "01" }) }, { contactState: contactState({ taskId: BIND_STUDENT }) },
    { contactState: contactState({ studentId: "73000000-0000-4000-8000-000000000082" }) }]) {
    await assert.rejects(service.bindRegistrationStudent({ ...base, ...patch }), /registration_(student_binding|contact_)/);
  }
  assert.equal(calls, 0);
  assert.equal(service.getContactReceipt(CONTACT_TASK), null);
});

test("binding receipt identity and scope must agree before cache notification or metadata acknowledgement", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const other = "73000000-0000-4000-8000-000000000082";
  const badStates = [{ studentId: other }, { generation: "2" }, { revision: "1" }, { commonRevision: 4 },
    { currentTrackIds: [other] }, { allPhasesClosed: true },
    { phase: "closed", closureReason: "whole_case_cancelled", closedAt: null }, { parentPhone: "01000000000" }];
  const badResults = [{ taskId: undefined }, { studentId: other }, { studentId: null }, { changed: "false" }, { changed: undefined },
    ...badStates.map((patch) => ({ contactState: contactState({ revision: "2", studentId: BIND_STUDENT, ...patch }) }))];
  for (const patch of badResults) {
    let notifications = 0;
    const service = createRegistrationTrackService(createClient().client, readyOptions({
      mutateContact: async (command) => contactEnvelope(command, bindingResult(patch)), onMutationSuccess: () => notifications++,
    }));
    await assert.rejects(service.bindRegistrationStudent({ taskId: CONTACT_TASK, studentId: BIND_STUDENT,
      contactState: contactState(), requestKey: CONTACT_KEY }), /registration_(student_binding_response_invalid|contact_mutation_response_invalid)/);
    assert.equal(notifications, 0);
    assert.equal(service.getContactReceipt(CONTACT_TASK), null);
  }
});

test("an explicitly repeated same-student binding accepts changed=false without rebinding identity", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const service = createRegistrationTrackService(createClient().client, readyOptions({
    mutateContact: async (command) => ({ ...contactEnvelope(command, bindingResult({ changed: false })), replayed: true }),
  }));
  const result = await service.bindRegistrationStudent({ taskId: CONTACT_TASK, studentId: BIND_STUDENT,
    contactState: contactState({ studentId: BIND_STUDENT }), requestKey: CONTACT_KEY });
  assert.equal(result.changed, false);
  assert.equal(result.studentId, BIND_STUDENT);
});

test("binding timeout leaves no acknowledgement and an explicit replay retains the original intent", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const calls = [];
  let notifications = 0;
  const service = createRegistrationTrackService(createClient().client, readyOptions({ mutateContact: async (command) => {
    calls.push(command);
    if (calls.length === 1) throw new Error("registration_contact_mutation_timeout");
    return { ...contactEnvelope(command, bindingResult()), replayed: true };
  }, onMutationSuccess: () => notifications++ }));
  const input = { taskId: CONTACT_TASK, studentId: BIND_STUDENT, contactState: contactState(), requestKey: CONTACT_KEY };
  await assert.rejects(service.bindRegistrationStudent(input), /registration_contact_mutation_timeout/);
  assert.equal(calls.length, 1);
  assert.equal(notifications, 0);
  assert.equal(service.getContactReceipt(CONTACT_TASK), null);
  await service.bindRegistrationStudent(input);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), JSON.parse(JSON.stringify(calls[1])));
  assert.equal(notifications, 1);
});

test("pending binding captures selection, key and contact scope before the caller object changes", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const pending = deferred();
  let sent;
  const service = createRegistrationTrackService(createClient().client, readyOptions({ mutateContact: async (command) => {
    sent = command; await pending.promise; return contactEnvelope(command, bindingResult());
  } }));
  const input = { taskId: CONTACT_TASK, studentId: BIND_STUDENT, contactState: contactState(), requestKey: CONTACT_KEY };
  const result = service.bindRegistrationStudent(input);
  input.studentId = "73000000-0000-4000-8000-000000000082";
  input.requestKey = "73000000-0000-4000-8000-000000000083";
  input.contactState.generation = "2";
  input.contactState.revision = "9";
  pending.resolve();
  assert.equal((await result).studentId, BIND_STUDENT);
  assert.equal(sent.payload.studentId, BIND_STUDENT);
  assert.equal(sent.requestKey, CONTACT_KEY);
  assert.equal(sent.expectedGeneration, "1");
  assert.equal(sent.expectedRevision, "1");
});

test("business detail joins omit typed phones and cached detail reauthorizes the temporary recipient", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let revision = "1", phone = "01000000000", reads = 0;
  const harness = createClient({ queryHandler: query => detailRows(query.table), contactHandler: () => { reads++; return {data:contactState({revision,parentPhone:phone}),error:null}; } });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const first = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.equal(first.task.registration.parentPhone, phone);
  assert.equal(Object.hasOwn(first.task.registration, "studentPhone"), false);
  const businessReads = harness.queries.length;
  const parent = harness.queries.find(query => query.table === "ops_tasks");
  assert.doesNotMatch(parent.columns, /parent_phone|student_phone|ops_registration_details\(\*\)/);
  revision = "2"; phone = "01000000001";
  const second = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.equal(reads, 2); assert.equal(harness.queries.length, businessReads);
  assert.equal(second.task.registration.parentPhone, phone);
  assert.equal(service.getContactReceipt(CONTACT_TASK).parentPhone, null);
  revision = "3";
  harness.client.rpc = () => ({abortSignal(){return this},retry(){return this},then(resolve,reject){return Promise.resolve({data:contactState({revision,phase:"closed",allPhasesClosed:true,closureReason:"all_current_tracks_terminal",closedAt:null,parentPhone:null}),error:null}).then(resolve,reject)}});
  const closed = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.equal(Object.hasOwn(closed.task.registration, "parentPhone"), false);
  assert.equal(closed.contactState.parentPhone, null);
});

test("a committed closing receipt fences an older in-flight contact detail even when its reload has not happened", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const enrollments = deferred();
  const harness = createClient({queryHandler: query => query.table === "ops_registration_enrollments" ? enrollments.promise.then(() => detailRows(query.table)) : detailRows(query.table),contactHandler:()=>({data:contactState({parentPhone:"01000000000"}),error:null})});
  const service = createRegistrationTrackService(harness.client,readyOptions({mutateContact:async mutation=>contactEnvelope(mutation,{trackId:CONTACT_TRACK,workflowStatus:"registered",workflowRevision:2,contactState:contactState({revision:"2",phase:"closed",closureReason:"all_current_tracks_terminal",closedAt:"2026-10-09T09:00:00Z",allPhasesClosed:true,parentPhone:null})})}));
  const pending = service.loadCaseDetail(CONTACT_TASK,"viewer-1");
  await new Promise(setImmediate);
  await service.setRegistrationWorkflowStatus({taskId:CONTACT_TASK,contactState:contactState(),trackId:CONTACT_TRACK,workflowStatus:"registered",expectedWorkflowRevision:1,requestKey:CONTACT_KEY});
  enrollments.resolve();
  const stale = await pending;
  assert.equal(stale.contactState.phase,"closed");assert.equal(stale.contactState.revision,"2");
  assert.equal(Object.hasOwn(stale.task.registration,"parentPhone"),false);
});

test("a failed current-contact read cannot reuse the cached open phone", async () => {
  const {createRegistrationTrackService}=await loadFactory();let fail=false;
  const harness=createClient({queryHandler:query=>detailRows(query.table),contactHandler:()=>fail?{data:null,error:Error("synthetic read unavailable")}:{data:contactState({parentPhone:"01000000000"}),error:null}});
  const service=createRegistrationTrackService(harness.client,readyOptions());
  await service.loadCaseDetail(CONTACT_TASK,"viewer-1");fail=true;
  await assert.rejects(service.loadCaseDetail(CONTACT_TASK,"viewer-1"),/synthetic read unavailable/);
  assert.equal(service.getContactReceipt(CONTACT_TASK).parentPhone,null);
});

test("real receipt envelope identity and metadata are validated before a contact write is accepted", async () => {
  const {createRegistrationTrackService}=await loadFactory();
  for(const change of [value=>({...value,requestKey:"wrong"}),value=>({...value,command:"create"}),value=>({...value,taskId:"73000000-0000-4000-8000-000000000099"}),value=>({...value,replayed:"false"}),value=>({...value,result:[]}),value=>({...value,result:{...value.result,contactState:contactState({parentPhone:"01000000000"})}})]) {
    const service=createRegistrationTrackService(createClient().client,readyOptions({mutateContact:async mutation=>change(contactEnvelope(mutation))}));
    await assert.rejects(service.updateRegistrationCaseCommon(commonContactInput()),/registration_contact_(receipt|mutation_response)_invalid/);
    assert.equal(service.getContactReceipt(CONTACT_TASK),null);
  }
});

test("lost-response retries keep the scoped UUID and opened revisions rather than refreshing stale contact authority", async () => {
  const {createRegistrationTrackService}=await loadFactory();const calls=[];const harness=createClient();
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async mutation=>{calls.push(mutation);if(calls.length===1)throw Error("registration_contact_mutation_unavailable");return {...contactEnvelope(mutation),replayed:true};}}));
  const input=commonContactInput({requestKey:`registration-common:${CONTACT_TASK}:${CONTACT_KEY}`});
  await assert.rejects(service.updateRegistrationCaseCommon(input),/registration_contact_mutation_unavailable/);
  assert.equal(calls.length,1);await service.updateRegistrationCaseCommon(input);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),JSON.parse(JSON.stringify(calls[1])));
  assert.equal(calls[0].requestKey,CONTACT_KEY);assert.equal(calls[0].expectedRevision,"1");assert.equal(harness.rpcCalls.length,0);
});

test("whole-case cancellation reads a bounded snapshot and atomically closes without a legacy task status write", async () => {
  const {createRegistrationTrackService}=await loadFactory();const calls=[];const harness=createClient();
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async mutation=>{calls.push(mutation);return contactEnvelope(mutation,{contactState:contactState({revision:"2",phase:"closed",closureReason:"whole_case_cancelled",closedAt:"2026-10-09T09:00:00Z",parentPhone:null})});}}));
  const receipt=await service.closeRegistrationCaseContact({taskId:CONTACT_TASK,requestKey:CONTACT_KEY});
  assert.equal(harness.queries.length,0);assert.equal(harness.rpcCalls.length,1);assert.equal(harness.rpcCalls[0][0],"get_registration_case_contact_v1");
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{command:"close",taskId:CONTACT_TASK,requestKey:CONTACT_KEY,expectedGeneration:"1",expectedRevision:"1",payload:{reason:"whole_case_cancelled"}});
  assert.equal(receipt.contactState.phase,"closed");assert.equal(service.getContactReceipt(CONTACT_TASK).parentPhone,null);
});

test("metadata-only common edits omit the contact field instead of blanking or resubmitting a hidden draft", async () => {
  const {createRegistrationTrackService}=await loadFactory();const calls=[];
  const service=createRegistrationTrackService(createClient().client,readyOptions({mutateContact:async mutation=>{calls.push(mutation);return contactEnvelope(mutation);}}));
  const input=commonContactInput();delete input.parentPhone;
  await service.updateRegistrationCaseCommon(input);
  assert.equal(Object.hasOwn(calls[0].payload,"parentPhone"),false);
  assert.equal(Object.hasOwn(calls[0].payload,"studentPhone"),false);
  assert.equal(calls[0].payload.requestNote,"업무메모");
});

test("a canceled case nonterminal selection keeps opened revisions and records fresh-generation metadata without contact restoration", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const studentId = "73000000-0000-4000-8000-000000000080";
  const opened = contactState({ revision: "8", generation: "3", phase: "closed",
    closureReason: "whole_case_cancelled", closedAt: null, studentId });
  const harness = createClient();
  const calls = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    mutateContact: async (command) => {
      calls.push(command);
      return contactEnvelope(command, {
        trackId: CONTACT_TRACK, workflowStatus: "level_test_requested", workflowRevision: 5,
        sourceEventIds: [], enrollmentFinalization: null,
        contactState: contactState({ revision: "9", generation: "4", studentId }),
      });
    },
  }));
  const receipt = await service.setRegistrationWorkflowStatus({ taskId: CONTACT_TASK, contactState: opened,
    trackId: CONTACT_TRACK, workflowStatus: "level_test_requested", expectedWorkflowRevision: 4, requestKey: CONTACT_KEY });
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ command: "set_workflow_status", taskId: CONTACT_TASK,
    requestKey: CONTACT_KEY, expectedGeneration: "3", expectedRevision: "8",
    payload: { trackId: CONTACT_TRACK, workflowStatus: "level_test_requested", expectedWorkflowRevision: 4 } }]);
  assert.equal(receipt.contactState.generation, "4");
  assert.equal(receipt.contactState.phase, "open");
  assert.equal(receipt.contactState.parentPhone, null);
  assert.equal(receipt.contactState.studentId, studentId);
  assert.deepEqual(Array.from(receipt.sourceEventIds), []);
  assert.equal(receipt.enrollmentFinalization, null);
  assert.equal(service.getContactReceipt(CONTACT_TASK).parentPhone, null);
  assert.equal(harness.queries.length, 0);
  assert.equal(harness.rpcCalls.length, 0);
});

const serviceUrl = new URL(
  "../src/features/tasks/registration-track-service.ts",
  import.meta.url,
);

async function readServiceSource() {
  return readFile(serviceUrl, "utf8");
}

async function compileRegistrationTrackTypeContract(source) {
  const directory = await mkdtemp(join(tmpdir(), "registration-track-types-"));
  const fixturePath = join(directory, "contract.ts");
  const configPath = fileURLToPath(new URL("../tsconfig.json", import.meta.url));
  const projectPath = fileURLToPath(new URL("..", import.meta.url));
  try {
    await writeFile(fixturePath, source);
    const config = ts.readConfigFile(configPath, ts.sys.readFile);
    assert.equal(config.error, undefined);
    const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, projectPath);
    const program = ts.createProgram({
      rootNames: [fixturePath],
      options: { ...parsed.options, incremental: false, noEmit: true },
    });
    return ts.getPreEmitDiagnostics(program).map((diagnostic) => (
      ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")
    ));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function loadFactory(extraGlobals = {}) {
  const source = await readServiceSource();
  const startMarker = "// registration-track-service-factory:start";
  const endMarker = "// registration-track-service-factory:end";
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start + startMarker.length);

  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.ok(end > start, `missing ${endMarker}`);

  const factorySource = source.slice(start + startMarker.length, end);
  const compiled = ts.transpileModule(
    `${factorySource}\nmodule.exports = { createRegistrationTrackService, createRegistrationMutationRequestKey, buildRegistrationMigrationLegacySnapshot, mapTrack, mapTrackEvent };`,
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
    },
  ).outputText;
  const sandboxModule = { exports: {} };

  vm.runInNewContext(compiled, {
    module: sandboxModule,
    exports: sandboxModule.exports,
    AbortController,
    AbortSignal,
    clearTimeout,
    crypto: { randomUUID: () => "uuid-from-crypto" },
    normalizeRegistrationLevelTestPlace,
    EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
    normalizeRegistrationObservationSummary,
    loadRegistrationObservationFeedback,
    loadRegistrationObservationManagerDetail,
    canUseRegistrationParentContact, normalizeRegistrationCaseContact, stripRegistrationTaskContact,
    readRegistrationContactEvents,
    parseAcademicSubject,
    REGISTRATION_WORKFLOW_STATUSES,
    getRegistrationWorkflowStatusFromLegacyTrack,
    setTimeout,
    ...extraGlobals,
  });
  return sandboxModule.exports;
}

test("subject saves send the opened snapshot and keep the same request after a lost response", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let attempt = 0;
  const harness = createClient({ rpcHandler() {
    attempt += 1;
    if (attempt === 1) return { data: null, error: new Error("response lost") };
    return { data: { taskId: "73000000-0000-4000-8000-000000000001", subjects: ["영어", "수학"], tracks: [] }, error: null };
  } });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const input = {
    taskId: "73000000-0000-4000-8000-000000000001", expectedSubjects: ["영어"], subjects: ["수학", "영어"], requestKey: "subject-replay",
  };
  await assert.rejects(service.syncRegistrationCaseSubjects(input), /response lost/);
  assert.equal(harness.rpcCalls.length, 1, "a failed save must not retry automatically");
  const result = await service.syncRegistrationCaseSubjects(input);
  assert.equal(result.taskId, "73000000-0000-4000-8000-000000000001");
  assert.deepEqual(harness.rpcCalls.map(([name, args]) => [name, JSON.parse(JSON.stringify(args))]), [
    ["sync_registration_case_subjects_v2", { p_task_id: "73000000-0000-4000-8000-000000000001", p_subjects: ["영어", "수학"], p_expected_subjects: ["영어"], p_request_key: "subject-replay" }],
    ["sync_registration_case_subjects_v2", { p_task_id: "73000000-0000-4000-8000-000000000001", p_subjects: ["영어", "수학"], p_expected_subjects: ["영어"], p_request_key: "subject-replay" }],
  ]);
});

test("track rows preserve science and fail closed for unsupported subjects", async () => {
  const { mapTrack } = await loadFactory();

  assert.equal(mapTrack({ id: "science-track", subject: "과학" }).subject, "과학");
  assert.throws(
    () => mapTrack({ id: "unsupported-track", subject: "unknown" }),
    /registration_subject_unsupported/,
  );
});

test("observation summary types are broad while generic mutations stay narrow", async () => {
  const servicePath = fileURLToPath(serviceUrl);
  const modelPath = fileURLToPath(new URL(
    "../src/features/tasks/registration-observation-model.ts",
    import.meta.url,
  ));
  const diagnostics = await compileRegistrationTrackTypeContract(`
    import {
      createRegistrationTrackService,
      loadRegistrationCaseDetail,
      loadRegistrationTrackSummaries,
      type OpsRegistrationObservationCaseDetail,
      type OpsRegistrationObservationTrackSummary,
      type OpsRegistrationTrackSummary,
      type OpsRegistrationWorkflowStatus,
      type RegistrationObservationTrackSummaryLoadResult,
    } from ${JSON.stringify(servicePath)};
    import type {
      RegistrationObservationTrackWorkflowStatus,
    } from ${JSON.stringify(modelPath)};

    type Equal<Left, Right> =
      (<Value>() => Value extends Left ? 1 : 2) extends
      (<Value>() => Value extends Right ? 1 : 2) ? true : false;
    type Assert<Value extends true> = Value;
    type ObservationReadStatus =
      RegistrationObservationTrackSummaryLoadResult["tracks"][number]["workflowStatus"];
    type GenericMutationStatus = Parameters<
      ReturnType<typeof createRegistrationTrackService>["setRegistrationWorkflowStatus"]
    >[0]["workflowStatus"];
    const observationRead = loadRegistrationTrackSummaries([], "viewer", {
      observationAware: true,
    });
    const genericRead = loadRegistrationTrackSummaries([], "viewer");
    const observationDetail = loadRegistrationCaseDetail("task", "viewer", {
      observationAware: true,
    });
    const genericDetail = loadRegistrationCaseDetail("task", "viewer");
    type PublicObservationReadStatus =
      Awaited<typeof observationRead>["tracks"][number]["workflowStatus"];
    type PublicGenericReadStatus =
      Awaited<typeof genericRead>["tracks"][number]["workflowStatus"];
    type PublicObservationDetailStatus =
      Awaited<typeof observationDetail>["tracks"][number]["workflowStatus"];
    type PublicGenericDetailStatus =
      Awaited<typeof genericDetail>["tracks"][number]["workflowStatus"];
    type ObservationSummaryKey =
      | "observationAttemptCount"
      | "observationCurrentId"
      | "observationCurrentStatus"
      | "observationCurrentAppointmentId"
      | "observationNearestScheduledAt"
      | "observationNearestPlace"
      | "observationNotificationRevision"
      | "observationRevision"
      | "observationFeedbackRevision"
      | "observationSummaryVisible";
    type PublicGenericReadObservationKeys = Extract<
      ObservationSummaryKey,
      keyof Awaited<typeof genericRead>["tracks"][number]
    >;

    type ObservationReadIsExact = Assert<Equal<
      ObservationReadStatus,
      RegistrationObservationTrackWorkflowStatus
    >>;
    type ObservationTrackIsExact = Assert<Equal<
      OpsRegistrationObservationTrackSummary["workflowStatus"],
      RegistrationObservationTrackWorkflowStatus
    >>;
    type PublicObservationReadIsExact = Assert<Equal<
      PublicObservationReadStatus,
      RegistrationObservationTrackWorkflowStatus
    >>;
    type PublicGenericReadIsNarrow = Assert<Equal<
      PublicGenericReadStatus,
      OpsRegistrationWorkflowStatus
    >>;
    type PublicGenericReadHasNoObservationKeys = Assert<Equal<
      PublicGenericReadObservationKeys,
      never
    >>;
    type GenericTrackIsNarrow = Assert<Equal<
      OpsRegistrationTrackSummary["workflowStatus"],
      OpsRegistrationWorkflowStatus
    >>;
    type GenericMutationIsNarrow = Assert<Equal<
      GenericMutationStatus,
      OpsRegistrationWorkflowStatus
    >>;
    type PublicObservationDetailIsExact = Assert<Equal<
      PublicObservationDetailStatus,
      RegistrationObservationTrackWorkflowStatus
    >>;
    type ObservationDetailAliasIsExact = Assert<Equal<
      OpsRegistrationObservationCaseDetail["tracks"][number]["workflowStatus"],
      RegistrationObservationTrackWorkflowStatus
    >>;
    type PublicGenericDetailIsNarrow = Assert<Equal<
      PublicGenericDetailStatus,
      OpsRegistrationWorkflowStatus
    >>;
    type ManualObservationStatusCanUseGenericMutation = Assert<Equal<
      Extract<"observation_requested", GenericMutationStatus>,
      "observation_requested"
    >>;
  `);

  assert.deepEqual(diagnostics, []);
});

test("track summaries prefer the manual workflow status and preserve its revision", async () => {
  const { mapTrack } = await loadFactory();

  const explicit = mapTrack({
    id: "track-1",
    task_id: "73000000-0000-4000-8000-000000000001",
    subject: "영어",
    pipeline_status: "waiting",
    workflow_status: "waiting_next_opening",
    workflow_revision: 4,
    workflow_status_entered_at: "2026-08-01T01:00:00.000Z",
  });
  const legacy = mapTrack({
    id: "track-2",
    task_id: "73000000-0000-4000-8000-000000000001",
    subject: "수학",
    pipeline_status: "waiting",
    waiting_kind: "current_class",
  });

  assert.equal(explicit.workflowStatus, "waiting_next_opening");
  assert.equal(explicit.workflowRevision, 4);
  assert.equal(explicit.workflowStatusEnteredAt, "2026-08-01T01:00:00.000Z");
  assert.equal(legacy.workflowStatus, "waiting_current_class");
  assert.equal(legacy.workflowRevision, 1);
});

test("version-2 event parser preserves explicit user, system, and migration actors", async () => {
  const { mapTrackEvent } = await loadFactory();
  const actorFixtures = [
    {
      actorKind: "user",
      actorProfileId: "profile-user",
      systemSource: null,
    },
    {
      actorKind: "system",
      actorProfileId: null,
      systemSource: "registration_reminder_materializer",
    },
    {
      actorKind: "migration",
      actorProfileId: null,
      systemSource: "registration_history_v2_backfill",
    },
  ];

  const mapped = actorFixtures.map((fixture, index) => mapTrackEvent({
    id: `event-v2-${index + 1}`,
    task_id: "73000000-0000-4000-8000-000000000001",
    actor_id: fixture.actorProfileId,
    event_type: "registration_track_event",
    field_name: "registration_track:track-1",
    before_value: null,
    after_value: JSON.stringify({
      version: 2,
      event_type: "consultation_completed",
      actor_profile_id: fixture.actorProfileId,
      actor_kind: fixture.actorKind,
      system_source: fixture.systemSource,
      track_id: "track-1",
      subject: "영어",
      source: "consultation_waiting",
      destination: "enrollment_decided",
      reason_code: "consultation_approved",
      metadata: { consultationId: "consultation-1" },
      occurred_at: "2026-07-16T01:02:03Z",
    }),
    created_at: "2026-07-16T01:02:04Z",
  }));

  assert.deepEqual(
    mapped.map((event) => ({
      payloadVersion: event.payloadVersion,
      eventType: event.eventType,
      actorId: event.actorId,
      actorKind: event.actorKind,
      systemSource: event.systemSource,
      reasonCode: event.reasonCode,
      trackId: event.trackId,
      occurredAt: event.occurredAt,
    })),
    actorFixtures.map((fixture) => ({
      payloadVersion: 2,
      eventType: "consultation_completed",
      actorId: fixture.actorProfileId,
      actorKind: fixture.actorKind,
      systemSource: fixture.systemSource,
      reasonCode: "consultation_approved",
      trackId: "track-1",
      occurredAt: "2026-07-16T01:02:03Z",
    })),
  );
  assert.deepEqual({ ...mapped[0].metadata }, { consultationId: "consultation-1" });
});

test("historical version-1 null actor stays unknown without current-owner inference", async () => {
  const { mapTrackEvent } = await loadFactory();
  const event = mapTrackEvent({
    id: "event-v1-unknown",
    task_id: "73000000-0000-4000-8000-000000000001",
    actor_id: "current-owner-must-not-be-inferred",
    event_type: "registration_track_event",
    field_name: "registration_track:track-1",
    before_value: null,
    after_value: JSON.stringify({
      version: 1,
      eventType: "waiting_transitioned",
      actorId: null,
      trackId: "track-1",
      subject: "수학",
      source: "consultation_waiting",
      destination: "waiting",
      reason: "guardian_requested_delay",
      metadata: {},
      occurredAt: "2026-07-15T09:00:00Z",
    }),
    created_at: "2026-07-15T09:00:01Z",
  });

  assert.equal(event.payloadVersion, 1);
  assert.equal(event.actorId, null);
  assert.equal(event.actorKind, null);
  assert.equal(event.systemSource, null);
  assert.equal(event.reasonCode, "guardian_requested_delay");
});

test("case-created v1 wire payload becomes a safe history entry with recorded actor and time", async () => {
  const { mapTrackEvent } = await loadFactory();
  for (const version of [1, "1"]) {
    const payload = {
      version, actorId: "recorded-creator", occurredAt: "2026-10-09T01:02:03Z",
      campus: "PRIVATE_CAMPUS", studentName: "PRIVATE_STUDENT", commonRevision: 1,
      // Case creation is a separate producer contract, not a track envelope.
      eventType: "notification_delivery", metadata: { place: "PRIVATE_METADATA" },
    };
    for (const afterValue of [JSON.stringify(payload), payload]) {
      const row = {
        id: "case-created", task_id: "synthetic-task", event_type: "registration_case_created",
        actor_id: "current-owner", created_at: "2026-10-09T02:00:00Z", after_value: afterValue,
      };
      const before = structuredClone(row);
      const event = mapTrackEvent(row);
      const [item] = buildRegistrationSubjectHistory({ events: [event] });
      assert.equal(event.payloadVersion, 1);
      assert.equal(event.legacyText, null);
      assert.equal(item.title, "등록 문의 생성");
      assert.equal(item.actorKind, "user");
      assert.equal(item.actorId, "recorded-creator");
      assert.equal(item.occurredAt, payload.occurredAt);
      assert.equal(item.timeKind, "exact");
      assert.equal(item.origin, "canonical");
      assert.doesNotMatch(JSON.stringify(item), /PRIVATE_|current-owner|notification_delivery/);
      assert.deepEqual(row, before);
    }
  }
});

test("case-created history never borrows missing actor or occurrence time from other fields", async () => {
  const { mapTrackEvent } = await loadFactory();
  for (const missing of [null, undefined, "", {}, "invalid"]) {
    const event = mapTrackEvent({
      id: "case-created", event_type: "registration_case_created",
      actor_id: "current-owner", created_at: "2026-10-09T02:00:00Z",
      after_value: JSON.stringify({ version: 1, actorId: missing === "invalid" ? null : missing, occurredAt: missing }),
    });
    const [item] = buildRegistrationSubjectHistory({ events: [event] });
    assert.equal(item.title, "등록 문의 생성");
    assert.equal(item.actorId, null);
    assert.equal(item.actorKind, null);
    assert.equal(item.occurredAt, null);
    assert.equal(item.timeKind, "unavailable");
    assert.doesNotMatch(JSON.stringify(item), /current-owner|2026-10-09T02/);
  }
});

test("unrecognized case payloads use safe titles without promoting unverified actor or time", async () => {
  const { mapTrackEvent } = await loadFactory();
  for (const afterValue of [
    '{"version":1,"campus":"PRIVATE_BROKEN"',
    JSON.stringify({ version: 3, actorId: "PRIVATE_ACTOR", occurredAt: "2026-10-09T01:00:00Z" }),
    JSON.stringify(["PRIVATE_ARRAY"]), '"PRIVATE_STRING"', "null", null,
  ]) {
    const [item] = buildRegistrationSubjectHistory({ events: [mapTrackEvent({
      id: "case-created", event_type: "registration_case_created", after_value: afterValue,
      actor_id: "current-owner", created_at: "2026-10-09T02:00:00Z",
    })] });
    assert.equal(item.title, "등록 문의 생성");
    assert.equal(item.actorId, null);
    assert.equal(item.actorKind, null);
    assert.equal(item.occurredAt, null);
    assert.doesNotMatch(item.title + item.description, /PRIVATE_|current-owner/);
  }
});

test("case-created timestamps require a complete valid instant, preserving explicit offsets", async () => {
  const { mapTrackEvent } = await loadFactory();
  for (const occurredAt of ["2026", "2026-10-09", "2026-10-09T01:02:03", "2026-02-30T01:02:03Z", "2026-10-09T24:00:00Z", "2026-10-09T01:60:00Z"]) {
    const event = mapTrackEvent({ event_type: "registration_case_created", after_value: { version: 1, occurredAt } });
    const [item] = buildRegistrationSubjectHistory({ events: [event] });
    assert.equal(item.timeKind, "unavailable", occurredAt);
    assert.equal(item.occurredAt, null);
  }
  for (const occurredAt of ["2026-10-09T01:02:03.123456+00:00", "2024-02-29T01:02:03+09:00"]) {
    const event = mapTrackEvent({ event_type: "registration_case_created", after_value: { version: 1, occurredAt } });
    assert.equal(event.occurredAt, occurredAt);
  }
});

test("migration legacy snapshot follows H2 evidence and ignores unrelated detail text", async () => {
  const { buildRegistrationMigrationLegacySnapshot } = await loadFactory();
  const result = buildRegistrationMigrationLegacySnapshot(
    { student_id: "current-student", class_id: "current-class", textbook_id: "current-textbook" },
    {
      request_note: "방문 희망",
      textbook_preparation: "준비",
      counselor: "원장",
      level_test_place: "",
      level_test_material_link: "",
      level_test_result: "",
      visit_consultation_place: "",
    },
    [{
      event_type: "legacy_registration_imported",
      before_value: JSON.stringify({
        pipelineStatus: "5. 등록 결정",
        studentId: "legacy-student",
        classId: "legacy-class",
        textbookId: "legacy-textbook",
      }),
      after_value: JSON.stringify({
        version: 1,
        eventType: "legacy_registration_imported",
        timestamps: {},
        legacyBooleans: {},
      }),
    }],
  );

  assert.equal(result.studentId, "legacy-student");
  assert.equal(result.classId, "legacy-class");
  assert.equal(result.textbookId, "legacy-textbook");
  assert.equal(result.currentStudentId, "current-student");
  assert.equal(result.groups.levelTest, false);
  assert.equal(result.groups.consultation, false);
  assert.equal(result.groups.placement, true);
});

test("migration legacy snapshot uses immutable timestamps plus only H2 detail evidence", async () => {
  const { buildRegistrationMigrationLegacySnapshot } = await loadFactory();
  const result = buildRegistrationMigrationLegacySnapshot(
    {},
    {
      level_test_place: "본관",
      level_test_material_link: "https://drive.test/result",
      level_test_result: "통과",
      visit_consultation_place: "상담실",
    },
    [{
      event_type: "legacy_registration_imported",
      before_value: JSON.stringify({ pipelineStatus: "2. 상담" }),
      after_value: JSON.stringify({
        version: 1,
        eventType: "legacy_registration_imported",
        timestamps: {
          levelTestAt: "2026-07-12T01:00:00Z",
          phoneConsultationAt: "2026-07-13T01:00:00Z",
        },
        legacyBooleans: {},
      }),
    }],
  );

  assert.equal(result.groups.levelTest, true);
  assert.equal(result.groups.consultation, true);
  assert.equal(result.groups.placement, false);
  assert.equal(result.levelTestAt, "2026-07-12T01:00:00Z");
  assert.equal(result.phoneConsultationAt, "2026-07-13T01:00:00Z");
});

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createClient({ queryHandler, rpcHandler, contactHandler, eventHandler } = {}) {
  const queries = [];
  const rpcCalls = [];
  const rpcRequests = [];
  let activeQueries = 0;
  let maxActiveQueries = 0;
  let abortedQueries = 0;

  function execute(query) {
    queries.push({
      ...query,
      filters: query.filters.map((filter) => [...filter]),
      limits: query.limits.map(([value, options]) => [value, options ? { ...options } : options]),
    });
    activeQueries += 1;
    maxActiveQueries = Math.max(maxActiveQueries, activeQueries);
    return Promise.resolve(queryHandler?.(query) ?? { data: [], error: null })
      .finally(() => {
        activeQueries -= 1;
      });
  }

  function builder(table) {
    const query = {
      table,
      columns: "",
      options: undefined,
      filters: [],
      order: [],
      limit: null,
      limits: [],
      signal: null,
      retryEnabled: null,
      single: false,
    };
    const fluent = {
      abortSignal(signal) {
        query.signal = signal;
        if (signal.aborted) {
          abortedQueries += 1;
        } else {
          signal.addEventListener("abort", () => { abortedQueries += 1; }, { once: true });
        }
        return fluent;
      },
      retry(enabled) {
        query.retryEnabled = enabled;
        return fluent;
      },
      select(columns, options) {
        query.columns = columns;
        query.options = options;
        return fluent;
      },
      eq(column, value) {
        query.filters.push(["eq", column, value]);
        return fluent;
      },
      is(column, value) {
        query.filters.push(["is", column, value]);
        return fluent;
      },
      neq(column, value) {
        query.filters.push(["neq", column, value]);
        return fluent;
      },
      not(column, operator, value) {
        query.filters.push(["not", column, operator, value]);
        return fluent;
      },
      or(filters) {
        query.filters.push(["or", filters]);
        return fluent;
      },
      gte(column, value) {
        query.filters.push(["gte", column, value]);
        return fluent;
      },
      lt(column, value) {
        query.filters.push(["lt", column, value]);
        return fluent;
      },
      in(column, values) {
        query.filters.push(["in", column, [...values]]);
        return fluent;
      },
      order(column, options) {
        query.order.push([column, options]);
        return fluent;
      },
      limit(value, options) {
        query.limits.push([value, options]);
        if (!options?.referencedTable && !options?.foreignTable) query.limit = value;
        return fluent;
      },
      single() {
        query.single = true;
        return fluent;
      },
      then(resolve, reject) {
        return execute(query).then(resolve, reject);
      },
    };
    return fluent;
  }

  return {
    queries,
    rpcCalls,
    rpcRequests,
    getAbortedQueryCount: () => abortedQueries,
    getMaxActiveQueries: () => maxActiveQueries,
    client: {
      from: builder,
      rpc(name, args) {
        const rpcRequest = { name, args, signal: null, retryEnabled: null };
        const run = async () => {
        rpcCalls.push([name, args]);
        rpcRequests.push(rpcRequest);
        if (name === "read_registration_contact_events_v1") {
          assert.deepEqual({ ...args }, { p_task_id: CONTACT_TASK, p_limit: 30, p_shared_only: true });
          return eventHandler ? eventHandler(args) : eventRpcResult(detailRows("ops_task_events").data);
        }
        if (name === "get_registration_case_contact_v1" && contactHandler) return contactHandler(args);
        if (name === "get_registration_case_contact_v1") return { data: { version: 1, taskId: args.p_task_id, revision: "1", generation: "1", phase: "open", closureReason: null, closedAt: null, parentPhone: null, studentId: null, commonRevision: 1, allPhasesClosed: false, currentTrackIds: ["73000000-0000-4000-8000-000000000030"] }, error: null };
        if (rpcHandler) return rpcHandler(name, args);
        if (name === "get_registration_customer_reminder_summaries_v1") {
          return {
            data: [{
              appointment_id: "appointment-1",
              state: "scheduled",
              scheduled_for: "2026-07-13T01:00:00.000Z",
              sent_at: null,
              updated_at: "2026-07-12T02:00:00.000Z",
            }],
            error: null,
          };
        }
        return { data: { ok: true }, error: null };
        };
        const request = {
          abortSignal(signal) { rpcRequest.signal = signal; return request; },
          retry(enabled) { rpcRequest.retryEnabled = enabled; return request; },
          then(resolve, reject) { return run().then(resolve, reject); },
        };
        return request;
      },
    },
  };
}

function readyOptions(overrides = {}) {
  return {
    probeRuntime: async () => ({ mode: "ready", version: 1 }),
    probeIntakeRuntime: async () => ({ available: true, version: 1 }),
    probeObservationRuntime: async () => ({ available: true, runtimeVersion: 1 }),
    invalidateRuntimeAfterReadyFailure(error) {
      const integrityError = new Error("runtime integrity failure");
      integrityError.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrityError.cause = error;
      throw integrityError;
    },
    now: () => 1,
    randomUUID: () => "uuid-from-options",
    invalidatePublicClassesCacheAfterMutation: async (_client, reason) => ({
      status: "refreshed",
      reason,
      requestId: "public-cache-refresh",
    }),
    ...overrides,
  };
}

const inertObservationSummaryRow = {
  observation_attempt_count: 0,
  observation_current_id: null,
  observation_current_status: null,
  observation_current_appointment_id: null,
  observation_nearest_scheduled_at: null,
  observation_nearest_place: null,
  observation_notification_revision: null,
  observation_revision: null,
  observation_feedback_revision: null,
};

const observationSummaryObjectKeys = [
  "observationAttemptCount",
  "observationCurrentId",
  "observationCurrentStatus",
  "observationCurrentAppointmentId",
  "observationNearestScheduledAt",
  "observationNearestPlace",
  "observationNotificationRevision",
  "observationRevision",
  "observationFeedbackRevision",
  "observationSummaryVisible",
];

function summaryRowForProjection(columns) {
  return {
    id: "track-1",
    task_id: "73000000-0000-4000-8000-000000000001",
    subject: "영어",
    pipeline_status: "consultation_waiting",
    workflow_status: "consultation_completed",
    workflow_revision: 3,
    director_profile_id: null,
    ...(columns.includes("observation_attempt_count")
      ? inertObservationSummaryRow
      : {}),
  };
}

test("generic summary never probes observation runtime and survives a rejected probe", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let observationProbeCalls = 0;
  const harness = createClient({
    queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      throw new Error("observation probe rejected");
    },
  }));

  const result = await service.loadLegacyCompatibleTrackSummaries(
    ["73000000-0000-4000-8000-000000000001"],
    "shared-viewer",
  );

  assert.equal(result.mode, "ready");
  assert.equal(result.tracks[0].id, "track-1");
  assert.equal(observationProbeCalls, 0);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  for (const key of observationSummaryObjectKeys) {
    assert.equal(
      Object.hasOwn(result.tracks[0], key),
      false,
      `generic summary must not own ${key}`,
    );
  }
});

test("a rejected observation probe cannot poison a later generic or observation summary read", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let rejectObservationProbe = true;
  let observationProbeCalls = 0;
  const harness = createClient({
    queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      if (rejectObservationProbe) throw new Error("observation probe rejected");
      return { available: true, runtimeVersion: 1 };
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "same-viewer"),
    /observation probe rejected/,
  );
  const generic = await service.loadLegacyCompatibleTrackSummaries(
    ["73000000-0000-4000-8000-000000000001"],
    "same-viewer",
  );
  rejectObservationProbe = false;
  const observation = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "same-viewer");

  assert.equal(observationProbeCalls, 2);
  assert.equal(harness.queries.length, 2);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  assert.match(harness.queries[1].columns, /observation_attempt_count/);
  for (const key of observationSummaryObjectKeys) {
    assert.equal(Object.hasOwn(generic.tracks[0], key), false);
  }
  assert.equal(observation.tracks[0].observationSummaryVisible, true);
});

test("observation summary refreshes an unforced same-viewer cache when runtime changes from 0 to 1", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let observationRuntimeVersion = 0;
  let observationProbeCalls = 0;
  const measures = [];
  const harness = createClient({
    queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      return {
        available: observationRuntimeVersion === 1,
        runtimeVersion: observationRuntimeVersion,
      };
    },
    recordMeasure: (measure) => measures.push({ ...measure }),
  }));

  const unavailable = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "same-viewer");
  observationRuntimeVersion = 1;
  const available = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "same-viewer");

  assert.equal(unavailable.tracks[0].observationSummaryVisible, false);
  assert.equal(available.tracks[0].observationSummaryVisible, true);
  assert.equal(observationProbeCalls, 2);
  assert.equal(harness.queries.length, 2);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  assert.match(harness.queries[1].columns, /observation_attempt_count/);
  assert.deepEqual(
    measures.map(({ name, cacheHit, queryCount }) => ({ name, cacheHit, queryCount })),
    [
      { name: "registration:track-summary:observation", cacheHit: false, queryCount: 1 },
      { name: "registration:track-summary:observation", cacheHit: false, queryCount: 1 },
    ],
  );
});

test("observation runtime identity separates an unavailable in-flight read from a newly available read", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const unavailableQueryStarted = deferred();
  const unavailableQueryGate = deferred();
  let observationRuntimeVersion = 0;
  let observationProbeCalls = 0;
  const harness = createClient({
    queryHandler(query) {
      const result = { data: [summaryRowForProjection(query.columns)], error: null };
      if (!query.columns.includes("observation_attempt_count")) {
        unavailableQueryStarted.resolve();
        return unavailableQueryGate.promise.then(() => result);
      }
      return result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => {
      observationProbeCalls += 1;
      return {
        available: observationRuntimeVersion === 1,
        runtimeVersion: observationRuntimeVersion,
      };
    },
  }));

  const unavailable = service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "same-viewer");
  await unavailableQueryStarted.promise;
  observationRuntimeVersion = 1;
  const available = service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "same-viewer");
  const probeCallsBeforeRelease = observationProbeCalls;
  unavailableQueryGate.resolve();
  const [unavailableResult, availableResult] = await Promise.all([unavailable, available]);

  assert.equal(probeCallsBeforeRelease, 2);
  assert.equal(harness.queries.length, 2);
  assert.equal(unavailableResult.tracks[0].observationSummaryVisible, false);
  assert.equal(availableResult.tracks[0].observationSummaryVisible, true);
  assert.doesNotMatch(harness.queries[0].columns, /observation_attempt_count/);
  assert.match(harness.queries[1].columns, /observation_attempt_count/);
});

test("generic and observation summary modes isolate projection cache inflight epoch and measurement identity", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const order of [["generic", "observation"], ["observation", "generic"]]) {
    let observationRuntimeVersion = 0;
    let observationProbeCalls = 0;
    const measures = [];
    const harness = createClient({
      queryHandler: (query) => ({ data: [summaryRowForProjection(query.columns)], error: null }),
    });
    const service = createRegistrationTrackService(harness.client, readyOptions({
      probeObservationRuntime: async () => {
        observationProbeCalls += 1;
        return {
          available: observationRuntimeVersion === 1,
          runtimeVersion: observationRuntimeVersion,
        };
      },
      recordMeasure: (measure) => measures.push({ ...measure }),
    }));
    const invoke = (mode, force = false) => mode === "generic"
      ? service.loadLegacyCompatibleTrackSummaries(["73000000-0000-4000-8000-000000000001"], "shared-viewer", { force })
      : service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "shared-viewer", { force });

    await invoke(order[0]);
    if (order[0] === "generic") observationRuntimeVersion = 1;
    await invoke(order[1]);
    if (order[0] === "observation") {
      observationRuntimeVersion = 1;
      await invoke("observation", true);
    }

    const queryCountBeforeGenericForce = order[0] === "observation" ? 3 : 2;
    assert.equal(
      harness.queries.length,
      queryCountBeforeGenericForce,
      `separate queries and runtime 0 -> 1 refresh for ${order.join(" -> ")}`,
    );
    const genericQuery = harness.queries.find(
      (query) => !query.columns.includes("observation_attempt_count"),
    );
    const observationQuery = harness.queries.find(
      (query) => query.columns.includes("observation_attempt_count"),
    );
    assert.ok(genericQuery, `generic projection for ${order.join(" -> ")}`);
    assert.ok(observationQuery, `observation projection for ${order.join(" -> ")}`);
    const observationProbeCallsBeforeGenericForce = order[0] === "observation" ? 2 : 1;
    assert.equal(observationProbeCalls, observationProbeCallsBeforeGenericForce);
    assert.deepEqual(new Set(measures.map((measure) => measure.name)), new Set([
      "registration:track-summary:generic",
      "registration:track-summary:observation",
    ]));

    await invoke("generic", true);
    assert.equal(
      observationProbeCalls,
      observationProbeCallsBeforeGenericForce,
      "generic force advances only the generic epoch",
    );
    await invoke("observation");
    assert.equal(
      harness.queries.length,
      queryCountBeforeGenericForce + 1,
      "observation cache survives a generic force refresh",
    );
  }
});


test("manual workflow status uses the bearer contact command with the opened revisions", async () => {

  const {createRegistrationTrackService}=await loadFactory(); const harness=createClient(); const calls=[]; let invalidations=0;
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async command=>{calls.push(command);return contactEnvelope(command,{trackId:CONTACT_TRACK,workflowStatus:"payment_in_progress",workflowRevision:4,workflowStatusEnteredAt:"2026-08-01T03:00:00Z"});},onMutationSuccess:()=>invalidations++}));
  const result=await service.setRegistrationWorkflowStatus({taskId:CONTACT_TASK,contactState:contactState(),trackId:CONTACT_TRACK,workflowStatus:"payment_in_progress",expectedWorkflowRevision:3,requestKey:CONTACT_KEY});
  assert.equal(harness.rpcCalls.length,0); assert.deepEqual(JSON.parse(JSON.stringify(calls)),[{command:"set_workflow_status",taskId:CONTACT_TASK,requestKey:CONTACT_KEY,expectedGeneration:"1",expectedRevision:"1",payload:{trackId:CONTACT_TRACK,workflowStatus:"payment_in_progress",expectedWorkflowRevision:3}}]);
  assert.equal(result.workflowStatus,"payment_in_progress");assert.equal(result.workflowRevision,4);assert.equal(result.enrollmentFinalization,null);assert.deepEqual(Array.from(result.sourceEventIds),[]);assert.equal(invalidations,1);

});

test("registered contact command preserves source receipts without enrolling automatically", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async command=>contactEnvelope(command,{trackId:CONTACT_TRACK,workflowStatus:"registered",workflowRevision:2,sourceEventIds:["source-registration","source-registration"],enrollmentFinalization:null,contactState:contactState({revision:"2",phase:"closed",allPhasesClosed:true,closureReason:"all_current_tracks_terminal",closedAt:"2026-10-09T09:00:00Z"})})}));
  const result=await service.setRegistrationWorkflowStatus({taskId:CONTACT_TASK,contactState:contactState(),trackId:CONTACT_TRACK,workflowStatus:"registered",expectedWorkflowRevision:1,requestKey:CONTACT_KEY});
  assert.equal(result.enrollmentFinalization,null);assert.deepEqual(Array.from(result.sourceEventIds),["source-registration"]);assert.equal(result.contactState.phase,"closed");assert.equal(service.getContactReceipt(CONTACT_TASK).parentPhone,null);assert.equal(harness.rpcCalls.length,0);

});

test("admission checklist saves one independent item through its dedicated RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "set_registration_admission_checklist_item_v1");
      assert.deepEqual({ ...args }, {
        p_task_id: "73000000-0000-4000-8000-000000000001",
        p_item: "registrationCompleted",
        p_checked: true,
        p_request_key: "checklist-request",
      });
      return {
        data: {
          taskId: "73000000-0000-4000-8000-000000000001",
          checklist: {
            applicationSent: false,
            makeeduRegistered: false,
            invoiceSent: false,
            paymentConfirmed: false,
            registrationCompleted: true,
          },
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.setRegistrationAdmissionChecklistItem({
    taskId: "73000000-0000-4000-8000-000000000001",
    item: "registrationCompleted",
    checked: true,
    requestKey: "checklist-request",
  });

  assert.deepEqual(JSON.parse(JSON.stringify(result)), {
    taskId: "73000000-0000-4000-8000-000000000001",
    checklist: {
      applicationSent: false,
      makeeduRegistered: false,
      invoiceSent: false,
      paymentConfirmed: false,
      registrationCompleted: true,
    },
  });
  assert.equal(harness.queries.length, 0);
});

test("registration management notification uses only the explicit v2 producer with one request key", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "ensure_registration_workflow_notification_v2");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-1",
        p_workflow_revision: 4,
        p_request_key: "99710000-0000-4000-8000-000000000901",
        p_intent: "send_registration_management_notification",
      });
      return {
        data: { source_event_ids: ["workflow-event", "workflow-event", null] },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.equal("ensureRegistrationCaseCreatedNotificationSourceIds" in service, false);
  assert.deepEqual(
    Array.from(await service.ensureRegistrationWorkflowNotificationSourceIds({
      trackId: "track-1",
      workflowRevision: 4,
      requestKey: "99710000-0000-4000-8000-000000000901",
    })),
    ["workflow-event"],
  );
  assert.equal(harness.queries.length, 0);
});

test("phone consultation save materializes and maps the persisted consultation", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_phone_consultation_v1");
      assert.deepEqual({ ...args }, {
        p_track_id: "track-phone",
        p_request_key: "phone-request",
      });
      return {
        data: {
          id: "consultation-phone",
          trackId: "track-phone",
          appointmentId: null,
          mode: "phone",
          status: "waiting",
          directorProfileId: "director-1",
          readyAt: "2026-08-03T01:00:00.000Z",
          readySource: "director_resolved",
          completedAt: null,
          outcome: null,
          createdAt: "2026-08-03T01:00:00.000Z",
          updatedAt: "2026-08-03T01:00:00.000Z",
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const consultation = await service.saveRegistrationPhoneConsultation({
    trackId: "track-phone",
    requestKey: "phone-request",
  });

  assert.equal(consultation.id, "consultation-phone");
  assert.equal(consultation.mode, "phone");
  assert.equal(consultation.status, "waiting");
  assert.equal(consultation.readySource, "director_resolved");
});

test("calendar raw loader uses the canonical half-open scheduled query without caching", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const row = {
    appointment_id: "appointment-calendar-1",
    task_id: "task-calendar-1",
    student_name: "김다미",
    kind: "level_test",
    scheduled_at: "2026-07-15T10:00:00+09:00",
    place: "본관 201호",
    status: "scheduled",
    notification_revision: 2,
    track_ids: ["track-calendar-english", "track-calendar-math"],
    subjects: ["영어", "수학"],
  };
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_appointment_calendar");
      return { data: [row], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const input = {
    rangeStart: "2026-07-01T00:00:00+09:00",
    rangeEnd: "2026-08-01T00:00:00+09:00",
    observationRuntimeVersion: 1,
  };

  const first = await service.loadRegistrationAppointmentCalendarRows(input);
  const second = await service.loadRegistrationAppointmentCalendarRows(input);

  assert.deepEqual(JSON.parse(JSON.stringify(first)), [row]);
  assert.deepEqual(JSON.parse(JSON.stringify(second)), [row]);
  assert.equal(harness.queries.length, 2, "calendar range results must not use a cross-viewer cache");
  for (const query of harness.queries) {
    assert.equal(
      query.columns,
      "appointment_id,task_id,student_name,kind,scheduled_at,place,status,notification_revision,track_ids,subjects,observation_id,observation_track_id,observation_class_id,observation_class_name,observation_ends_at,observation_teacher_name,observation_classroom_name",
    );
    assert.deepEqual(query.filters, [
      ["gte", "scheduled_at", input.rangeStart],
      ["lt", "scheduled_at", input.rangeEnd],
      ["in", "status", ["scheduled"]],
    ]);
    assert.deepEqual(JSON.parse(JSON.stringify(query.order)), [
      ["scheduled_at", { ascending: true }],
      ["appointment_id", { ascending: true }],
    ]);
  }
});

test("calendar raw loader selects observation snapshots and excludes them at runtime zero", async () => {
  // Production break caught: the direct view DTO omits a bounded snapshot or a
  // disabled runtime sends observation rows to the browser before model gating.
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  await service.loadRegistrationAppointmentCalendarRows({
    rangeStart: "2026-08-01T00:00:00+09:00",
    rangeEnd: "2026-09-01T00:00:00+09:00",
    observationRuntimeVersion: 0,
  });

  assert.equal(harness.queries.length, 1);
  assert.equal(
    harness.queries[0].columns,
    "appointment_id,task_id,student_name,kind,scheduled_at,place,status,notification_revision,track_ids,subjects,observation_id,observation_track_id,observation_class_id,observation_class_name,observation_ends_at,observation_teacher_name,observation_classroom_name",
  );
  assert.deepEqual(harness.queries[0].filters, [
    ["neq", "kind", "observation_class"],
    ["gte", "scheduled_at", "2026-08-01T00:00:00+09:00"],
    ["lt", "scheduled_at", "2026-09-01T00:00:00+09:00"],
    ["in", "status", ["scheduled"]],
  ]);
});

test("calendar raw loader normalizes explicit statuses and skips an explicit empty selection", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const range = {
    rangeStart: "2026-07-01T00:00:00+09:00",
    rangeEnd: "2026-08-01T00:00:00+09:00",
    observationRuntimeVersion: 1,
  };

  await service.loadRegistrationAppointmentCalendarRows({
    ...range,
    statuses: ["canceled", "completed", "canceled"],
  });
  const empty = await service.loadRegistrationAppointmentCalendarRows({ ...range, statuses: [] });

  assert.deepEqual(harness.queries[0].filters.at(-1), ["in", "status", ["completed", "canceled"]]);
  assert.deepEqual(JSON.parse(JSON.stringify(empty)), []);
  assert.equal(harness.queries.length, 1, "an explicit empty status selection must not query PostgREST");
});

test("calendar raw loader rejects invalid ranges and unsupported statuses before querying", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());

  for (const input of [
    { rangeStart: "invalid", rangeEnd: "2026-08-01T00:00:00+09:00", observationRuntimeVersion: 1 },
    { rangeStart: "2026-08-01T00:00:00+09:00", rangeEnd: "2026-08-01T00:00:00+09:00", observationRuntimeVersion: 1 },
    { rangeStart: "2026-07-01T00:00:00+09:00", rangeEnd: "2026-08-01T00:00:00+09:00", statuses: ["waiting"], observationRuntimeVersion: 1 },
  ]) {
    await assert.rejects(
      Promise.resolve().then(() => service.loadRegistrationAppointmentCalendarRows(input)),
      /registration_calendar_(range|status)_invalid/,
    );
  }
  assert.equal(harness.queries.length, 0);
});

function detailRows(table) {
  if (table === "ops_tasks") {
    return {
      data: {
        id: "73000000-0000-4000-8000-000000000001",
        title: "김다미 등록",
        type: "registration",
        status: "in_progress",
        priority: "normal",
        student_name: "김다미",
        campus: "본관",
        subject: "영어, 수학",
        created_at: "2026-07-12T01:00:00Z",
        updated_at: "2026-07-12T02:00:00Z",
        ops_registration_details: {
          task_id: "73000000-0000-4000-8000-000000000001",
          common_revision: 3,
          pipeline_status: "2. 상담",
          school_grade: "고1",
          school_name: "중앙여고",
          inquiry_at: "2026-07-12T01:00:00Z",
          parent_phone: "01012345678",
          student_phone: "",
          request_note: "방문 희망",
        },
        ops_task_comments: [{
          id: "comment-1",
          task_id: "73000000-0000-4000-8000-000000000001",
          author_id: "profile-1",
          body: "확인",
          created_at: "2026-07-12T01:10:00Z",
        }],
        ops_task_attachments: [{
          id: "attachment-1",
          task_id: "73000000-0000-4000-8000-000000000001",
          file_name: "성적표.pdf",
          file_kind: "pdf",
          drive_file_id: "drive-1",
          drive_link: "https://drive.test/1",
          uploaded_by: "profile-1",
          uploaded_at: "2026-07-12T01:20:00Z",
        }],
      },
      error: null,
    };
  }
  if (table === "ops_registration_subject_tracks") {
    return {
      data: [{
        id: "track-1",
        task_id: "73000000-0000-4000-8000-000000000001",
        subject: "영어",
        pipeline_status: "consultation_waiting",
        observation_attempt_count: 0,
        director_profile_id: "director-1",
        director_assignment_source: "default",
        director_assignment_rule_key: "english:2026:high1",
        waiting_kind: null,
        level_test_retake_decision: null,
        migration_review_required: false,
        stage_entered_at: "2026-07-12T01:30:00Z",
        phone_ready_at: "2026-07-12T01:00:00Z",
        phone_ready_source: "inquiry",
        director: { id: "director-1", name: "강부희" },
        level_tests: [{
          id: "test-1", track_id: "track-1", appointment_id: "appointment-1",
          attempt_number: 1, status: "completed", started_at: "2026-07-13T01:00:00Z",
          completed_at: "2026-07-13T02:00:00Z", material_link: "https://drive.test/test",
        }],
        consultations: [{
          id: "consultation-1", track_id: "track-1", appointment_id: null,
          mode: "phone", status: "waiting", director_profile_id: "director-1",
          ready_at: "2026-07-12T01:00:00Z", ready_source: "level_test_completion",
          completed_at: null, outcome: null,
          created_at: "2026-07-12T01:00:00Z", updated_at: "2026-07-12T02:00:00Z",
        }],
        enrollments: [{
          id: "enrollment-1", track_id: "track-1", student_id: null,
          admission_batch_id: null, class_id: "class-1", textbook_id: null,
          class_start_date: null, class_start_session_key: null,
          class_start_session: null, status: "planned", makeedu_registered: false,
          roster_active: false, roster_released_at: null, roster_release_reason: null,
          roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
        }],
      }],
      error: null,
    };
  }
  if (table === "ops_registration_appointments") {
    return { data: [{
      id: "appointment-1",
      task_id: "73000000-0000-4000-8000-000000000001",
      kind: "visit_consultation",
      scheduled_at: "2026-07-13T01:00:00Z",
      place: "상담실",
      status: "scheduled",
      notification_revision: 2,
      created_at: "2026-07-12T01:00:00Z",
      updated_at: "2026-07-12T02:00:00Z",
    }], count: 1, error: null };
  }
  if (table === "ops_registration_admission_batches") {
    return { data: [{
      id: "batch-1", task_id: "73000000-0000-4000-8000-000000000001", revision_number: 1, status: "draft",
      invoice_sent_at: null, payment_confirmed_at: null,
      created_at: "2026-07-12T01:00:00Z", updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_task_events") {
    return { data: [
      {
        id: EVENT_FIXTURE_IDS.canonical, task_id: "73000000-0000-4000-8000-000000000001", actor_id: EVENT_ACTOR,
        event_type: "registration_track_event", field_name: "registration_track:track-1",
        before_value: null,
        after_value: JSON.stringify({
          version: 1, eventType: "consultation_completed", actorId: EVENT_ACTOR,
          trackId: "track-1", subject: "영어", source: "consultation_waiting",
          destination: "enrollment_decided", reason: null,
          metadata: { consultationId: "consultation-1" },
          occurredAt: "2026-07-12T01:59:00Z",
        }),
        created_at: "2026-07-12T01:59:00Z",
      },
      {
        id: EVENT_FIXTURE_IDS.legacy, task_id: "73000000-0000-4000-8000-000000000001", actor_id: EVENT_ACTOR,
        event_type: "future_event", field_name: "future", before_value: null,
        after_value: "plain future history", created_at: "2026-07-12T02:00:00Z",
      },
    ].sort(compareEventFixtureRows), error: null };
  }
  if (table === "ops_registration_messages") {
    return { data: [{
      id: "message-1", status: "failed", claim_active: true,
      template_key: "admission_application", request_key: "message-key",
      updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_registration_level_tests") {
    return { data: [{
      id: "test-1", track_id: "track-1", appointment_id: "appointment-1",
      attempt_number: 1, status: "completed", started_at: "2026-07-13T01:00:00Z",
      completed_at: "2026-07-13T02:00:00Z", material_link: "https://drive.test/test",
    }], error: null };
  }
  if (table === "ops_registration_consultations") {
    return { data: [{
      id: "consultation-1", track_id: "track-1", appointment_id: null,
      mode: "phone", status: "waiting", director_profile_id: "director-1",
      ready_at: "2026-07-12T01:00:00Z", ready_source: "level_test_completion",
      completed_at: null, outcome: null,
      created_at: "2026-07-12T01:00:00Z", updated_at: "2026-07-12T02:00:00Z",
    }], error: null };
  }
  if (table === "ops_registration_enrollments") {
    return { data: [{
      id: "enrollment-1", track_id: "track-1", student_id: null,
      admission_batch_id: null, class_id: "class-1", textbook_id: null,
      class_start_date: null, class_start_session_key: null,
      class_start_session: null, status: "planned", makeedu_registered: false,
      roster_active: false, roster_released_at: null, roster_release_reason: null,
      roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
    }], count: 1, error: null };
  }
  throw new Error(`unexpected detail table: ${table}`);
}

const caseDetailObservationSecrets = {
  scheduledAt: "2026-08-14T09:37:00+09:00",
  place: "비공개 청강 교실 907호",
  reason: "보호자 요청: 다른 학생에게 알리지 말 것",
  afterValue: "private-observation-audit-after-value",
};

function toPostgresJsonbText(value) {
  return JSON.stringify(value).replaceAll('\":', '\": ');
}

function compareEventFixtureRows(left, right) {
  return Date.parse(right.created_at) - Date.parse(left.created_at) || left.id.localeCompare(right.id);
}

function eventRpcResult(events, legacyImport = null) {
  return { data: { events, legacyImport }, error: null };
}

function legacyImportEventFixture(overrides = {}) {
  return {
    id: "76000000-0000-4000-8000-000000000090", task_id: CONTACT_TASK, actor_id: null,
    event_type: "legacy_registration_imported", field_name: "registration_legacy",
    before_value: JSON.stringify({ pipelineStatus: "5. 등록 결정", studentId: BIND_STUDENT,
      classId: "76000000-0000-4000-8000-000000000091", textbookId: "76000000-0000-4000-8000-000000000092" }),
    after_value: JSON.stringify({ version: 1, eventType: "legacy_registration_imported", trackId: CONTACT_TRACK,
      timestamps: { levelTestAt: "2026-07-01T01:00:00Z", classStartDate: "2026-07-20", classStartSession: "1회차" },
      legacyBooleans: { admissionNoticeSent: false, makeeduRegistered: false, makeeduInvoiceSent: false, paymentChecked: false } }),
    created_at: "2026-07-01T02:00:00Z", ...overrides,
  };
}

function latestThirtyEventFixtures() {
  const canonical = detailRows("ops_task_events").data.find((row) => row.id === EVENT_FIXTURE_IDS.canonical);
  return Array.from({ length: 30 }, (_, index) => ({ ...canonical,
    id: `76000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`,
  }));
}

function migrationReviewQueryFixture(query) {
  const result = detailRows(query.table);
  if (query.table === "ops_registration_subject_tracks") {
    return { ...result, data: result.data.map((row) => ({ ...row, migration_review_required: true })) };
  }
  return result;
}

// The response fixture models the existing server shared-visibility predicate.
// The imported host reader validates these RPC rows; the mock does no redaction.
function sharedEventRpcFixture(args) {
  assert.deepEqual({ ...args }, { p_task_id: CONTACT_TASK, p_limit: 30, p_shared_only: true });
  const result = detailRowsWithObservationSecrets({ table: "ops_task_events", filters: [
    ["eq", "task_id", args.p_task_id], ["eq", "registration_task_event_shared_visible", args.p_shared_only],
  ] });
  return { ...result, data: { events: result.data, legacyImport: null } };
}

function detailRowsWithObservationSecrets(query) {
  const result = detailRows(query.table);
  const hasExactFilter = (expected) => query.filters.some((filter) => (
    filter.length === expected.length
    && filter.every((value, index) => value === expected[index])
  ));
  const hidesObservationAppointments = hasExactFilter([
    "neq", "kind", "observation_class",
  ]);
  const usesSharedVisibilityComputedField = hasExactFilter([
    "eq", "registration_task_event_shared_visible", true,
  ]);
  const usesLegacyTextRegex = query.filters.some((filter) => filter[0] === "or");
  if (query.table === "ops_registration_subject_tracks") {
    return {
      ...result,
      data: result.data.map((row) => ({
        ...row,
        workflow_status: "consultation_requested",
        workflow_revision: 4,
        ...inertObservationSummaryRow,
      })),
    };
  }
  if (query.table === "ops_registration_appointments") {
    return {
      ...result,
      data: [
        ...result.data,
        {
          id: "appointment-observation-private",
          task_id: "73000000-0000-4000-8000-000000000001",
          kind: "observation_class",
          scheduled_at: caseDetailObservationSecrets.scheduledAt,
          place: caseDetailObservationSecrets.place,
          status: "scheduled",
          notification_revision: 7,
          created_at: "2026-08-10T01:00:00Z",
          updated_at: "2026-08-10T02:00:00Z",
        },
        {
          id: "appointment-observation-canceled",
          task_id: "73000000-0000-4000-8000-000000000001",
          kind: "observation_class",
          scheduled_at: "2026-08-13T08:00:00+09:00",
          place: "취소된 청강 교실",
          status: "canceled",
          notification_revision: 4,
          created_at: "2026-08-09T01:00:00Z",
          updated_at: "2026-08-09T02:00:00Z",
        },
      ].filter((row) => !hidesObservationAppointments || row.kind !== "observation_class"),
    };
  }
  if (query.table === "ops_task_events") {
    return {
      ...result,
      data: [
        ...result.data,
        {
          id: EVENT_FIXTURE_IDS.observationReason,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: EVENT_ACTOR,
          event_type: "registration_track_event",
          field_name: "registration_observation:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: "registration_observation_withdrawn",
            actor_profile_id: EVENT_ACTOR,
            actor_kind: "user",
            system_source: null,
            track_id: "track-1",
            subject: "영어",
            source: "observation_feedback_pending",
            destination: "consultation_completed",
            reason_code: "director_correction",
            metadata: {
              reason: caseDetailObservationSecrets.reason,
              afterValue: caseDetailObservationSecrets.afterValue,
            },
            occurred_at: "2026-08-14T10:00:00+09:00",
          }),
          created_at: "2026-08-14T01:00:00Z",
        },
        {
          id: EVENT_FIXTURE_IDS.observationLegacy,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: EVENT_ACTOR,
          event_type: "registration_observation_audit_payload",
          field_name: "registration_observation:track-1",
          before_value: null,
          after_value: caseDetailObservationSecrets.afterValue,
          created_at: "2026-08-14T01:01:00Z",
        },
        {
          id: EVENT_FIXTURE_IDS.observationV1,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: EVENT_ACTOR,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: JSON.stringify({
            version: 1,
            eventType: "registration_observation_withdrawn",
            actorId: EVENT_ACTOR,
            trackId: "track-1",
            subject: "영어",
            source: "observation_feedback_pending",
            destination: "consultation_completed",
            reason: caseDetailObservationSecrets.reason,
            metadata: { afterValue: caseDetailObservationSecrets.afterValue },
            occurredAt: "2026-08-14T10:01:00+09:00",
          }),
          created_at: "2026-08-14T01:01:30Z",
        },
        {
          id: EVENT_FIXTURE_IDS.publicV2,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: EVENT_ACTOR,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: "registration_consultation_completed",
            actor_profile_id: EVENT_ACTOR,
            actor_kind: "user",
            system_source: null,
            track_id: "track-1",
            subject: "영어",
            source: "consultation_requested",
            destination: "consultation_completed",
            reason_code: null,
            metadata: {
              consultationId: "consultation-public",
              nestedAudit: {
                version: 2,
                event_type: "registration_observation_reference_only",
              },
            },
            occurred_at: "2026-08-14T10:02:00+09:00",
          }),
          created_at: "2026-08-14T01:02:00Z",
        },
        {
          id: EVENT_FIXTURE_IDS.legacyNull,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "legacy_history_marker",
          field_name: "legacy",
          before_value: null,
          after_value: null,
          created_at: "2026-08-14T01:03:00Z",
        },
        {
          id: EVENT_FIXTURE_IDS.nonTrack,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "customer_message_sent",
          field_name: "customer_message",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: "registration_observation_reference_only",
          }),
          created_at: "2026-08-14T01:03:30Z",
        },
        {
          id: EVENT_FIXTURE_IDS.outerWhitespace,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: " registration_observation_reference_only",
          field_name: "legacy_whitespace",
          before_value: null,
          after_value: null,
          created_at: "2026-08-14T01:03:40Z",
        },
        {
          id: EVENT_FIXTURE_IDS.innerWhitespace,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: " registration_observation_reference_only",
          }),
          created_at: "2026-08-14T01:03:50Z",
        },
        {
          id: EVENT_FIXTURE_IDS.innerArray,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 2,
            event_type: ["registration_observation_reference_only"],
          }),
          created_at: "2026-08-14T01:03:55Z",
        },
        {
          id: EVENT_FIXTURE_IDS.malformed,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: '{malformed "version": 2 "event_type": "registration_observation_nested"',
          created_at: "2026-08-14T01:04:00Z",
        },
        {
          id: EVENT_FIXTURE_IDS.jsonNonV2,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: 20,
            event_type: "registration_observation_future_shape",
            metadata: { note: "unknown payload version stays legacy" },
          }),
          created_at: "2026-08-14T01:05:00Z",
        },
        {
          id: EVENT_FIXTURE_IDS.stringVersionNearMiss,
          task_id: "73000000-0000-4000-8000-000000000001",
          actor_id: null,
          event_type: "registration_track_event",
          field_name: "registration_track:track-1",
          before_value: null,
          after_value: toPostgresJsonbText({
            version: "2.0",
            event_type: "registration_observation_future_shape",
          }),
          created_at: "2026-08-14T01:06:00Z",
        },
      ].filter((row) => {
        if (usesSharedVisibilityComputedField) {
          return ![
            EVENT_FIXTURE_IDS.observationReason,
            EVENT_FIXTURE_IDS.observationLegacy,
            EVENT_FIXTURE_IDS.observationV1,
          ].includes(row.id);
        }
        if (usesLegacyTextRegex) {
          if (row.event_type.startsWith("registration_observation_")) return false;
          const legacyText = String(row.after_value || "");
          if (
            row.event_type === "registration_track_event"
            && legacyText.includes('\"version\": 2')
            && legacyText.includes('\"event_type\": \"registration_observation_')
          ) return false;
        }
        return true;
      }).sort(compareEventFixtureRows),
    };
  }
  return result;
}

function assertCaseDetailOmitsObservationSecrets(detail) {
  const payload = JSON.stringify(detail);
  const publicV2 = detail.events.find((event) => event.id === EVENT_FIXTURE_IDS.publicV2);
  const legacyNull = detail.events.find((event) => event.id === EVENT_FIXTURE_IDS.legacyNull);
  const nonTrack = detail.events.find(
    (event) => event.id === EVENT_FIXTURE_IDS.nonTrack,
  );
  const malformed = detail.events.find((event) => event.id === EVENT_FIXTURE_IDS.malformed);
  const jsonNonV2 = detail.events.find((event) => event.id === EVENT_FIXTURE_IDS.jsonNonV2);
  const stringVersionNearMiss = detail.events.find(
    (event) => event.id === EVENT_FIXTURE_IDS.stringVersionNearMiss,
  );
  assert.deepEqual({
    appointmentIds: Array.from(detail.appointments, (appointment) => appointment.id),
    eventIds: Array.from(detail.events, (event) => event.id),
    observationAppointmentKinds: Array.from(
      detail.appointments.filter((appointment) => appointment.kind === "observation_class"),
      (appointment) => appointment.kind,
    ),
    observationEventTypes: Array.from(
      detail.events.filter((event) => event.eventType.startsWith("registration_observation_")),
      (event) => event.eventType,
    ),
    preservedEventShapes: {
      publicV2: publicV2 ? {
        eventType: publicV2.eventType,
        metadata: JSON.parse(JSON.stringify(publicV2.metadata)),
      } : null,
      legacyNull: legacyNull ? {
        eventType: legacyNull.eventType,
        legacyText: legacyNull.legacyText,
      } : null,
      nonTrack: nonTrack ? {
        eventType: nonTrack.eventType,
        legacyText: nonTrack.legacyText,
      } : null,
      malformed: malformed ? {
        eventType: malformed.eventType,
        legacyText: malformed.legacyText,
      } : null,
      jsonNonV2: jsonNonV2 ? {
        eventType: jsonNonV2.eventType,
        legacyText: jsonNonV2.legacyText,
      } : null,
      stringVersionNearMiss: stringVersionNearMiss ? {
        eventType: stringVersionNearMiss.eventType,
        legacyText: stringVersionNearMiss.legacyText,
      } : null,
    },
    exposedSecrets: {
      scheduledAt: payload.includes(caseDetailObservationSecrets.scheduledAt),
      place: payload.includes(caseDetailObservationSecrets.place),
      reason: payload.includes(caseDetailObservationSecrets.reason),
      afterValue: payload.includes(caseDetailObservationSecrets.afterValue),
    },
  }, {
    appointmentIds: ["appointment-1"],
    eventIds: [
      EVENT_FIXTURE_IDS.stringVersionNearMiss,
      EVENT_FIXTURE_IDS.jsonNonV2,
      EVENT_FIXTURE_IDS.malformed,
      EVENT_FIXTURE_IDS.innerArray,
      EVENT_FIXTURE_IDS.innerWhitespace,
      EVENT_FIXTURE_IDS.outerWhitespace,
      EVENT_FIXTURE_IDS.nonTrack,
      EVENT_FIXTURE_IDS.legacyNull,
      EVENT_FIXTURE_IDS.publicV2,
      EVENT_FIXTURE_IDS.legacy,
      EVENT_FIXTURE_IDS.canonical,
    ],
    observationAppointmentKinds: [],
    observationEventTypes: [],
    preservedEventShapes: {
      publicV2: {
        eventType: "registration_consultation_completed",
        metadata: {
          consultationId: "consultation-public",
          nestedAudit: {
            version: 2,
            event_type: "registration_observation_reference_only",
          },
        },
      },
      legacyNull: {
        eventType: "legacy_history_marker",
        legacyText: null,
      },
      nonTrack: {
        eventType: "customer_message_sent",
        legacyText: toPostgresJsonbText({
          version: 2,
          event_type: "registration_observation_reference_only",
        }),
      },
      malformed: {
        eventType: "registration_track_event",
        legacyText: '{malformed "version": 2 "event_type": "registration_observation_nested"',
      },
      jsonNonV2: {
        eventType: "registration_track_event",
        legacyText: toPostgresJsonbText({
          version: 20,
          event_type: "registration_observation_future_shape",
          metadata: { note: "unknown payload version stays legacy" },
        }),
      },
      stringVersionNearMiss: {
        eventType: "registration_track_event",
        legacyText: toPostgresJsonbText({
          version: "2.0",
          event_type: "registration_observation_future_shape",
        }),
      },
    },
    exposedSecrets: {
      scheduledAt: false,
      place: false,
      reason: false,
      afterValue: false,
    },
  });
}

function assertCaseDetailUsesServerPrivacyFilters(harness) {
  const hasQueryFilter = (query, method, column, expectedValue) => query.filters.some((filter) => (
    filter[0] === method
    && filter[1] === column
    && JSON.stringify(filter[2]) === JSON.stringify(expectedValue)
  ));
  const appointmentQueries = harness.queries.filter(
    (query) => query.table === "ops_registration_appointments",
  );
  const scheduledAppointmentQuery = appointmentQueries.find((query) => (
    hasQueryFilter(query, "in", "status", ["scheduled"])
  ));
  const appointmentHistoryQuery = appointmentQueries.find((query) => (
    hasQueryFilter(query, "in", "status", ["completed", "canceled"])
  ));
  const eventRequest = harness.rpcRequests.find((request) => request.name === "read_registration_contact_events_v1");
  assert.ok(eventRequest, "shared history must use the bounded event RPC");
  assert.equal(eventRequest.retryEnabled, false);
  assert.ok(eventRequest.signal instanceof AbortSignal);
  assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false, "no raw event-table fallback");
  assert.deepEqual(JSON.parse(JSON.stringify({
    scheduledAppointmentFilters: scheduledAppointmentQuery?.filters,
    appointmentHistoryFilters: appointmentHistoryQuery?.filters,
    eventArguments: eventRequest.args,
  })), {
    scheduledAppointmentFilters: [
      ["eq", "task_id", "73000000-0000-4000-8000-000000000001"],
      ["neq", "kind", "observation_class"],
      ["in", "status", ["scheduled"]],
    ],
    appointmentHistoryFilters: [
      ["eq", "task_id", "73000000-0000-4000-8000-000000000001"],
      ["neq", "kind", "observation_class"],
      ["in", "status", ["completed", "canceled"]],
    ],
    eventArguments: { p_task_id: CONTACT_TASK, p_limit: 30, p_shared_only: true },
  });
}

test("track summary loader uses the exact safe projection and skips profile lookup without directors", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "73000000-0000-4000-8000-000000000001", subject: "영어",
        pipeline_status: "visit_consultation_scheduled", director_profile_id: null,
        workflow_status: "observation_feedback_pending",
        observation_return_workflow_status: "consultation_completed",
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        level_test_scheduled_at: "2026-07-12T05:00:00Z", level_test_place: "본관",
        visit_scheduled_at: "2026-07-13T01:00:00Z", visit_place: "상담실",
        enrollment_detail_rows: [{
          classId: "class-1", textbookId: null, classStartDate: "2026-08-10",
          classStartSessionKey: null, classStartLessonSessionId: null,
          classStartSession: "청강 회차",
          classStartSourceObservationId: "75000000-0000-4000-8000-000000000001",
          sortOrder: 0,
        }],
        observation_attempt_count: 2,
        observation_current_id: "10000000-0000-4000-8000-000000000003",
        observation_current_status: "scheduled",
        observation_current_appointment_id: "10000000-0000-4000-8000-000000000004",
        observation_nearest_scheduled_at: "2026-08-12T09:00:00.000Z",
        observation_nearest_place: "본관",
        observation_notification_revision: 3,
        observation_revision: 4,
        observation_feedback_revision: 1,
        updated_at: "2026-07-12T02:00:00Z",
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1");

  assert.equal(result.mode, "ready");
  const { enrollmentDetailRows, ...track } = result.tracks[0];
  assert.deepEqual({ ...track }, {
    id: "track-1", taskId: "73000000-0000-4000-8000-000000000001", subject: "영어",
    status: "visit_consultation_scheduled", workflowStatus: "observation_feedback_pending",
    workflowRevision: 1, workflowStatusEnteredAt: "", observationReturnWorkflowStatus: "consultation_completed", legacy: false, directorProfileId: null,
    directorName: "", directorAssignmentSource: "", directorAssignmentRuleKey: "",
    waitingKind: "", waitingDetailKind: "", waitingDetailClassId: null, waitingDetailRetakeDecision: "", levelTestRetakeDecision: "", migrationReviewRequired: false,
    stageEnteredAt: "2026-07-12T01:00:00Z",
    phoneReadyAt: null, phoneReadySource: null,
    levelTestScheduledAt: "2026-07-12T05:00:00Z", levelTestPlace: "본관",
    visitScheduledAt: "2026-07-13T01:00:00Z", visitPlace: "상담실",
    observationAttemptCount: 2,
    observationCurrentId: "10000000-0000-4000-8000-000000000003",
    observationCurrentStatus: "scheduled",
    observationCurrentAppointmentId: "10000000-0000-4000-8000-000000000004",
    observationNearestScheduledAt: "2026-08-12T09:00:00.000Z",
    observationNearestPlace: "본관",
    observationNotificationRevision: 3,
    observationRevision: 4,
    observationFeedbackRevision: 1,
    observationSummaryVisible: true,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(enrollmentDetailRows)), [{
      classId: "class-1", textbookId: null, textbookIds: [], classStartDate: "2026-08-10",
      classStartSessionKey: null, classStartLessonSessionId: null,
      classStartSession: "청강 회차",
      classStartSourceObservationId: "75000000-0000-4000-8000-000000000001",
      sortOrder: 0,
  }]);
  assert.equal(harness.queries.length, 1);
  assert.equal(harness.queries[0].columns,
    "id,task_id,subject,pipeline_status,workflow_status,workflow_revision,workflow_status_entered_at,director_profile_id,director_assignment_source,director_assignment_rule_key,waiting_kind,waiting_detail_kind,waiting_detail_class_id,waiting_detail_retake_decision,level_test_retake_decision,migration_review_required,stage_entered_at,phone_ready_at,phone_ready_source,updated_at,level_test_scheduled_at,level_test_place,visit_scheduled_at,visit_place,enrollment_detail_rows,director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name),observation_return_workflow_status,observation_attempt_count,observation_current_id,observation_current_status,observation_current_appointment_id,observation_nearest_scheduled_at,observation_nearest_place,observation_notification_revision,observation_revision,observation_feedback_revision");
  assert.deepEqual(harness.queries[0].filters, [["in", "task_id", ["73000000-0000-4000-8000-000000000001"]]]);
  assert.doesNotMatch(harness.queries[0].columns, /schedule_plan|textbook|student_ids|waitlist_ids/);
  assert.doesNotMatch(harness.queries[0].columns, /consultations|appointments|\*/);
});

test("an exact all-null observation summary is concealed while partial null remains fail-closed", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let partial = false;
  const harness = createClient({
    queryHandler: () => ({ data: [{
      id: "track-1", task_id: "73000000-0000-4000-8000-000000000001", subject: "영어",
      pipeline_status: "consultation_waiting",
      workflow_status: "observation_requested",
      observation_attempt_count: null,
      observation_current_id: partial ? "observation-without-count" : null,
      observation_current_status: null,
      observation_current_appointment_id: null,
      observation_nearest_scheduled_at: null,
      observation_nearest_place: null,
      observation_notification_revision: null,
      observation_revision: null,
      observation_feedback_revision: null,
    }], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const concealed = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1", { force: true });
  assert.equal(concealed.tracks[0].observationSummaryVisible, false);
  assert.deepEqual(
    Object.fromEntries(Object.keys(EMPTY_REGISTRATION_OBSERVATION_SUMMARY).map((key) => [key, concealed.tracks[0][key]])),
    EMPTY_REGISTRATION_OBSERVATION_SUMMARY,
  );

  partial = true;
  await assert.rejects(
    service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1", { force: true }),
    /registration_observation_summary_invalid/,
  );
});

test("generic summary reads fail closed before observation workflow states reach legacy UI", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler: () => ({ data: [{
      id: "track-1",
      task_id: "73000000-0000-4000-8000-000000000001",
      subject: "영어",
      pipeline_status: "visit_consultation_scheduled",
      workflow_status: "observation_feedback_pending",
      ...inertObservationSummaryRow,
    }], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    service.loadLegacyCompatibleTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1"),
    /registration_observation_ui_not_ready/,
  );
});

test("track summary loader falls back to the pre-intake projection when only phone readiness columns are missing", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const missingPhoneReadinessColumn = {
    code: "42703",
    message: "column ops_registration_subject_track_summaries.phone_ready_at does not exist",
  };
  let invalidations = 0;
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      if (query.columns.includes("phone_ready_at")) {
        return { data: null, error: missingPhoneReadinessColumn };
      }
      return { data: [{
        id: "track-1", task_id: "73000000-0000-4000-8000-000000000001", subject: "영어",
        pipeline_status: "inquiry", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        updated_at: "2026-07-12T02:00:00Z",
        visit_scheduled_at: null, visit_place: null,
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeObservationRuntime: async () => ({ available: false, runtimeVersion: 0 }),
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  const result = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1");

  assert.equal(result.mode, "ready");
  assert.equal(result.tracks.length, 1);
  assert.equal(result.tracks[0].id, "track-1");
  assert.equal(result.tracks[0].phoneReadyAt, null);
  assert.equal(result.tracks[0].phoneReadySource, null);
  assert.equal(invalidations, 0);
  assert.equal(harness.queries.length, 2);
  assert.match(harness.queries[0].columns, /phone_ready_at,phone_ready_source/);
  assert.doesNotMatch(harness.queries[1].columns, /phone_ready_at|phone_ready_source/);
  assert.deepEqual(harness.queries[1].filters, [["in", "task_id", ["73000000-0000-4000-8000-000000000001"]]]);
});

test("runtime-ready observation columns fail visibly instead of using an old projection", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const missingObservationColumn = {
    code: "42703",
    message: "column ops_registration_subject_track_summaries.observation_attempt_count does not exist",
  };
  let invalidations = 0;
  const harness = createClient({
    queryHandler: () => ({ data: null, error: missingObservationColumn }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1"),
    (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR"
      && error.cause === missingObservationColumn,
  );
  assert.equal(invalidations, 1);
  assert.equal(harness.queries.length, 1);
  assert.match(harness.queries[0].columns, /observation_attempt_count/);
});

test("runtime-ready summary rows cannot omit the observation scalar payload", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler: () => ({ data: [{
      id: "track-1",
      task_id: "73000000-0000-4000-8000-000000000001",
      subject: "영어",
      pipeline_status: "inquiry",
      workflow_status: "observation_requested",
    }], error: null }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1"),
    /registration_observation_summary_invalid/,
  );
  assert.equal(harness.queries.length, 1);
  assert.match(harness.queries[0].columns, /observation_attempt_count/);
});

test("track summary loader does not fall back for an unrelated missing summary column", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const unrelatedMissingColumn = {
    code: "42703",
    message: "column ops_registration_subject_track_summaries.visit_place does not exist",
  };
  let invalidations = 0;
  const harness = createClient({
    queryHandler: () => ({ data: null, error: unrelatedMissingColumn }),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1"),
    (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR" && error.cause === unrelatedMissingColumn,
  );
  assert.equal(invalidations, 1);
  assert.equal(harness.queries.length, 1);
});

test("track summary loader embeds director names without a profile lookup waterfall", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") {
        return { data: [{ id: "director-1", name: "강부희" }], error: null };
      }
      const embedsDirector = query.columns.includes(
        "director:profiles!ops_registration_subject_tracks_director_profile_id_fkey(id,name)",
      );
      return { data: ["track-1", "track-2"].map((id) => ({
        id, task_id: "73000000-0000-4000-8000-000000000001", subject: id === "track-1" ? "영어" : "수학",
        pipeline_status: "inquiry", director_profile_id: "director-1",
        director: embedsDirector ? { id: "director-1", name: "강부희" } : null,
        director_assignment_source: "default", director_assignment_rule_key: "rule",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        ...inertObservationSummaryRow,
      })), error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1");

  assert.deepEqual(result.tracks.map((track) => track.directorName), ["강부희", "강부희"]);
  assert.equal(harness.queries.length, 1);
  assert.match(
    harness.queries[0].columns,
    /director:profiles!ops_registration_subject_tracks_director_profile_id_fkey\(id,name\)/,
  );
});

test("workspace track summary loader reads all visible tracks without waiting for parent task ids", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "73000000-0000-4000-8000-000000000001", subject: "영어",
        pipeline_status: "inquiry", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        updated_at: "2026-07-12T01:00:00Z",
        visit_scheduled_at: null, visit_place: null,
        ...inertObservationSummaryRow,
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.equal(typeof service.loadWorkspaceTrackSummaries, "function");
  const result = await service.loadWorkspaceTrackSummaries("viewer-1", { force: true });

  assert.deepEqual(result.tracks.map((track) => track.id), ["track-1"]);
  assert.equal(harness.queries.length, 1);
  assert.deepEqual(harness.queries[0].filters, []);
});

test("workspace track summary read overlaps a delayed runtime readiness check", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const runtimeGate = deferred();
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "ops_registration_subject_track_summaries");
      return { data: [{
        id: "track-1", task_id: "73000000-0000-4000-8000-000000000001", subject: "영어",
        pipeline_status: "inquiry", director_profile_id: null,
        director_assignment_source: "", director_assignment_rule_key: "",
        waiting_kind: null, level_test_retake_decision: null,
        migration_review_required: false, stage_entered_at: "2026-07-12T01:00:00Z",
        phone_ready_at: null, phone_ready_source: null,
        updated_at: "2026-07-12T01:00:00Z",
        visit_scheduled_at: null, visit_place: null,
        ...inertObservationSummaryRow,
      }], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: () => runtimeGate.promise,
  }));

  const pending = service.loadWorkspaceTrackSummaries("viewer-1", { force: true });
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.queries.length, 1);
  assert.deepEqual(harness.queries[0].filters, []);

  runtimeGate.resolve({ mode: "ready", version: 1 });
  const result = await pending;
  assert.deepEqual(result.tracks.map((track) => track.id), ["track-1"]);
});

test("legacy and maintenance are explicit and legacy summaries remain per subject", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const state of [
    { mode: "legacy", version: 0 },
    { mode: "maintenance", version: 0 },
  ]) {
    const harness = createClient();
    const service = createRegistrationTrackService(harness.client, readyOptions({
      probeRuntime: async () => state,
    }));
    const result = await service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1");
    assert.deepEqual({ mode: result.mode, tracks: [...result.tracks] }, { mode: state.mode, tracks: [] });
    assert.equal(harness.queries.length, 0);
  }

  const service = createRegistrationTrackService(createClient().client, readyOptions());
  const legacy = service.createLegacyTrackSummaries([{
    taskId: "73000000-0000-4000-8000-000000000001", subjects: ["영어", "수학"], status: "waiting",
    directorName: "강부희", stageEnteredAt: "2026-07-12T01:00:00Z",
  }]);
  assert.deepEqual(legacy.map((track) => [
    track.subject, track.legacy, track.phoneReadyAt, track.phoneReadySource,
  ]), [
    ["영어", true, null, null], ["수학", true, null, null],
  ]);
});

test("a missing child relation after ready invalidates and throws integrity instead of legacy fallback", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const missing = { code: "PGRST205", message: "relation disappeared" };
  let invalidations = 0;
  const harness = createClient({ queryHandler: () => ({ data: null, error: missing }) });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) {
      invalidations += 1;
      const integrity = new Error("integrity");
      integrity.code = "REGISTRATION_RUNTIME_INTEGRITY_ERROR";
      integrity.cause = error;
      throw integrity;
    },
  }));

  await assert.rejects(
    service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], "viewer-1"),
    (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR" && error.cause === missing,
  );
  assert.equal(invalidations, 1);
});

test("case detail reads overlap a delayed runtime readiness check", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const runtimeGate = deferred();
  const harness = createClient({
    queryHandler(query) {
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: () => runtimeGate.promise,
  }));

  const pending = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { force: true });
  await Promise.resolve();

  try {
    assert.equal(harness.queries.length, 7);
    assert.deepEqual(harness.queries.map((query) => query.table).sort(), [
      "ops_registration_admission_batches",
      "ops_registration_admission_batches",
      "ops_registration_appointments",
      "ops_registration_appointments",
      "ops_registration_messages",
      "ops_registration_subject_tracks",
      "ops_tasks",
    ]);
    assert.deepEqual(harness.rpcCalls.map(([name]) => name).sort(), [
      "get_registration_customer_reminder_summaries_v1", "read_registration_contact_events_v1",
    ]);
    assertCaseDetailUsesServerPrivacyFilters(harness);
  } finally {
    runtimeGate.resolve({ mode: "ready", version: 1 });
  }

  const detail = await pending;
  assert.equal(detail.task.id, "73000000-0000-4000-8000-000000000001");
  assert.deepEqual(detail.tracks.map((track) => track.id), ["track-1"]);
});

test("reminder summary is merged into the matching registration appointment", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRows(query.table);
    },
    rpcHandler(name, args) {
      assert.equal(name, "get_registration_customer_reminder_summaries_v1");
      assert.deepEqual({ ...args }, { p_task_id: "73000000-0000-4000-8000-000000000001" });
      return {
        data: [{
          appointment_id: "appointment-1",
          state: "scheduled",
          scheduled_for: "2026-07-13T01:00:00.000Z",
          sent_at: null,
          updated_at: "2026-07-12T02:00:00.000Z",
        }],
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { force: true });

  assert.equal(harness.rpcCalls.filter(([name]) => name === "get_registration_customer_reminder_summaries_v1").length, 1);
  assert.deepEqual({ ...detail.appointments[0].customerReminder }, {
    state: "scheduled",
    scheduledFor: "2026-07-13T01:00:00.000Z",
    sentAt: null,
    updatedAt: "2026-07-12T02:00:00.000Z",
  });
});

test("case detail excludes observation rows at the server query boundary", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRowsWithObservationSecrets(query);
    },
    eventHandler: sharedEventRpcFixture,
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("case detail preserves contact-free structured event business notes through the actual RPC reader", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const canonical = detailRows("ops_task_events").data.find((row) => row.id === EVENT_FIXTURE_IDS.canonical);
  const payload = JSON.parse(canonical.after_value);
  const metadata = { consultationId: "consultation-1", note: "synthetic 01000000000 remains a business note", changes: [{ summary: "합성 업무 기록" }] };
  const harness = createClient({ queryHandler: (query) => detailRows(query.table), eventHandler: () => eventRpcResult(
    [{ ...canonical, after_value: toPostgresJsonbText({ ...payload, metadata }) }],
  ) });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const detail = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.deepEqual(JSON.parse(JSON.stringify(detail.events[0].metadata)), metadata);
  assert.equal(detail.events[0].actorId, EVENT_ACTOR);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("case detail rejects unsanitized or invalid event RPC rows before caching or a raw-table fallback", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const canonical = detailRows("ops_task_events").data.find((row) => row.id === EVENT_FIXTURE_IDS.canonical);
  const invalidPages = [
    [{ ...canonical, after_value: JSON.stringify({ version: 1, metadata: [{ parentPhone: "SYNTHETIC_RAW_CONTACT_CANARY" }] }) }],
    [{ ...canonical, task_id: CONTACT_TRACK }],
    [{ ...canonical, id: "event-not-a-uuid" }],
    [{ ...canonical, unexpected: "extra" }],
    [canonical, { ...canonical }],
    Array.from({ length: 31 }, (_, index) => ({ ...canonical, id: `75000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}` })),
    detailRows("ops_task_events").data.toReversed(),
  ];
  for (const data of invalidPages) {
    const harness = createClient({ queryHandler: (query) => detailRows(query.table), eventHandler: () => eventRpcResult(data) });
    const service = createRegistrationTrackService(harness.client, readyOptions());
    await assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1"), /registration_contact_event_read_response_invalid/);
    assert.equal(service.getContactReceipt(CONTACT_TASK), null);
    assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false);
    assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  }
});

test("case detail propagates an event RPC permission denial without retrying or reading the raw table", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const denied = Object.assign(new Error("synthetic event read permission denied"), { code: "42501" });
  const harness = createClient({ queryHandler: (query) => detailRows(query.table), eventHandler: () => ({ data: null, error: denied }) });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  await assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1"), (error) => error === denied);
  assert.equal(service.getContactReceipt(CONTACT_TASK), null);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false);
  assert.equal(harness.rpcRequests.find((request) => request.name === "read_registration_contact_events_v1").retryEnabled, false);
});

test("one bounded event RPC preserves a migration snapshot older than the latest thirty events", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const events = latestThirtyEventFixtures();
  const legacyImport = legacyImportEventFixture();
  assert.equal(events.length, 30);
  assert.ok(events.every((event) => Date.parse(event.created_at) > Date.parse(legacyImport.created_at)));
  const response = eventRpcResult(events, legacyImport);
  const originalResponse = structuredClone(response);
  const harness = createClient({ queryHandler: migrationReviewQueryFixture, eventHandler: () => response });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const detail = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.equal(detail.events.length, 31);
  assert.equal(new Set(Array.from(detail.events, (event) => event.id)).size, 31);
  assert.equal(detail.events.filter((event) => event.id === legacyImport.id).length, 1);
  assert.equal(detail.migrationLegacy.snapshotMissing, false);
  assert.equal(detail.migrationLegacy.studentId, BIND_STUDENT);
  assert.equal(detail.migrationLegacy.classId, "76000000-0000-4000-8000-000000000091");
  assert.equal(detail.migrationLegacy.textbookId, "76000000-0000-4000-8000-000000000092");
  assert.equal(detail.migrationLegacy.levelTestAt, "2026-07-01T01:00:00Z");
  assert.equal(detail.migrationLegacy.classStartSession, "1회차");
  assert.equal(detail.migrationLegacy.groups.placement, true);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  assertCaseDetailUsesServerPrivacyFilters(harness);
  assert.deepEqual(response, originalResponse, "the reader must not rewrite the server response");
});

test("a legacy snapshot already in the latest event page is deduplicated without another RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const legacyImport = legacyImportEventFixture();
  const events = [...latestThirtyEventFixtures().slice(0, 29), legacyImport];
  const harness = createClient({ queryHandler: migrationReviewQueryFixture,
    eventHandler: () => eventRpcResult(events, { ...legacyImport }) });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const detail = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.equal(detail.events.length, 30);
  assert.equal(detail.events.filter((event) => event.id === legacyImport.id).length, 1);
  assert.equal(detail.migrationLegacy.snapshotMissing, false);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("newer malformed and version-two timeline imports do not mask the older valid migration anchor", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const legacyImport = legacyImportEventFixture();
  const events = [...latestThirtyEventFixtures().slice(0, 28),
    legacyImportEventFixture({ id: "76000000-0000-4000-8000-000000000071",
      created_at: "2026-07-10T02:00:00Z", after_value: JSON.stringify({ version: 2 }) }),
    legacyImportEventFixture({ id: "76000000-0000-4000-8000-000000000072",
      created_at: "2026-07-09T02:00:00Z", after_value: "{malformed legacy" })];
  const harness = createClient({ queryHandler: migrationReviewQueryFixture,
    eventHandler: () => eventRpcResult(events, legacyImport) });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const detail = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
  assert.equal(detail.events.length, 31);
  assert.deepEqual(Array.from(detail.events, (event) => event.id), [...events.map((event) => event.id), legacyImport.id]);
  assert.equal(detail.migrationLegacy.snapshotMissing, false);
  assert.equal(detail.migrationLegacy.studentId, BIND_STUDENT);
  assert.equal(detail.migrationLegacy.levelTestAt, "2026-07-01T01:00:00Z");
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("missing or noncanonical timeline imports keep migration provenance unavailable", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const timelineImport of [null, legacyImportEventFixture({ after_value: "{malformed legacy" }),
    legacyImportEventFixture({ after_value: JSON.stringify({ version: 2, timestamps: { classStartDate: "2026-07-20" } }) })]) {
    const harness = createClient({ queryHandler: (query) => {
      const result = migrationReviewQueryFixture(query);
      return query.table === "ops_tasks" ? { ...result, data: { ...result.data, student_id: BIND_STUDENT,
        class_id: CONTACT_TRACK, textbook_id: CONTACT_KEY } } : result;
    }, eventHandler: () => eventRpcResult(timelineImport
      ? [...latestThirtyEventFixtures().slice(0, 29), timelineImport] : latestThirtyEventFixtures()) });
    const service = createRegistrationTrackService(harness.client, readyOptions());
    const detail = await service.loadCaseDetail(CONTACT_TASK, "viewer-1");
    assert.equal(detail.migrationLegacy.snapshotMissing, true);
    assert.equal(detail.migrationLegacy.studentId, "");
    assert.equal(detail.migrationLegacy.classId, "");
    assert.equal(detail.migrationLegacy.textbookId, "");
    assert.equal(detail.migrationLegacy.currentStudentId, BIND_STUDENT);
    assert.equal(detail.migrationLegacy.currentClassId, CONTACT_TRACK);
    assert.equal(detail.migrationLegacy.currentTextbookId, CONTACT_KEY);
    assert.equal(detail.migrationLegacy.groups.placement, false);
    assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
    assertCaseDetailUsesServerPrivacyFilters(harness);
  }
});

test("malformed event envelopes and unsafe legacy supplements are rejected before caching", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const legacy = legacyImportEventFixture();
  const invalidEnvelopes = [[], { events: [] }, { legacyImport: null }, { events: [], legacyImport: null, extra: null },
    { events: [], legacyImport: [] }, { events: [], legacyImport: { ...legacy, task_id: CONTACT_TRACK } },
    { events: [], legacyImport: { ...legacy, event_type: "future_event" } },
    { events: [], legacyImport: { ...legacy, after_value: "{malformed legacy" } },
    { events: [], legacyImport: { ...legacy, after_value: JSON.stringify({ version: 2 }) } },
    { events: [], legacyImport: { ...legacy, after_value: JSON.stringify({ version: 1, metadata: { parentPhone: "SYNTHETIC_RAW_CONTACT_CANARY" } }) } },
    { events: [legacy], legacyImport: { ...legacy, before_value: "different immutable snapshot" } }];
  for (const data of invalidEnvelopes) {
    const harness = createClient({ queryHandler: migrationReviewQueryFixture, eventHandler: () => ({ data, error: null }) });
    const service = createRegistrationTrackService(harness.client, readyOptions());
    await assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1"), /registration_contact_event_read_response_invalid/);
    assert.equal(service.getContactReceipt(CONTACT_TASK), null);
    assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
    assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false);
    assert.equal(harness.rpcRequests.find((request) => request.name === "read_registration_contact_events_v1").retryEnabled, false);
  }
});

test("an unavailable event RPC invalidates ready runtime without a raw event read or partial cache", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const code of ["PGRST202", "42883"]) {
    const unavailable = Object.assign(new Error("synthetic read_registration_contact_events_v1 unavailable"), { code });
    let invalidations = 0;
    const harness = createClient({ queryHandler: migrationReviewQueryFixture,
      eventHandler: () => ({ data: null, error: unavailable }) });
    const service = createRegistrationTrackService(harness.client, readyOptions({
      invalidateRuntimeAfterReadyFailure(error) {
        invalidations++;
        throw Object.assign(new Error("runtime integrity failure"), { code: "REGISTRATION_RUNTIME_INTEGRITY_ERROR", cause: error });
      },
    }));
    await assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1"),
      (error) => error.code === "REGISTRATION_RUNTIME_INTEGRITY_ERROR" && error.cause === unavailable);
    assert.equal(invalidations, 1);
    assert.equal(service.getContactReceipt(CONTACT_TASK), null);
    assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
    assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false);
    const request = harness.rpcRequests.find((entry) => entry.name === "read_registration_contact_events_v1");
    assert.ok(request.signal instanceof AbortSignal);
    assert.equal(request.signal.aborted, true);
    assert.equal(request.retryEnabled, false);
  }
});

test("case detail bounds the active subject-track read and disables automatic retries", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  const tracks = harness.queries.find(
    (query) => query.table === "ops_registration_subject_tracks",
  );
  assert.ok(tracks);
  assert.deepEqual(tracks.filters, [
    ["eq", "task_id", "73000000-0000-4000-8000-000000000001"],
    ["is", "archived_at", null],
    ["in", "active_level_tests.status", ["scheduled", "in_progress"]],
    ["in", "level_test_history.status", ["completed", "absent", "canceled"]],
    ["in", "active_consultations.status", ["waiting", "scheduled"]],
    ["in", "consultation_history.status", ["completed", "canceled"]],
  ]);
  assert.equal(tracks.columns.includes("*"), false);
  assert.match(
    tracks.columns,
    /active_level_tests:ops_registration_level_tests\(id,track_id,appointment_id,attempt_number,status,started_at,completed_at,material_link\)/,
  );
  assert.match(
    tracks.columns,
    /level_test_history:ops_registration_level_tests\(id,track_id,appointment_id,attempt_number,status,started_at,completed_at,material_link\)/,
  );
  assert.match(
    tracks.columns,
    /active_consultations:ops_registration_consultations\(id,track_id,appointment_id,mode,status,director_profile_id,ready_at,ready_source,completed_at,outcome,note,created_at,updated_at\)/,
  );
  assert.match(
    tracks.columns,
    /consultation_history:ops_registration_consultations\(id,track_id,appointment_id,mode,status,director_profile_id,ready_at,ready_source,completed_at,outcome,note,created_at,updated_at\)/,
  );
  assert.doesNotMatch(tracks.columns, /enrollments:ops_registration_enrollments/);
  assert.deepEqual(JSON.parse(JSON.stringify(tracks.order.filter(
    ([, options]) => !options?.referencedTable,
  ))), [
    ["subject", { ascending: true }],
    ["id", { ascending: true }],
  ]);
  assert.equal(tracks.limit, 30);
  assert.ok(tracks.signal instanceof AbortSignal);
  assert.equal(tracks.retryEnabled, false);
});

test("case detail keeps a scheduled appointment outside the terminal history window", async () => {
  // Production break caught: a scheduled appointment must not disappear just
  // because 30 newer completed/canceled rows occupy the bounded history page.
  const { createRegistrationTrackService } = await loadFactory();
  const scheduled = {
    id: "appointment-current", task_id: "73000000-0000-4000-8000-000000000001", kind: "level_test",
    scheduled_at: "2026-08-10T01:00:00Z", place: "본관", status: "scheduled",
    notification_revision: 7, created_at: "2026-07-01T01:00:00Z", updated_at: "2026-07-01T01:00:00Z",
  };
  const terminal = {
    ...scheduled,
    id: "appointment-terminal",
    status: "completed",
    scheduled_at: "2026-07-10T01:00:00Z",
    updated_at: "2026-08-01T01:00:00Z",
  };
  const hasFilter = (query, method, column, value) => query.filters.some((filter) => (
    filter[0] === method && filter[1] === column && JSON.stringify(filter[2]) === JSON.stringify(value)
  ));
  const harness = createClient({
    queryHandler(query) {
      if (query.table !== "ops_registration_appointments") return detailRows(query.table);
      if (hasFilter(query, "in", "status", ["scheduled"])) {
        return { data: [scheduled], count: 1, error: null };
      }
      if (hasFilter(query, "in", "status", ["completed", "canceled"])) {
        return { data: [terminal, { ...scheduled, status: "canceled" }], error: null };
      }
      return { data: [terminal], error: null };
    },
    rpcHandler(name) {
      assert.equal(name, "get_registration_customer_reminder_summaries_v1");
      return {
        data: [scheduled, terminal].map((appointment) => ({
          appointment_id: appointment.id,
          state: appointment.status === "scheduled" ? "scheduled" : "canceled",
          scheduled_for: appointment.status === "scheduled" ? "2026-08-09T01:00:00.000Z" : null,
          sent_at: null,
          updated_at: appointment.updated_at,
        })),
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.deepEqual(Array.from(detail.appointments, (appointment) => appointment.id), [
    scheduled.id,
    terminal.id,
  ]);
  const appointmentQueries = harness.queries.filter(
    (query) => query.table === "ops_registration_appointments",
  );
  assert.equal(appointmentQueries.length, 2);
  const currentQuery = appointmentQueries.find((query) => (
    hasFilter(query, "in", "status", ["scheduled"])
  ));
  const historyQuery = appointmentQueries.find((query) => (
    hasFilter(query, "in", "status", ["completed", "canceled"])
  ));
  assert.deepEqual(JSON.parse(JSON.stringify(currentQuery?.options)), { count: "exact" });
  assert.deepEqual(JSON.parse(JSON.stringify(currentQuery?.order)), [
    ["scheduled_at", { ascending: true }],
    ["id", { ascending: true }],
  ]);
  assert.equal(currentQuery?.limit, 30);
  assert.equal(currentQuery?.retryEnabled, false);
  assert.ok(currentQuery?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(JSON.stringify(historyQuery?.order)), [
    ["updated_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assert.equal(historyQuery?.limit, 30);
  assert.equal(historyQuery?.retryEnabled, false);
  assert.ok(historyQuery?.signal instanceof AbortSignal);
});

test("case detail preserves factual editing and marks more than 30 scheduled appointments as overflow", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table !== "ops_registration_appointments") return detailRows(query.table);
      const current = query.filters.some((filter) => (
        filter[0] === "in" && filter[1] === "status" && JSON.stringify(filter[2]) === '["scheduled"]'
      ));
      if (!current) return { data: [], error: null };
      return {
        data: Array.from({ length: 30 }, (_, index) => ({
          id: `appointment-current-${index}`,
          task_id: "73000000-0000-4000-8000-000000000001",
          kind: "level_test",
          scheduled_at: "2026-08-10T01:00:00Z",
          place: "본관",
          status: "scheduled",
          notification_revision: 1,
          created_at: "2026-07-01T01:00:00Z",
          updated_at: "2026-07-01T01:00:00Z",
        })),
        count: 31,
        error: null,
      };
    },
    rpcHandler(name) {
      assert.equal(name, "get_registration_customer_reminder_summaries_v1");
      return {
        data: Array.from({ length: 30 }, (_, index) => ({
          appointment_id: `appointment-current-${index}`,
          state: "scheduled",
          scheduled_for: "2026-08-10T01:00:00Z",
          sent_at: null,
          updated_at: "2026-07-01T01:00:00Z",
        })),
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.equal(detail.appointments.length, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.collectionWindows.scheduledAppointments)), {
    loadedCount: 30,
    totalCount: 31,
    overflow: true,
  });
});

test("case detail keeps the one open admission batch outside terminal history", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const open = {
    id: "batch-open", task_id: "73000000-0000-4000-8000-000000000001", revision_number: 2, status: "draft",
    invoice_sent_at: null, payment_confirmed_at: null,
    created_at: "2026-07-01T01:00:00Z", updated_at: "2026-07-01T01:00:00Z",
  };
  const terminal = {
    ...open, id: "batch-terminal", revision_number: 40, status: "completed",
    invoice_sent_at: "2026-08-01T01:00:00Z", payment_confirmed_at: "2026-08-02T01:00:00Z",
    updated_at: "2026-08-03T01:00:00Z",
  };
  const hasStatuses = (query, statuses) => query.filters.some((filter) => (
    filter[0] === "in" && filter[1] === "status" && JSON.stringify(filter[2]) === JSON.stringify(statuses)
  ));
  const harness = createClient({
    queryHandler(query) {
      if (query.table !== "ops_registration_admission_batches") return detailRows(query.table);
      if (hasStatuses(query, ["draft", "invoiced", "paid"])) return { data: [open], error: null };
      if (hasStatuses(query, ["completed", "canceled"])) return { data: [terminal], error: null };
      return { data: [terminal], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.deepEqual(Array.from(detail.admissionBatches, (batch) => batch.id), [open.id, terminal.id]);
  const batchQueries = harness.queries.filter(
    (query) => query.table === "ops_registration_admission_batches",
  );
  assert.equal(batchQueries.length, 2);
  const openQuery = batchQueries.find((query) => hasStatuses(query, ["draft", "invoiced", "paid"]));
  const historyQuery = batchQueries.find((query) => hasStatuses(query, ["completed", "canceled"]));
  assert.deepEqual(JSON.parse(JSON.stringify(openQuery?.order)), [
    ["revision_number", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assert.equal(openQuery?.limit, 1);
  assert.equal(openQuery?.retryEnabled, false);
  assert.ok(openQuery?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(JSON.stringify(historyQuery?.order)), [
    ["revision_number", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assert.equal(historyQuery?.limit, 30);
  assert.equal(historyQuery?.retryEnabled, false);
  assert.ok(historyQuery?.signal instanceof AbortSignal);
});

test("case detail bounds active and historical embedded children independently", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const baseTrack = detailRows("ops_registration_subject_tracks").data[0];
  const activeLevelTest = {
    id: "test-active", track_id: "track-1", appointment_id: "appointment-1",
    attempt_number: 9, status: "in_progress", started_at: "2026-08-02T01:00:00Z",
    completed_at: null, material_link: null,
  };
  const historyLevelTest = {
    ...activeLevelTest, id: "test-history", attempt_number: 8, status: "completed",
    completed_at: "2026-08-01T02:00:00Z", material_link: "https://drive.test/history",
  };
  const activeConsultation = {
    id: "consultation-active", track_id: "track-1", appointment_id: "appointment-1",
    mode: "visit", status: "scheduled", director_profile_id: "director-1",
    ready_at: null, ready_source: null, completed_at: null, outcome: null, note: null,
    created_at: "2026-08-02T01:00:00Z", updated_at: "2026-08-02T01:00:00Z",
  };
  const historyConsultation = {
    ...activeConsultation, id: "consultation-history", appointment_id: null,
    mode: "phone", status: "completed", completed_at: "2026-08-01T01:00:00Z",
    outcome: "waiting", updated_at: "2026-08-01T01:00:00Z",
  };
  const harness = createClient({
    queryHandler(query) {
      if (query.table !== "ops_registration_subject_tracks") return detailRows(query.table);
      if (!query.columns.includes("active_level_tests:")) {
        return {
          data: [{
            ...baseTrack,
            level_tests: [historyLevelTest],
            consultations: [historyConsultation],
          }],
          error: null,
        };
      }
      return {
        data: [{
          ...baseTrack,
          level_tests: undefined,
          consultations: undefined,
          enrollments: undefined,
          active_level_tests: [activeLevelTest],
          level_test_history: [historyLevelTest],
          active_consultations: [activeConsultation],
          consultation_history: [historyConsultation],
        }],
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.deepEqual(Array.from(detail.levelTests, (row) => row.id), [activeLevelTest.id, historyLevelTest.id]);
  assert.deepEqual(Array.from(detail.consultations, (row) => row.id), [activeConsultation.id, historyConsultation.id]);
  const tracks = harness.queries.find((query) => query.table === "ops_registration_subject_tracks");
  assert.deepEqual(JSON.parse(JSON.stringify(
    tracks?.limits.filter(([, options]) => options?.referencedTable),
  )), [
    [1, { referencedTable: "active_level_tests" }],
    [30, { referencedTable: "level_test_history" }],
    [1, { referencedTable: "active_consultations" }],
    [30, { referencedTable: "consultation_history" }],
  ]);
  assert.deepEqual(JSON.parse(JSON.stringify(
    tracks?.order.filter(([, options]) => options?.referencedTable),
  )), [
    ["attempt_number", { ascending: false, referencedTable: "active_level_tests" }],
    ["id", { ascending: false, referencedTable: "active_level_tests" }],
    ["attempt_number", { ascending: false, referencedTable: "level_test_history" }],
    ["id", { ascending: false, referencedTable: "level_test_history" }],
    ["created_at", { ascending: false, referencedTable: "active_consultations" }],
    ["id", { ascending: false, referencedTable: "active_consultations" }],
    ["updated_at", { ascending: false, referencedTable: "consultation_history" }],
    ["id", { ascending: false, referencedTable: "consultation_history" }],
  ]);
});

test("case detail keeps a recently corrected consultation inside the 30-row history window", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const baseTrack = detailRows("ops_registration_subject_tracks").data[0];
  const ordinaryHistory = Array.from({ length: 30 }, (_, index) => ({
    id: `consultation-history-${String(index + 1).padStart(2, "0")}`,
    track_id: "track-1",
    appointment_id: null,
    mode: "phone",
    status: "completed",
    director_profile_id: "director-1",
    ready_at: null,
    ready_source: null,
    completed_at: `2026-08-${String(index + 1).padStart(2, "0")}T01:00:00Z`,
    outcome: "waiting",
    note: null,
    created_at: `2026-08-${String(index + 1).padStart(2, "0")}T01:00:00Z`,
    updated_at: `2026-08-${String(index + 1).padStart(2, "0")}T01:00:00Z`,
  }));
  const recentlyCorrected = {
    ...ordinaryHistory[0],
    id: "consultation-history-corrected",
    created_at: "2026-07-01T01:00:00Z",
    updated_at: "2026-09-01T01:00:00Z",
    note: "최근 정정",
  };
  const allHistory = [...ordinaryHistory, recentlyCorrected];
  const harness = createClient({
    queryHandler(query) {
      if (query.table !== "ops_registration_subject_tracks") return detailRows(query.table);
      const historyOrder = query.order.filter(([, options]) => (
        options?.referencedTable === "consultation_history"
      ));
      const primaryColumn = historyOrder[0]?.[0];
      const history = [...allHistory]
        .sort((left, right) => {
          const primary = String(right[primaryColumn] || "").localeCompare(String(left[primaryColumn] || ""));
          return primary || right.id.localeCompare(left.id);
        })
        .slice(0, 30);
      return {
        data: [{
          ...baseTrack,
          level_tests: undefined,
          consultations: undefined,
          enrollments: undefined,
          active_level_tests: [],
          level_test_history: [],
          active_consultations: [],
          consultation_history: history,
        }],
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.equal(detail.consultations.length, 30);
  assert.equal(detail.consultations.some((row) => row.id === recentlyCorrected.id), true);
  assert.equal(detail.consultations.some((row) => row.id === ordinaryHistory[0].id), false);
});

test("case detail keeps current enrollments separate from bounded terminal history", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const baseTrack = detailRows("ops_registration_subject_tracks").data[0];
  const current = {
    id: "enrollment-current", track_id: "track-1", student_id: null,
    admission_batch_id: null, class_id: "class-current", textbook_id: null,
    class_start_date: null, class_start_session_key: null,
    class_start_lesson_session_id: null, class_start_session: null,
    class_start_source_observation_id: null, status: "planned", makeedu_registered: false,
    roster_active: false, roster_released_at: null, roster_release_reason: null,
    roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
    created_at: "2026-07-01T01:00:00Z", updated_at: "2026-07-01T01:00:00Z",
  };
  const terminal = {
    ...current, id: "enrollment-terminal", class_id: "class-terminal", status: "canceled",
    created_at: "2026-08-01T01:00:00Z", updated_at: "2026-08-01T01:00:00Z",
  };
  const currentFilter = "status.in.(planned,waitlisted),and(status.eq.enrolled,roster_active.eq.true)";
  const terminalFilter = "status.eq.canceled,and(status.eq.enrolled,roster_active.eq.false)";
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_subject_tracks") {
        return { data: [{ ...baseTrack, enrollments: [terminal] }], error: null };
      }
      if (query.table !== "ops_registration_enrollments") return detailRows(query.table);
      if (query.filters.some((filter) => filter[0] === "or" && filter[1] === currentFilter)) {
        return { data: [current], count: 1, error: null };
      }
      if (query.filters.some((filter) => filter[0] === "or" && filter[1] === terminalFilter)) {
        return { data: [terminal], error: null };
      }
      throw new Error("unbounded enrollment query");
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.deepEqual(Array.from(detail.enrollments, (row) => row.id), [current.id, terminal.id]);
  const enrollmentQueries = harness.queries.filter(
    (query) => query.table === "ops_registration_enrollments",
  );
  assert.equal(enrollmentQueries.length, 2);
  const currentQuery = enrollmentQueries.find((query) => query.filters.some(
    (filter) => filter[0] === "or" && filter[1] === currentFilter,
  ));
  const historyQuery = enrollmentQueries.find((query) => query.filters.some(
    (filter) => filter[0] === "or" && filter[1] === terminalFilter,
  ));
  assert.deepEqual(JSON.parse(JSON.stringify(currentQuery?.options)), { count: "exact" });
  assert.deepEqual(JSON.parse(JSON.stringify(currentQuery?.order)), [
    ["created_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assert.equal(currentQuery?.limit, 30);
  assert.equal(currentQuery?.retryEnabled, false);
  assert.ok(currentQuery?.signal instanceof AbortSignal);
  assert.deepEqual(JSON.parse(JSON.stringify(historyQuery?.order)), [
    ["updated_at", { ascending: false }],
    ["id", { ascending: false }],
  ]);
  assert.equal(historyQuery?.limit, 30);
  assert.equal(historyQuery?.retryEnabled, false);
  assert.ok(historyQuery?.signal instanceof AbortSignal);
});

test("case detail preserves factual editing and marks more than 30 current enrollments as overflow", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const baseTrack = detailRows("ops_registration_subject_tracks").data[0];
  const currentFilter = "status.in.(planned,waitlisted),and(status.eq.enrolled,roster_active.eq.true)";
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_subject_tracks") {
        return { data: [{ ...baseTrack, enrollments: [] }], error: null };
      }
      if (query.table !== "ops_registration_enrollments") return detailRows(query.table);
      if (query.filters.some((filter) => filter[0] === "or" && filter[1] === currentFilter)) {
        return {
          data: Array.from({ length: 30 }, (_, index) => ({
            id: `enrollment-current-${index}`, track_id: "track-1", status: "planned",
            class_id: `class-${index}`, roster_active: false,
          })),
          count: 31,
          error: null,
        };
      }
      return { data: [], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.equal(detail.enrollments.length, 30);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.collectionWindows.currentEnrollments)), {
    loadedCount: 30,
    totalCount: 31,
    overflow: true,
  });
});

test("case detail keeps factual editing available when exact current counts are unavailable", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      const result = detailRows(query.table);
      if (query.table === "ops_registration_appointments") {
        return { ...result, count: null };
      }
      if (query.table === "ops_registration_enrollments") {
        return { ...result, count: null };
      }
      return result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assert.equal(detail.task.id, "73000000-0000-4000-8000-000000000001");
  assert.deepEqual(JSON.parse(JSON.stringify(detail.collectionWindows)), {
    scheduledAppointments: {
      loadedCount: 1,
      totalCount: null,
      overflow: null,
    },
    currentEnrollments: {
      loadedCount: 1,
      totalCount: null,
      overflow: null,
    },
  });
});

test("generic case detail preserves nested observation-like and version20 history without booking secrets", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRowsWithObservationSecrets(query);
    },
    eventHandler: sharedEventRpcFixture,
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");

  assertCaseDetailOmitsObservationSecrets(detail);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("observation-aware case detail preserves shared nested and malformed history behind manager detail", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      return detailRowsWithObservationSecrets(query);
    },
    eventHandler: sharedEventRpcFixture,
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", {
    observationAware: true,
  });

  assert.equal(
    detail.tracks[0].observationSummaryVisible,
    true,
    "a visible manager summary remains available without embedding booking-only detail",
  );
  assertCaseDetailOmitsObservationSecrets(detail);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("dedicated manager detail preserves the observation schedule and place hidden from shared detail", async () => {
  const ids = {
    track: "71000000-0000-4000-8000-000000000001",
    task: "71000000-0000-4000-8000-000000000002",
    observation: "71000000-0000-4000-8000-000000000003",
    appointment: "71000000-0000-4000-8000-000000000004",
    class: "71000000-0000-4000-8000-000000000005",
    lesson: "71000000-0000-4000-8000-000000000006",
    teacherCatalog: "71000000-0000-4000-8000-000000000007",
    teacherProfile: "71000000-0000-4000-8000-000000000008",
    classroom: "71000000-0000-4000-8000-000000000009",
    director: "71000000-0000-4000-8000-000000000010",
  };
  const attempt = {
    observationId: ids.observation,
    taskId: ids.task,
    trackId: ids.track,
    appointmentId: ids.appointment,
    appointmentStatus: "scheduled",
    classId: ids.class,
    subject: "영어",
    className: "고1 영어 청강반",
    scheduleState: "active",
    sessionDate: "2026-08-14",
    startsAt: caseDetailObservationSecrets.scheduledAt,
    endsAt: "2026-08-14T10:37:00+09:00",
    teacherCatalogId: ids.teacherCatalog,
    teacherProfileId: ids.teacherProfile,
    teacherName: "강부희",
    classroomCatalogId: ids.classroom,
    classroomName: caseDetailObservationSecrets.place,
    campus: "본관",
    textbooks: [{ textbookId: null, title: "수업 자료", planLabel: "1과", memo: "" }],
    progress: "진도: 1과",
    bookingFactHash: "manager-detail-booking-fact",
    status: "scheduled",
    attendance: null,
    suitabilityResult: null,
    decisionKind: null,
    revision: 1,
    feedbackRevision: 0,
    appointmentNotificationRevision: 1,
    createdAt: "2026-08-10T02:00:00.000Z",
    updatedAt: "2026-08-10T02:00:00.000Z",
    sessionAuthority: "normalized",
    classLessonSessionId: ids.lesson,
    legacySessionKey: null,
    sessionKey: "2026-08-14:lesson-private",
    sessionSourceRevision: 3,
    legacySessionSourceHash: null,
    sourceRevision: {
      authority: "normalized",
      sessionId: ids.lesson,
      revision: 3,
    },
  };
  const payload = {
    track: {
      trackId: ids.track,
      taskId: ids.task,
      subject: "영어",
      workflowStatus: "observation_requested",
      workflowRevision: 4,
      observationReturnWorkflowStatus: "consultation_completed",
      directorProfileId: ids.director,
    },
    currentObservation: attempt,
    latestEnrollmentDecisionObservationId: null,
    latestDecisionObservation: null,
    attempts: [attempt],
    classes: [{ id: ids.class, name: "고1 영어 청강반", subject: "영어" }],
  };
  const calls = [];
  const client = {
    rpc(name, args) {
      calls.push({ name, args });
      const response = Promise.resolve({ data: payload, error: null });
      const request = {
        abortSignal() { return request; },
        retry() { return request; },
        then(resolve, reject) { return response.then(resolve, reject); },
      };
      return request;
    },
  };

  const detail = await loadRegistrationObservationManagerDetail(client, {
    trackId: ids.track,
  });

  assert.deepEqual(calls, [{
    name: "get_registration_observation_manager_detail_v1",
    args: { p_track_id: ids.track, p_attempt_limit: 20 },
  }]);
  assert.equal(detail.currentObservation.startsAt, caseDetailObservationSecrets.scheduledAt);
  assert.equal(detail.currentObservation.classroomName, caseDetailObservationSecrets.place);
  assert.equal(detail.attempts[0].startsAt, caseDetailObservationSecrets.scheduledAt);
  assert.equal(detail.attempts[0].classroomName, caseDetailObservationSecrets.place);
});

test("observation first lesson loader uses only the bounded enrollment-decision scalar and one correlated detail read", async () => {
  const trackId = "72000000-0000-4000-8000-000000000001";
  const observationId = "72000000-0000-4000-8000-000000000002";
  const decoyObservationId = "72000000-0000-4000-8000-000000000099";
  const managerCalls = [];
  const feedbackCalls = [];
  const detail = Object.freeze({ observationId, trackId, classId: "class-a" });
  const harness = createClient();
  const { createRegistrationTrackService } = await loadFactory({
    async loadRegistrationObservationManagerDetail(client, input) {
      managerCalls.push({ client, input });
      return {
        track: { trackId },
        latestEnrollmentDecisionObservationId: observationId,
        latestDecisionObservation: { observationId: decoyObservationId, decisionKind: "enrollment" },
        attempts: [{ observationId: decoyObservationId, decisionKind: "enrollment" }],
      };
    },
    async loadRegistrationObservationFeedback(client, requestedObservationId, options) {
      feedbackCalls.push({ client, requestedObservationId, options });
      return detail;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({ requestTimeoutMs: 4321 }));

  const result = await service.loadRegistrationEnrollmentStartObservation({ trackId });

  assert.strictEqual(result, detail);
  assert.equal(managerCalls.length, 1);
  assert.strictEqual(managerCalls[0].client, harness.client);
  assert.deepEqual({ ...managerCalls[0].input }, { trackId, attemptLimit: 1 });
  assert.equal(feedbackCalls.length, 1);
  assert.strictEqual(feedbackCalls[0].client, harness.client);
  assert.equal(feedbackCalls[0].requestedObservationId, observationId);
  assert.deepEqual({ ...feedbackCalls[0].options }, { timeoutMs: 4321, force: true });
});

test("observation first lesson loader never scans attempts and fails closed on detail identity mismatch", async () => {
  const trackId = "73000000-0000-4000-8000-000000000001";
  const observationId = "73000000-0000-4000-8000-000000000002";
  const decoyObservationId = "73000000-0000-4000-8000-000000000003";
  let feedbackCalls = 0;
  const harness = createClient();

  const noScalarFactory = await loadFactory({
    async loadRegistrationObservationManagerDetail() {
      return {
        track: { trackId },
        latestEnrollmentDecisionObservationId: null,
        latestDecisionObservation: { observationId: decoyObservationId, decisionKind: "enrollment" },
        attempts: [{ observationId: decoyObservationId, decisionKind: "enrollment" }],
      };
    },
    async loadRegistrationObservationFeedback() {
      feedbackCalls += 1;
      return { observationId: decoyObservationId, trackId };
    },
  });
  const noScalarService = noScalarFactory.createRegistrationTrackService(harness.client, readyOptions());
  assert.equal(await noScalarService.loadRegistrationEnrollmentStartObservation({ trackId }), null);
  assert.equal(feedbackCalls, 0, "attempt rows cannot become the candidate identity");

  for (const mismatchedDetail of [
    { observationId: decoyObservationId, trackId },
    { observationId, trackId: "73000000-0000-4000-8000-000000000099" },
  ]) {
    const mismatchFactory = await loadFactory({
      async loadRegistrationObservationManagerDetail() {
        return {
          track: { trackId },
          latestEnrollmentDecisionObservationId: observationId,
          latestDecisionObservation: null,
          attempts: [],
        };
      },
      async loadRegistrationObservationFeedback() {
        feedbackCalls += 1;
        return mismatchedDetail;
      },
    });
    const mismatchService = mismatchFactory.createRegistrationTrackService(harness.client, readyOptions());
    assert.equal(await mismatchService.loadRegistrationEnrollmentStartObservation({ trackId }), null);
  }
  assert.equal(feedbackCalls, 2, "each non-null scalar performs exactly one dedicated detail read");
});

test("observation-aware detail is broad while default detail fails closed and cannot share its cache", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_subject_track_summaries") {
        const track = detailRows("ops_registration_subject_tracks").data[0];
        return { data: [{
          ...track,
          workflow_status: "observation_feedback_pending",
          workflow_revision: 5,
          ...inertObservationSummaryRow,
        }], error: null };
      }
      const result = detailRows(query.table);
      if (query.table === "ops_registration_subject_tracks") {
        return {
          ...result,
          data: result.data.map((row) => ({
            ...row,
            workflow_status: "observation_feedback_pending",
            workflow_revision: 5,
            observation_attempt_count: 0,
          })),
        };
      }
      return result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const broad = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", {
    observationAware: true,
  });
  assert.equal(broad.tracks[0].workflowStatus, "observation_feedback_pending");
  assert.equal(broad.tracks[0].workflowRevision, 5);
  assert.equal(broad.tracks[0].observationSummaryVisible, true);
  assert.equal(
    harness.queries.filter((query) => query.table === "ops_registration_subject_track_summaries").length,
    1,
    "the one persisted counter cannot stand in for the complete summary-view tuple",
  );

  await assert.rejects(
    service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1"),
    /registration_observation_ui_not_ready/,
  );
  assert.equal(
    harness.queries.filter((query) => query.table === "ops_registration_subject_tracks").length,
    2,
    "narrow and broad detail reads must have separate cache identities",
  );
});

test("observation-aware detail fails closed when its required summary row is missing", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_subject_track_summaries") {
        return { data: [], error: null };
      }
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(
    service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: true }),
    /registration_observation_summary_invalid/,
  );
  assert.equal(
    harness.queries.filter((query) => query.table === "ops_registration_subject_track_summaries").length,
    1,
  );
});

function schedulingDetailRows(table) {
  return table === "ops_registration_subject_track_summaries"
    ? { data: [{ ...detailRows("ops_registration_subject_tracks").data[0], ...inertObservationSummaryRow }], error: null }
    : detailRows(table);
}

function dependentDetailQueries(harness) {
  return harness.queries.filter(({ table }) => [
    "ops_registration_enrollments", "ops_registration_subject_track_summaries",
  ].includes(table));
}

async function assertReauthorizedCachedDetail(service, harness, expected) {
  const tableReads = harness.queries.length;
  const eventReads = harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length;
  const contactReads = harness.rpcCalls.filter(([name]) => name === "get_registration_case_contact_v1").length;
  const cached = await service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true });
  assert.deepEqual(cached, expected);
  assert.notStrictEqual(cached, expected, "cached business detail reauthorizes contact and returns a fresh object");
  assert.equal(harness.queries.length, tableReads);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, eventReads);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "get_registration_case_contact_v1").length, contactReads + 1);
}

test("detail starts track-dependent reads before unrelated collections finish, but never returns partial detail", async (t) => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const delayed of ["read_registration_contact_events_v1", "ops_registration_messages", "ops_registration_appointments", "ops_registration_admission_batches", "reminders"]) {
    await t.test(delayed, async () => {
      const gate = deferred();
      const harness = createClient({
        queryHandler: (query) => query.table === delayed
          ? gate.promise.then(() => schedulingDetailRows(query.table)) : schedulingDetailRows(query.table),
        ...(delayed === "read_registration_contact_events_v1" ? {
          eventHandler: () => gate.promise.then(() => eventRpcResult(detailRows("ops_task_events").data)),
        } : {}),
        ...(delayed === "reminders" ? { rpcHandler: (name, args) => {
          assert.equal(name, "get_registration_customer_reminder_summaries_v1");
          assert.deepEqual({ ...args }, { p_task_id: CONTACT_TASK });
          return gate.promise.then(() => ({ data: [{
          appointment_id: "appointment-1", state: "scheduled", scheduled_for: "2026-07-13T01:00:00.000Z",
          sent_at: null, updated_at: "2026-07-12T02:00:00.000Z",
          }], error: null }));
        } } : {}),
      });
      const service = createRegistrationTrackService(harness.client, readyOptions());
      const request = service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true });
      let settled = false;
      request.then(() => { settled = true; }, () => { settled = true; });
      try {
        await new Promise(setImmediate);
        assert.equal(dependentDetailQueries(harness).length, 3);
        assert.equal(settled, false);
        assert.strictEqual(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }), request);
      } finally {
        gate.resolve();
      }
      const detail = await request;
      assert.equal(detail.enrollments.length, 1);
      assert.equal(detail.tracks[0].observationSummaryVisible, true);
      assert.equal(detail.appointments.length, 1);
      assert.equal(harness.queries.length, 10);
      assert.equal(harness.rpcCalls.length, 3);
      assertCaseDetailUsesServerPrivacyFilters(harness);
    });
  }
});

test("detail keeps parent existence, active tracks and ready runtime as prerequisites for dependent reads", async (t) => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const prerequisite of ["ops_tasks", "ops_registration_subject_tracks", "runtime"]) {
    for (const failing of [false, true]) {
      await t.test(`${prerequisite}: ${failing ? "reject" : "ready"}`, async () => {
        const gate = deferred();
        const failure = Object.assign(new Error("read denied"), { code: "42501" });
        let observationProbes = 0;
        const harness = createClient({ queryHandler: (query) => query.table === prerequisite
          ? gate.promise.then(() => schedulingDetailRows(query.table)) : schedulingDetailRows(query.table) });
        const service = createRegistrationTrackService(harness.client, readyOptions({
          ...(prerequisite === "runtime" ? { probeRuntime: () => gate.promise.then(() => ({ mode: "ready", version: 1 })) } : {}),
          probeObservationRuntime: async () => { observationProbes += 1; return { available: true, runtimeVersion: 1 }; },
        }));
        const request = service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true });
        const outcome = request.then((detail) => ({ detail }), (error) => ({ error }));
        try {
          await new Promise(setImmediate);
          assert.equal(dependentDetailQueries(harness).length, 0);
          assert.equal(observationProbes, 0);
        } finally {
          if (failing) gate.reject(failure); else gate.resolve();
        }
        const result = await outcome;
        if (failing) {
          assert.strictEqual(result.error, failure);
          assert.equal(dependentDetailQueries(harness).length, 0);
          assert.equal(observationProbes, 0);
        } else {
          assert.equal(result.detail.task.id, CONTACT_TASK);
          assert.equal(dependentDetailQueries(harness).length, 3);
        }
      });
    }
  }
  await t.test("missing parent", async () => {
    const harness = createClient({ queryHandler: ({ table }) => table === "ops_tasks"
      ? { data: null, error: null } : schedulingDetailRows(table) });
    const service = createRegistrationTrackService(harness.client, readyOptions());
    await assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }), /등록 업무를 찾을 수 없습니다/);
    assert.equal(dependentDetailQueries(harness).length, 0);
  });
});

test("an already failed initial collection blocks dependent reads after delayed prerequisites resolve", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const parent = deferred();
  const failure = new Error("initial events failed");
  const harness = createClient({ queryHandler: ({ table }) => table === "ops_tasks" ? parent.promise : schedulingDetailRows(table),
    eventHandler: () => ({ data: null, error: failure }) });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  await assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }), (error) => error === failure);
  parent.resolve(schedulingDetailRows("ops_tasks"));
  await new Promise(setImmediate);
  assert.equal(dependentDetailQueries(harness).length, 0);
});

test("early dependent failures are observed while initial errors retain precedence and failures stay uncached", async (t) => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const initialFails of [false, true]) {
    await t.test(initialFails ? "initial error wins" : "dependent error surfaces", async () => {
      const events = deferred();
      const initialError = new Error("events failed later");
      const dependentError = new Error("summary failed first");
      let failing = true;
      const harness = createClient({ queryHandler: ({ table }) => {
        if (failing && table === "ops_registration_subject_track_summaries") return Promise.reject(dependentError);
        return schedulingDetailRows(table);
      }, eventHandler: () => failing ? events.promise : eventRpcResult(detailRows("ops_task_events").data) });
      const service = createRegistrationTrackService(harness.client, readyOptions());
      let settled = false;
      const outcome = service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true })
        .then((detail) => { settled = true; return { detail }; }, (error) => { settled = true; return { error }; });
      try {
        await new Promise(setImmediate);
        assert.equal(dependentDetailQueries(harness).length, 3);
        assert.equal(settled, false);
      } finally {
        if (initialFails) events.reject(initialError); else events.resolve(eventRpcResult(detailRows("ops_task_events").data));
      }
      assert.strictEqual((await outcome).error, initialFails ? initialError : dependentError);
      assert.ok(dependentDetailQueries(harness).filter(({ table }) => table === "ops_registration_enrollments")
        .every(({ signal }) => signal.aborted));
      failing = false;
      assert.equal((await service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true })).enrollments.length, 1);
      assert.equal(harness.queries.filter(({ table }) => table === "ops_tasks").length, 2);
    });
  }
});

test("initial schema failure still invalidates and observes late dependent rejections", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const events = deferred();
  const children = deferred();
  const missing = { code: "42P01", message: "relation does not exist" };
  let invalidations = 0;
  const harness = createClient({ queryHandler: ({ table }) => ["ops_registration_enrollments", "ops_registration_subject_track_summaries"].includes(table)
      ? children.promise : schedulingDetailRows(table), eventHandler: () => events.promise });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidateRuntimeAfterReadyFailure(error) { invalidations += 1; throw Object.assign(new Error("integrity"), { cause: error }); },
  }));
  const rejection = assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }), (error) => error.cause === missing);
  await new Promise(setImmediate);
  assert.equal(dependentDetailQueries(harness).length, 3);
  events.resolve({ data: null, error: missing });
  await rejection;
  children.reject(new Error("late child rejection"));
  await new Promise(setImmediate);
  assert.equal(invalidations, 1);
});

test("detail timeout prevents late prerequisites from starting dependent work or replacing a fresh cache", async (t) => {
  for (const delayed of ["ops_tasks", "ops_registration_subject_tracks", "runtime"]) {
    await t.test(delayed, async () => {
      const timers = [];
      const { createRegistrationTrackService } = await loadFactory({
        setTimeout(callback) { timers.push(callback); return callback; }, clearTimeout() {},
      });
      const gate = deferred();
      let stale = true;
      const harness = createClient({ queryHandler: ({ table }) => {
        const result = schedulingDetailRows(table);
        const response = table === "ops_tasks" ? { ...result, data: { ...result.data, title: stale ? "old" : "fresh" } } : result;
        return stale && table === delayed ? gate.promise.then(() => response) : response;
      } });
      const service = createRegistrationTrackService(harness.client, readyOptions({
        probeRuntime: () => stale && delayed === "runtime" ? gate.promise.then(() => ({ mode: "ready", version: 1 }))
          : Promise.resolve({ mode: "ready", version: 1 }),
      }));
      const rejection = assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }),
        (error) => error.code === "REGISTRATION_REQUEST_TIMEOUT");
      await new Promise(setImmediate);
      assert.equal(dependentDetailQueries(harness).length, 0);
      timers[0]();
      await rejection;
      stale = false;
      const fresh = await service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true, force: true });
      assert.equal(fresh.task.title, "fresh");
      assert.equal(dependentDetailQueries(harness).length, 3);
      gate.resolve();
      await new Promise(setImmediate);
      assert.equal(dependentDetailQueries(harness).length, 3, "timed-out prerequisite completion must not start new reads");
      await assertReauthorizedCachedDetail(service, harness, fresh);
    });
  }
});

test("overlapped child work stays aborted and cannot cache detail after its deadline", async () => {
  const timers = [];
  const { createRegistrationTrackService } = await loadFactory({
    setTimeout(callback) { timers.push(callback); return callback; }, clearTimeout() {},
  });
  const events = deferred();
  const children = deferred();
  let stale = true;
  const harness = createClient({ queryHandler: ({ table }) => {
    if (stale && ["ops_registration_enrollments", "ops_registration_subject_track_summaries"].includes(table)) {
      return children.promise.then(() => schedulingDetailRows(table));
    }
    const result = schedulingDetailRows(table);
    return table === "ops_tasks" ? { ...result, data: { ...result.data, title: stale ? "old" : "fresh" } } : result;
  }, eventHandler: () => stale ? events.promise.then(() => eventRpcResult(detailRows("ops_task_events").data))
    : eventRpcResult(detailRows("ops_task_events").data) });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const rejection = assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }),
    (error) => error.code === "REGISTRATION_REQUEST_TIMEOUT");
  await new Promise(setImmediate);
  assert.equal(dependentDetailQueries(harness).length, 3);
  timers[0]();
  await rejection;
  assert.ok(dependentDetailQueries(harness).filter(({ table }) => table === "ops_registration_enrollments")
    .every(({ signal }) => signal.aborted));
  stale = false;
  const fresh = await service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true, force: true });
  assert.equal(fresh.task.title, "fresh");
  events.resolve();
  children.resolve();
  await new Promise(setImmediate);
  await assertReauthorizedCachedDetail(service, harness, fresh);
  assert.equal(harness.queries.filter(({ table }) => table === "ops_tasks").length, 2);
});

test("a completed event read cannot trigger contact access after a timed-out child join", async () => {
  const timers = [];
  const { createRegistrationTrackService } = await loadFactory({
    setTimeout(callback) { timers.push(callback); return callback; }, clearTimeout() {},
  });
  const children = deferred();
  let stale = true;
  const harness = createClient({ queryHandler: ({ table }) => {
    const result = schedulingDetailRows(table);
    const response = table === "ops_tasks" ? { ...result, data: { ...result.data, title: stale ? "old" : "fresh" } } : result;
    return stale && ["ops_registration_enrollments", "ops_registration_subject_track_summaries"].includes(table)
      ? children.promise.then(() => response) : response;
  } });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const rejection = assert.rejects(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }),
    (error) => error.code === "REGISTRATION_REQUEST_TIMEOUT");
  await new Promise(setImmediate);
  assert.equal(dependentDetailQueries(harness).length, 3);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "get_registration_case_contact_v1").length, 0);
  timers[0]();
  await rejection;
  assert.ok(dependentDetailQueries(harness).filter(({ table }) => table === "ops_registration_enrollments")
    .every(({ signal }) => signal.aborted));
  children.resolve();
  await new Promise(setImmediate);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "get_registration_case_contact_v1").length, 0,
    "late child completion must not authorize a contact read");
  assert.equal(service.getContactReceipt(CONTACT_TASK), null);
  stale = false;
  const fresh = await service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true });
  assert.equal(fresh.task.title, "fresh");
  assert.equal(harness.queries.filter(({ table }) => table === "ops_tasks").length, 2,
    "an unforced retry must reload business data instead of using timed-out detail");
  assert.equal(harness.queries.filter(({ table }) => table === "ops_registration_enrollments").length, 4);
  assert.equal(harness.queries.filter(({ table }) => table === "ops_registration_subject_track_summaries").length, 1,
    "the separate successful summary cache remains reusable without publishing timed-out detail");
  assert.equal(harness.rpcCalls.filter(([name]) => name === "get_registration_case_contact_v1").length, 1);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("overlapped detail preserves force and clear epochs after old children have already completed", async (t) => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const refresh of ["force", "clear"]) {
    await t.test(refresh, async () => {
      const events = [deferred(), deferred()];
      let eventReads = 0;
      const counts = new Map();
      const harness = createClient({ queryHandler: ({ table }) => {
        const index = counts.get(table) || 0;
        counts.set(table, index + 1);
        const result = schedulingDetailRows(table);
        if (table === "ops_tasks") return { ...result, data: { ...result.data, title: index === 0 ? "old" : "fresh" } };
        return result;
      }, eventHandler: () => events[eventReads++].promise.then(() => eventRpcResult(detailRows("ops_task_events").data)) });
      const service = createRegistrationTrackService(harness.client, readyOptions());
      const old = service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true });
      await new Promise(setImmediate);
      assert.equal(dependentDetailQueries(harness).length, 3);
      if (refresh === "clear") service.clearCaches();
      const fresh = service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true, force: refresh === "force" });
      await new Promise(setImmediate);
      assert.notStrictEqual(old, fresh);
      assert.strictEqual(service.loadCaseDetail(CONTACT_TASK, "viewer-1", { observationAware: true }), fresh);
      events[1].resolve();
      const currentDetail = await fresh;
      assert.equal(currentDetail.task.title, "fresh");
      events[0].resolve();
      assert.equal((await old).task.title, "old");
      const queriesAfterCompletion = harness.queries.length;
      await assertReauthorizedCachedDetail(service, harness, currentDetail);
      assert.equal(harness.queries.length, queriesAfterCompletion);
    });
  }
});

test("observation detail overlaps its required summary with enrollment reads and awaits both", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const enrollments = deferred();
  const summary = deferred();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_enrollments") {
        return enrollments.promise.then(() => detailRows(query.table));
      }
      if (query.table === "ops_registration_subject_track_summaries") {
        return summary.promise.then(() => ({ data: [{
          ...detailRows("ops_registration_subject_tracks").data[0],
          ...inertObservationSummaryRow,
        }], error: null }));
      }
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const request = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: true });
  let settled = false;
  request.then(() => { settled = true; }, () => { settled = true; });
  try {
    await new Promise(setImmediate);
    assert.equal(harness.queries.filter(({ table }) => table === "ops_registration_enrollments").length, 2);
    assert.equal(harness.queries.filter(({ table }) => table === "ops_registration_subject_track_summaries").length, 1,
      "required summary must start before enrollment reads finish");
    assert.equal(service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: true }), request,
      "same-viewer callers still share the complete in-flight detail");
    summary.resolve();
    await new Promise(setImmediate);
    assert.equal(settled, false, "summary alone must not report a complete detail");
  } finally {
    summary.resolve();
    enrollments.resolve();
  }
  const detail = await request;
  assert.equal(detail.tracks[0].observationSummaryVisible, true);
  assert.equal(detail.enrollments.length, 1);
  assert.equal(harness.queries.length, 10);
  assert.equal(harness.rpcCalls.length, 3);
  assertCaseDetailUsesServerPrivacyFilters(harness);
});

test("a parallel observation summary failure aborts detail reads without caching partial detail", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const enrollments = deferred();
  const summaryError = new Error("summary temporarily unavailable");
  let failing = true;
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_enrollments" && failing) {
        return enrollments.promise.then(() => detailRows(query.table));
      }
      if (query.table === "ops_registration_subject_track_summaries") {
        return failing ? { data: null, error: summaryError } : { data: [{
          ...detailRows("ops_registration_subject_tracks").data[0],
          ...inertObservationSummaryRow,
        }], error: null };
      }
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  try {
    await assert.rejects(service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: true }), (error) => error === summaryError);
    assert.ok(harness.queries.filter(({ table }) => table === "ops_registration_enrollments").every(({ signal }) => signal.aborted));
  } finally {
    enrollments.resolve();
  }
  failing = false;
  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: true });
  assert.equal(detail.enrollments.length, 1);
  assert.equal(harness.queries.filter(({ table }) => table === "ops_tasks").length, 2);
  assert.equal(harness.queries.filter(({ table }) => table === "ops_registration_subject_track_summaries").length, 2);
});

test("an enrollment failure observes a later parallel summary rejection", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const summary = deferred();
  const enrollmentError = new Error("enrollment read failed");
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "ops_registration_enrollments") return { data: null, error: enrollmentError };
      if (query.table === "ops_registration_subject_track_summaries") return summary.promise;
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  await assert.rejects(service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: true }), (error) => error === enrollmentError);
  assert.equal(harness.queries.filter(({ table }) => table === "ops_registration_subject_track_summaries").length, 1);
  summary.reject(new Error("late summary read failed"));
  await new Promise(setImmediate);
});

test("parallel detail loading does not request unnecessary observation summaries", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  for (const scenario of ["generic", "no-tracks", "complete-summary"]) {
    const harness = createClient({
      queryHandler(query) {
        assert.notEqual(query.table, "ops_registration_subject_track_summaries", scenario);
        if (query.table === "ops_registration_subject_tracks" && scenario !== "generic") {
          return { data: scenario === "no-tracks" ? [] : [{
            ...detailRows(query.table).data[0],
            ...inertObservationSummaryRow,
          }], error: null };
        }
        return detailRows(query.table);
      },
    });
    const service = createRegistrationTrackService(harness.client, readyOptions({
      probeObservationRuntime: async () => { throw new Error("unnecessary observation runtime probe"); },
    }));
    const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { observationAware: scenario !== "generic" });
    assert.equal(detail.task.id, "73000000-0000-4000-8000-000000000001");
    assert.equal(detail.tracks.length, scenario === "no-tracks" ? 0 : 1);
  }
});

test("a stalled case-detail read times out and a forced retry can start fresh", async () => {
  const { createRegistrationTrackService } = await loadFactory({ setTimeout, clearTimeout });
  const stalledEvents = deferred();
  let shouldStallEvents = true;
  const harness = createClient({
    queryHandler(query) {
      return detailRows(query.table);
    },
    eventHandler: () => shouldStallEvents ? stalledEvents.promise : eventRpcResult(detailRows("ops_task_events").data),
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    requestTimeoutMs: 5,
  }));
  const firstDetail = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { force: true });

  assert.strictEqual(service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1"), firstDetail);

  const outcome = await Promise.race([
    firstDetail.then(
      () => ({ kind: "resolved" }),
      (error) => ({ kind: "rejected", error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "still_pending" }), 30)),
  ]);

  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.code, "REGISTRATION_REQUEST_TIMEOUT");
  assert.match(outcome.error?.message || "", /registration_query_timeout/);

  shouldStallEvents = false;
  const detail = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { force: true });
  assert.equal(detail.task.id, "73000000-0000-4000-8000-000000000001");
  const eventRequests = harness.rpcRequests.filter((request) => request.name === "read_registration_contact_events_v1");
  assert.equal(eventRequests.length, 2);
  assert.equal(eventRequests[0].signal.aborted, true);
  assert.equal(eventRequests[1].signal.aborted, false);
  assert.ok(eventRequests.every((request) => request.retryEnabled === false));
  assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false);
  stalledEvents.resolve(eventRpcResult(detailRows("ops_task_events").data));
  await Promise.resolve();
  assert.deepEqual(await service.loadCaseDetail(CONTACT_TASK, "viewer-1"), detail);
  assert.equal(harness.queries.length, 18, "both attempts start the two enrollment reads before the event timeout");
});

test("a stalled appointment cancellation returns control to the editor", async () => {
  const { createRegistrationTrackService } = await loadFactory({ setTimeout, clearTimeout });
  const stalledCancellation = deferred();
  const harness = createClient({
    rpcHandler(name) {
      if (name === "cancel_registration_appointment") return stalledCancellation.promise;
      return { data: { ok: true }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({ requestTimeoutMs: 5 }));

  const outcome = await Promise.race([
    service.cancelRegistrationAppointment({
      appointmentId: "appointment-1",
      expectedNotificationRevision: 1,
      reason: "예약 취소",
      requestKey: "cancel-request-key",
    }).then(
      () => ({ kind: "resolved" }),
      (error) => ({ kind: "rejected", error }),
    ),
    new Promise((resolve) => setTimeout(() => resolve({ kind: "still_pending" }), 30)),
  ]);

  assert.equal(outcome.kind, "rejected");
  assert.equal(outcome.error?.code, "REGISTRATION_REQUEST_TIMEOUT");
  assert.match(outcome.error?.message || "", /registration_mutation_timeout/);
  assert.deepEqual(harness.rpcCalls.map(([name]) => name), ["cancel_registration_appointment"]);
});

test("a runtime-probe failure aborts the parallel case-detail reads", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const stalledReads = deferred();
  const runtimeError = new Error("registration_runtime_probe_timeout");
  runtimeError.code = "REGISTRATION_REQUEST_TIMEOUT";
  const harness = createClient({
    queryHandler: () => stalledReads.promise,
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    probeRuntime: async () => { throw runtimeError; },
    requestTimeoutMs: 50,
  }));

  await assert.rejects(
    service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { force: true }),
    (error) => error === runtimeError,
  );
  assert.equal(harness.queries.length, 7);
  assert.equal(harness.getAbortedQueryCount(), 7);
  const eventRequest = harness.rpcRequests.find((request) => request.name === "read_registration_contact_events_v1");
  assert.ok(eventRequest.signal instanceof AbortSignal);
  assert.equal(eventRequest.signal.aborted, true);
  assert.equal(eventRequest.retryEnabled, false);
  assert.equal(harness.queries.some((query) => query.table === "ops_task_events"), false);
});

test("detail loader bounds current and historical rows, maps them, and shares same-viewer in-flight work", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const gate = deferred();
  let first = true;
  const harness = createClient({
    queryHandler(query) {
      if (first) {
        first = false;
        return gate.promise.then(() => detailRows(query.table));
      }
      return detailRows(query.table);
    },
  });
  const measures = [];
  const performanceCalls = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    performance: {
      mark: (name) => performanceCalls.push(["mark", name]),
      measure: (name, start, end) => performanceCalls.push(["measure", name, start, end]),
    },
    recordMeasure: (entry) => measures.push({ ...entry }),
  }));

  const left = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  const right = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  assert.strictEqual(left, right);
  gate.resolve();
  const detail = await left;

  assert.equal(harness.queries.length, 9);
  assert.equal(harness.rpcCalls.length, 3);
  assert.equal(detail.commonRevision, 3);
  assert.equal(detail.tracks[0].directorName, "강부희");
  assert.equal(detail.tracks[0].phoneReadyAt, "2026-07-12T01:00:00Z");
  assert.equal(detail.tracks[0].phoneReadySource, "inquiry");
  assert.equal(detail.admissionApplicationMessageStatus, "failed_hold");
  assert.equal(detail.admissionApplicationMessageClaimActive, true);
  assert.equal(detail.admissionApplicationAccepted, false);
  assert.equal(detail.levelTests[0].materialLink, "https://drive.test/test");
  assert.equal(detail.consultations[0].appointmentId, null);
  assert.equal(detail.consultations[0].readyAt, "2026-07-12T01:00:00Z");
  assert.equal(detail.consultations[0].readySource, "level_test_completion");
  assert.equal(detail.enrollments[0].textbookId, null);
  assert.deepEqual(JSON.parse(JSON.stringify(detail.collectionWindows)), {
    scheduledAppointments: { loadedCount: 1, totalCount: 1, overflow: false },
    currentEnrollments: { loadedCount: 1, totalCount: 1, overflow: false },
  });
  assert.deepEqual(Array.from(detail.events, (event) => event.id), [EVENT_FIXTURE_IDS.legacy, EVENT_FIXTURE_IDS.canonical]);
  assert.equal(detail.events[1].eventType, "consultation_completed");
  assert.equal(detail.events[1].trackId, "track-1");
  assert.deepEqual({ ...detail.events[1].metadata }, { consultationId: "consultation-1" });
  assert.equal(detail.events[0].eventType, "future_event");
  assert.equal(detail.events[0].legacyText, "plain future history");
  assertCaseDetailUsesServerPrivacyFilters(harness);
  const messages = harness.queries.find((query) => query.table === "ops_registration_messages");
  assert.deepEqual(messages.filters, [
    ["eq", "task_id", "73000000-0000-4000-8000-000000000001"],
    ["eq", "template_key", "admission_application"],
    ["eq", "claim_active", true],
  ]);
  assert.equal(messages.limit, 1);
  const tracks = harness.queries.find((query) => query.table === "ops_registration_subject_tracks");
  assert.deepEqual(tracks.filters, [
    ["eq", "task_id", "73000000-0000-4000-8000-000000000001"],
    ["is", "archived_at", null],
    ["in", "active_level_tests.status", ["scheduled", "in_progress"]],
    ["in", "level_test_history.status", ["completed", "absent", "canceled"]],
    ["in", "active_consultations.status", ["waiting", "scheduled"]],
    ["in", "consultation_history.status", ["completed", "canceled"]],
  ]);
  assert.match(tracks.columns, /active_level_tests:ops_registration_level_tests\(id,/);
  assert.match(tracks.columns, /level_test_history:ops_registration_level_tests\(id,/);
  assert.match(tracks.columns, /active_consultations:ops_registration_consultations\(id,/);
  assert.match(tracks.columns, /consultation_history:ops_registration_consultations\(id,/);
  assert.doesNotMatch(tracks.columns, /enrollments:ops_registration_enrollments\(id,/);
  assert.equal(harness.queries.some((query) => [
    "ops_registration_level_tests", "ops_registration_consultations",
  ].includes(query.table)), false);
  assert.equal(harness.queries.filter(
    (query) => query.table === "ops_registration_enrollments",
  ).length, 2);
  assert.deepEqual(measures, [{ name: "registration:case-detail", cacheHit: false, queryCount: 12, ok: true }]);
  assert.ok(performanceCalls.some((entry) => entry[0] === "measure" && entry[1] === "registration:case-detail"));

  const cached = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  assert.deepEqual(cached, detail);
  assert.notStrictEqual(cached, detail, "contacts are freshly authorized even when business data is cached");
  assert.equal(harness.queries.length, 9);
  assert.equal(harness.rpcCalls.length, 4);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, 1);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "get_registration_case_contact_v1").length, 2);
  assert.deepEqual(measures.at(-1), {
    name: "registration:case-detail", cacheHit: true, queryCount: 1, ok: true,
  });
  const detailPerformanceMeasures = performanceCalls.filter((entry) => entry[0] === "measure" && entry[1] === "registration:case-detail");
  assert.equal(detailPerformanceMeasures.length, 2);
  assert.notEqual(detailPerformanceMeasures[0][2], detailPerformanceMeasures[1][2]);
  assert.notEqual(detailPerformanceMeasures[0][3], detailPerformanceMeasures[1][3]);
});

test("detail caches are viewer-scoped, rejected reads are removed, and clear ignores stale completions", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let fail = true;
  const harness = createClient({
    queryHandler(query) {
      if (fail) return { data: null, error: new Error("temporary") };
      return detailRows(query.table);
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await assert.rejects(service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1"), /temporary/);
  fail = false;
  await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  const afterViewerOne = harness.queries.length;
  const afterViewerOneEvents = harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length;
  await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-2");
  assert.equal(harness.queries.length, afterViewerOne + 9);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, afterViewerOneEvents + 1);

  service.clearCaches();
  await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  assert.equal(harness.queries.length, afterViewerOne + 18);
  assert.equal(harness.rpcCalls.filter(([name]) => name === "read_registration_contact_events_v1").length, afterViewerOneEvents + 2);
});

test("registration option loader starts five reads, includes schools, excludes students and inactive rows", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const gates = new Map(["profiles", "classes", "textbooks", "teacher_catalogs", "academic_schools"].map((table) => [table, deferred()]));
  const rows = {
    profiles: [{ id: "director-1", name: "강부희", email: "director@test", role: "admin", login_id: "director" }],
    classes: [
      { id: "class-1", name: "고1 영어", subject: "영어", grade: "고1", teacher: "교사", room: "1", textbook_ids: ["book-1"], status: "운영" },
      { id: "class-2", name: "폐강", subject: "영어", grade: "고1", teacher: "교사", room: "2", textbook_ids: [], status: "폐강" },
    ],
    textbooks: [
      { id: "book-1", title: "교재", publisher: "출판사", subject: "영어", status: "사용" },
      { id: "book-2", title: "미사용", publisher: "출판사", subject: "영어", status: "미사용" },
    ],
    teacher_catalogs: [{ id: "teacher-1", name: "교사", subjects: ["영어"], is_visible: true, sort_order: 1, profile_id: "director-1", account_email: "director@test" }],
    academic_schools: [
      { id: "school-high-2", name: "한빛고", category: "highschool", sort_order: 2 },
      { id: "school-high-1", name: "가람고", category: "high", sort_order: 1 },
    ],
  };
  const harness = createClient({
    queryHandler(query) {
      return gates.get(query.table).promise.then(() => ({ data: rows[query.table], error: null }));
    },
  });
  const measures = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    recordMeasure: (entry) => measures.push({ ...entry }),
  }));

  const load = service.loadWorkspaceOptionData({ viewerId: "viewer-1" });
  await Promise.resolve();
  assert.equal(harness.getMaxActiveQueries(), 5);
  assert.deepEqual(harness.queries.map((query) => query.table).sort(), [
    "academic_schools", "classes", "profiles", "teacher_catalogs", "textbooks",
  ]);
  assert.ok(!harness.queries.some((query) => query.table === "students"));
  for (const query of harness.queries) {
    assert.doesNotMatch(query.columns, /schedule_plan|student_ids|waitlist_ids/);
  }
  for (const gate of gates.values()) gate.resolve();
  const result = await load;

  assert.equal(result.directorCatalogStatus, "authoritative");
  assert.equal(result.students.length, 0);
  assert.deepEqual(Array.from(result.classes, (row) => row.id), ["class-1"]);
  assert.deepEqual(Array.from(result.textbooks, (row) => row.id), ["book-1"]);
  assert.deepEqual(Array.from(result.schools, (school) => ({ ...school })), [
    { id: "school-high-2", name: "한빛고", category: "highschool", sortOrder: 2 },
    { id: "school-high-1", name: "가람고", category: "high", sortOrder: 1 },
  ]);
  assert.equal(result.schoolCatalogStatus, "authoritative");
  assert.equal(result.schoolCatalogError, null);
  assert.equal(harness.queries.find((query) => query.table === "academic_schools").columns, "id,name,category,sort_order");
  assert.deepEqual(measures, [{
    name: "registration:option-summary", cacheHit: false, queryCount: 5, ok: true,
  }]);
});

test("assigned science consultation class loader filters canonical inactive rows and bounds its consultation cache", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  let now = 1_000;
  const harness = createClient({
    queryHandler(query) {
      assert.equal(query.table, "classes");
      return {
        data: [
          { id: "science-active", name: "고1 과학", subject: "과학", grade: "고1", teacher: "과학교사", room: "4", status: "운영" },
          { id: "science-ended", name: "종강 과학", subject: "과학", grade: "고2", teacher: "과학교사", room: "5", status: "종료" },
          { id: "science-archived", name: "보관 과학", subject: "과학", grade: "고3", teacher: "과학교사", room: "7", status: "종강" },
          { id: "math-leak", name: "수학", subject: "수학", grade: "고1", teacher: "수학교사", room: "6", status: "운영" },
        ],
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({ now: () => now }));

  const first = await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1" });
  const cached = await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1" });

  assert.strictEqual(cached, first);
  assert.deepEqual(JSON.parse(JSON.stringify(first)), [{
    id: "science-active",
    label: "고1 과학",
    meta: "고1 · 과학교사",
    subject: "과학",
    grade: "고1",
    teacher: "과학교사",
    room: "4",
    schedule: "",
    studentIds: [],
    waitlistIds: [],
    textbookIds: [],
  }]);
  assert.equal(harness.queries.length, 1);
  assert.equal(harness.queries[0].columns, "id,name,subject,grade,teacher,room,status");
  assert.deepEqual(harness.queries[0].filters, [["eq", "subject", "과학"]]);
  assert.equal(harness.rpcCalls.length, 0);

  now += 60_001;
  await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1" });
  assert.equal(harness.queries.length, 2);
  await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-2" });
  assert.equal(harness.queries.length, 3, "같은 viewer라도 다른 상담은 별도 cache key를 사용한다");
  await service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "consultation-1", force: true });
  assert.equal(harness.queries.length, 4);
  await assert.rejects(
    async () => service.loadAssignedScienceConsultationClassOptions({ viewerId: "", consultationId: "consultation-1" }),
    /non-empty viewer ID/i,
  );
  await assert.rejects(
    async () => service.loadAssignedScienceConsultationClassOptions({ viewerId: "science-teacher", consultationId: "" }),
    /non-empty consultation ID/i,
  );
  assert.equal(harness.queries.length, 4, "viewer 또는 assigned 상담이 없으면 class request를 만들지 않는다");
});

test("option fallback is partial, option errors are explicit, and failed measures still close", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const measures = [];
  const missingColumn = { code: "42703", message: "column is missing" };
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "teacher_catalogs" && query.columns.includes("profile_id")) {
        return { data: null, error: missingColumn };
      }
      return { data: [], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions({
    recordMeasure: (entry) => measures.push({ ...entry }),
  }));
  const partial = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" });
  assert.equal(partial.directorCatalogStatus, "partial");
  assert.equal(partial.schemaReady, true);

  const denied = new Error("permission denied");
  const deniedHarness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") return { data: null, error: denied };
      return { data: [], error: null };
    },
  });
  const deniedMeasures = [];
  const deniedService = createRegistrationTrackService(deniedHarness.client, readyOptions({
    recordMeasure: (entry) => deniedMeasures.push({ ...entry }),
  }));
  const result = await deniedService.loadWorkspaceOptionData({ viewerId: "viewer-2" });
  assert.equal(result.directorCatalogStatus, "error");
  assert.equal(result.schemaReady, false);
  assert.match(result.error, /permission denied/);
  assert.deepEqual(deniedMeasures, [{
    name: "registration:option-summary", cacheHit: false, queryCount: 5, ok: true,
  }]);
});

test("school catalog failure does not fail required registration options", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({ queryHandler(query) {
    if (query.table === "academic_schools") return { data: null, error: new Error("school denied") };
    return { data: [], error: null };
  } });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const result = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" });
  assert.equal(result.schemaReady, true);
  assert.equal(result.error, null);
  assert.equal(result.schoolCatalogStatus, "error");
  assert.match(result.schoolCatalogError, /school denied/);
  assert.deepEqual(Array.from(result.schools), []);
});

test("business Task 3 wrappers preserve exact RPC names, stable keys, and nullable UUIDs", async () => {
  const { createRegistrationTrackService, createRegistrationMutationRequestKey } = await loadFactory();
  const enrollmentRow = {
    id: "enrollment-1", track_id: "track-1", student_id: null,
    admission_batch_id: "batch-1", class_id: "class-1", textbook_id: null,
    class_start_date: null, class_start_session_key: null, class_start_session: null,
    status: "enrolled", makeedu_registered: true, roster_active: true,
    roster_released_at: null, roster_release_reason: null,
    roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
  };
  const harness = createClient({
    rpcHandler(name) {
      if (name === "save_registration_enrollment_rows") {
        return { data: { track_id: "track-1", rows: [enrollmentRow] }, error: null };
      }
      if (name === "complete_registration_admission_batch") {
        return { data: {
          batch: { id: "batch-1", task_id: "73000000-0000-4000-8000-000000000001", revision_number: 1, status: "completed", invoice_sent_at: "i", payment_confirmed_at: "p", created_at: "c", updated_at: "u" },
          enrollments: [enrollmentRow],
        }, error: null };
      }
      if (name === "complete_registration_consultation") {
        return { data: {
          consultation: { id: "consultation-1", status: "completed", outcome: "waiting" },
          track: { id: "track-1", task_id: "73000000-0000-4000-8000-000000000001", subject: "영어", pipeline_status: "waiting" },
        }, error: null };
      }
      return { data: { ok: true }, error: null };
    },
  });
  let mutationInvalidations = 0;
  const service = createRegistrationTrackService(harness.client, readyOptions({
    onMutationSuccess: () => { mutationInvalidations += 1; },
  }));
  const key = "request-key";

  await service.syncRegistrationCaseSubjects({ taskId: "73000000-0000-4000-8000-000000000001", subjects: ["영어"], expectedSubjects: ["영어"], requestKey: key });
  await service.routeRegistrationInquiry({ trackId: "track-1", destination: "waiting", waitingKind: "current_term_opening", classId: "", requestKey: key });
  await service.assignRegistrationTrackDirector({ trackId: "track-1", directorProfileId: "", assignmentSource: "manual", ruleKey: "", expectedCommonRevision: 3, requestKey: key });
  await service.saveRegistrationSharedAppointment({ appointmentId: "", taskId: "73000000-0000-4000-8000-000000000001", kind: "level_test", scheduledAt: "2026-07-13T01:00:00Z", place: "본관", trackIds: ["track-1"], replaceRemaining: false, expectedNotificationRevision: 0, requestKey: key });
  await service.cancelRegistrationAppointment({ appointmentId: "appointment-1", expectedNotificationRevision: 1, reason: "변경", requestKey: key });
  await service.startRegistrationLevelTestAttempt({ attemptId: "attempt-1", requestKey: key });
  await service.completeRegistrationLevelTestAttempt({ attemptId: "attempt-1", status: "completed", materialLink: "https://drive.test", requestKey: key });
  await service.closeRegistrationLevelTestTrack({ trackId: "track-1", reason: "종료", requestKey: key });
  await service.completeRegistrationConsultation({ consultationId: "consultation-1", outcome: "waiting", waitingKind: "next_term_opening", classId: "", requestKey: key });
  await service.transitionRegistrationWaiting({ trackId: "track-1", action: "change_waiting_kind", waitingKind: "current_term_opening", classId: "", retakeDecision: "", reason: "", requestKey: key });
  await service.routeRegistrationEnrollmentDecision({ trackId: "track-1", destination: "waiting", waitingKind: "current_term_opening", classId: "", reason: "", requestKey: key });
  const saved = await service.saveRegistrationEnrollmentRows({ trackId: "track-1", rows: [{ id: "", classId: "class-1", textbookId: "", classStartDate: "", classStartSessionKey: "", classStartLessonSessionId: "10000000-0000-4000-8000-000000000011", classStartSession: "", sortOrder: 0 }], requestKey: key });
  await service.claimRegistrationAdmissionMessage({ taskId: "73000000-0000-4000-8000-000000000001", messageRequestKey: "message-key" });
  await service.reconcileRegistrationAdmissionMessage({ messageId: "message-1", resolution: "accepted", providerEvidence: { observedState: "accepted", providerMessageId: "provider-1" }, reason: "확인", requestKey: key });
  await service.releaseRegistrationAdmissionMessageRetry({ messageId: "message-1", providerEvidence: { observedState: "closed", lookupRequestKey: "message-key" }, reason: "재발송", requestKey: key });
  await service.markRegistrationAdmissionNoticeSent({ taskId: "73000000-0000-4000-8000-000000000001", messageRequestKey: "message-key", requestKey: key });
  await service.startRegistrationAdmissionBatch({ taskId: "73000000-0000-4000-8000-000000000001", trackIds: ["track-1"], enrollmentIds: ["enrollment-1"], requestKey: key });
  await service.setRegistrationEnrollmentMakeedu({ enrollmentId: "enrollment-1", registered: true, requestKey: key });
  await service.advanceRegistrationAdmissionBatch({ batchId: "batch-1", action: "invoice_sent", requestKey: key });
  await service.cancelRegistrationAdmissionBatch({ batchId: "batch-1", resolutions: [], reason: "취소", requestKey: key });
  const completed = await service.completeRegistrationAdmissionBatch({ batchId: "batch-1", requestKey: key });
  await service.cancelRegistrationEnrollment({ enrollmentId: "enrollment-1", destination: "", waitingKind: "", classId: "", reason: "취소", requestKey: key });
  await service.resolveRegistrationMigrationReview({ taskId: "73000000-0000-4000-8000-000000000001", assignments: [], trackStates: [], requestKey: key });
  await service.setStudentClassRosterMode({ studentId: "student-1", classId: "class-1", nextMode: "enrolled", expectedMode: "removed", memo: "등록" });

  assert.deepEqual(harness.rpcCalls.map(([name]) => name), [
    "sync_registration_case_subjects_v2",
    "route_registration_inquiry", "assign_registration_track_director",
    "save_registration_appointment_details_v1", "cancel_registration_appointment",
    "start_registration_level_test_attempt", "complete_registration_level_test_attempt",
    "close_registration_level_test_track", "complete_registration_consultation",
    "transition_registration_waiting", "route_registration_enrollment_decision",
    "save_registration_enrollment_rows", "claim_registration_admission_message",
    "reconcile_registration_admission_message", "release_registration_admission_message_retry",
    "mark_registration_admission_notice_sent", "start_registration_admission_batch",
    "set_registration_enrollment_makeedu", "advance_registration_admission_batch",
    "cancel_registration_admission_batch", "complete_registration_admission_batch",
    "cancel_registration_enrollment", "resolve_registration_migration_review",
    "set_student_class_roster_mode",
  ]);
  assert.equal(harness.rpcCalls[2][1].p_director_profile_id, null);
  assert.equal(harness.rpcCalls[3][1].p_appointment_id, null);
  assert.equal(harness.rpcCalls[8][1].p_class_id, null);
  assert.equal(harness.rpcCalls[11][1].p_rows[0].id, null);
  assert.equal(harness.rpcCalls[11][1].p_rows[0].textbookId, null);
  assert.equal(harness.rpcCalls[11][1].p_rows[0].classStartLessonSessionId, "10000000-0000-4000-8000-000000000011");
  assert.equal(JSON.stringify(harness.rpcCalls[22][1].p_assignments), JSON.stringify({ assignments: [], trackStates: [] }));
  assert.equal("p_track_states" in harness.rpcCalls[22][1], false);
  assert.equal(harness.rpcCalls[21][1].p_destination, null);
  assert.equal(saved.rows[0].trackId, "track-1");
  assert.equal(saved.rows[0].textbookId, null);
  assert.equal(completed.batch.taskId, "73000000-0000-4000-8000-000000000001");
  assert.equal(completed.enrollments[0].makeeduRegistered, true);
  assert.equal(createRegistrationMutationRequestKey("save", "track-1"), "save:track-1:uuid-from-crypto");
  assert.equal(mutationInvalidations, 24, "every successful registration RPC must invalidate parent consumers");
});

test("enrollment save omits a legacy schedule identifier from the normalized lesson-session field", async () => {
  // Production break caught: a legacy schedule's non-UUID identifier reaches
  // the enrollment RPC and is rejected as registration_enrollment_rows_invalid.
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "save_registration_enrollment_rows");
      return { data: { track_id: "track-1", rows: [] }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.saveRegistrationEnrollmentRows({
    trackId: "track-1",
    rows: [{
      classId: "10000000-0000-4000-8000-000000000001",
      classStartDate: "2026-08-19",
      classStartSessionKey: "legacy:2026-08-19:1",
      classStartLessonSessionId: "legacy:2026-08-19:1",
      classStartSession: "1회차",
      sortOrder: 0,
    }],
    requestKey: "enrollment-legacy-session-id",
  });

  assert.equal(harness.rpcCalls[0][1].p_rows[0].classStartLessonSessionId, null);
});

test("admission completion uses the injected post-commit public cache invalidator", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const enrollment = {
    id: "enrollment-1", track_id: "track-1", student_id: null,
    admission_batch_id: "batch-1", class_id: "class-1", textbook_id: null,
    class_start_date: null, class_start_session_key: null, class_start_session: null,
    status: "enrolled", makeedu_registered: true, roster_active: true,
    roster_released_at: null, roster_release_reason: null,
    roster_release_source_task_id: null, roster_release_kind: null, sort_order: 0,
  };
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "complete_registration_admission_batch");
      return {
        data: {
          batch: { id: "batch-1", task_id: "73000000-0000-4000-8000-000000000001", revision_number: 1, status: "completed", invoice_sent_at: "i", payment_confirmed_at: "p", created_at: "c", updated_at: "u" },
          enrollments: [enrollment],
        },
        error: null,
      };
    },
  });
  const calls = [];
  const service = createRegistrationTrackService(harness.client, readyOptions({
    invalidatePublicClassesCacheAfterMutation: async (client, reason) => {
      calls.push([client, reason]);
      return { status: "pending", reason, requestId: "refresh-1" };
    },
  }));

  const result = await service.completeRegistrationAdmissionBatch({
    batchId: "batch-1",
    requestKey: "complete-batch",
  });

  assert.deepEqual(calls, [[harness.client, "class"]]);
  assert.deepEqual(result.publicClassesCacheRefresh, {
    status: "pending", reason: "class", requestId: "refresh-1",
  });
});

test("first lesson source serialization sends regular sentinel as null and maps the exact response key", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const sourceObservationId = "74000000-0000-4000-8000-000000000001";
  const persistedSourceObservationId = "74000000-0000-4000-8000-000000000002";
  const rows = [{
    classId: "74000000-0000-4000-8000-000000000010",
    textbookId: null,
    classStartDate: "2026-08-17",
    classStartSessionKey: "legacy:2026-08-17:1",
    classStartLessonSessionId: null,
    classStartSession: "청강 회차",
    classStartSourceObservationId: sourceObservationId,
    sortOrder: 0,
  }, {
    classId: "74000000-0000-4000-8000-000000000020",
    textbookId: null,
    classStartDate: "2026-08-24",
    classStartSessionKey: "regular:2026-08-24:2",
    classStartLessonSessionId: "74000000-0000-4000-8000-000000000021",
    classStartSession: "2회차",
    classStartSourceObservationId: "",
    sortOrder: 1,
  }];
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_enrollment_details_v1");
      return { data: {
        trackId: "74000000-0000-4000-8000-000000000030",
        rows: args.p_rows.map((row, index) => index === 0
          ? { ...row, classStartSourceObservationId: persistedSourceObservationId }
          : row),
      }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationEnrollmentDetails({
    trackId: "74000000-0000-4000-8000-000000000030",
    rows,
    requestKey: "first-lesson-source",
  });

  assert.equal(harness.rpcCalls[0][1].p_rows[0].classStartSourceObservationId, sourceObservationId);
  assert.equal(harness.rpcCalls[0][1].p_rows[1].classStartSourceObservationId, null);
  assert.equal(result.rows[0].classStartSourceObservationId, persistedSourceObservationId, "response hydration owns the reopened source id");
  assert.equal(result.rows[1].classStartSourceObservationId, null);
  assert.equal(result.rows[0].classStartSessionKey, "legacy:2026-08-17:1");
});

test("registration core legacy bridge reads only stable source event IDs", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "list_registration_legacy_source_ids_v1");
      assert.deepEqual({ ...args }, { p_task_id: "73000000-0000-4000-8000-000000000001" });
      return {
        data: {
          taskId: "73000000-0000-4000-8000-000000000001",
          sourceEventIds: ["event-1", "event-2", "", null],
          title: "must-not-leak",
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.deepEqual(
    Array.from(await service.listRegistrationLegacySourceIds("73000000-0000-4000-8000-000000000001")),
    ["event-1", "event-2"],
  );
  assert.equal(harness.queries.length, 0);
});

test("consultation completion maps canonical readiness from camel-case RPC rows", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name) {
      assert.equal(name, "complete_registration_consultation");
      return {
        data: {
          consultation: {
            id: "consultation-1",
            trackId: "track-1",
            appointmentId: null,
            mode: "phone",
            status: "completed",
            directorProfileId: "director-1",
            readyAt: "2026-07-12T01:00:00Z",
            readySource: "track_reopened",
            completedAt: "2026-07-12T03:00:00Z",
            outcome: "enrollment",
            createdAt: "2026-07-12T01:30:00Z",
            updatedAt: "2026-07-12T03:00:00Z",
          },
          track: {
            id: "track-1",
            taskId: "73000000-0000-4000-8000-000000000001",
            subject: "영어",
            status: "enrollment_decided",
            directorProfileId: "director-1",
            directorAssignmentSource: "default",
            directorAssignmentRuleKey: "english:2026:high1",
            waitingKind: "",
            levelTestRetakeDecision: "",
            migrationReviewRequired: false,
            stageEnteredAt: "2026-07-12T03:00:00Z",
            phoneReadyAt: "2026-07-12T01:00:00Z",
            phoneReadySource: "director_resolved",
          },
        },
        error: null,
      };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.completeRegistrationConsultation({
    consultationId: "consultation-1",
    outcome: "enrollment",
    waitingKind: "",
    classId: "",
    requestKey: "consultation-key",
  });

  assert.equal(result.consultation.readyAt, "2026-07-12T01:00:00Z");
  assert.equal(result.consultation.readySource, "track_reopened");
  assert.equal(result.track.phoneReadyAt, "2026-07-12T01:00:00Z");
  assert.equal(result.track.phoneReadySource, "director_resolved");
});

test("unsupported initial-workflow create cannot fall back to a raw contact RPC", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();let contactCalls=0;
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async()=>{contactCalls++;throw Error("unexpected");}}));
  for(const appointment of [null,{scheduledAt:"2026-10-09T01:00:00Z",place:"본관",subjects:["영어"]}]) await assert.rejects(service.createRegistrationCaseWithInitialWorkflow({...commonContactInput(),subjects:["영어"],levelTestAppointment:appointment,visitAppointment:appointment}),/registration_contact_initial_workflow_unsupported/);
  assert.equal(harness.rpcCalls.length,0);assert.equal(contactCalls,0);

});

test("initial-workflow create stays fail closed when the old runtime marker is available", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();let contactCalls=0;
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async()=>{contactCalls++;throw Error("unexpected");}}));
  for(const appointment of [null,{scheduledAt:"2026-10-09T01:00:00Z",place:"본관",subjects:["영어"]}]) await assert.rejects(service.createRegistrationCaseWithInitialWorkflow({...commonContactInput(),subjects:["영어"],levelTestAppointment:appointment,visitAppointment:appointment}),/registration_contact_initial_workflow_unsupported/);
  assert.equal(harness.rpcCalls.length,0);assert.equal(contactCalls,0);

});

test("initial-workflow create never submits contact for either appointment shape", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();let contactCalls=0;
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async()=>{contactCalls++;throw Error("unexpected");}}));
  for(const appointment of [null,{scheduledAt:"2026-10-09T01:00:00Z",place:"본관",subjects:["영어"]}]) await assert.rejects(service.createRegistrationCaseWithInitialWorkflow({...commonContactInput(),subjects:["영어"],levelTestAppointment:appointment,visitAppointment:appointment}),/registration_contact_initial_workflow_unsupported/);
  assert.equal(harness.rpcCalls.length,0);assert.equal(contactCalls,0);

});

test("contact commands require transport and an opened snapshot without old-writer fallback", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();let writes=0;
  const absent=createRegistrationTrackService(harness.client,readyOptions());await assert.rejects(absent.updateRegistrationCaseCommon(commonContactInput()),/registration_contact_runtime_unavailable/);
  const ready=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async()=>{writes++;throw Error("unexpected");}}));
  await assert.rejects(ready.updateRegistrationCaseCommon(commonContactInput({contactState:null})),/registration_contact_snapshot_required/);
  await assert.rejects(ready.updateRegistrationCaseCommon(commonContactInput({requestKey:"invalid"})),/registration_contact_request_key_invalid/);
  await assert.rejects(ready.reopenRegistrationTrack({trackId:CONTACT_TRACK,destination:"inquiry",reason:"재개",requestKey:CONTACT_KEY}),/registration_contact_snapshot_required/);
  await assert.rejects(ready.claimRegistrationAdmissionMessage({taskId:CONTACT_TASK,messageRequestKey:""}),/message request key/i);
  assert.equal(writes,0);assert.equal(harness.rpcCalls.length,0);

});

test("contact fact commands use their own server contract while roster processing remains guarded", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();let probes=0;const writes=[];
  const service=createRegistrationTrackService(harness.client,readyOptions({probeRuntime:async()=>{probes++;throw Error("runtime probe unavailable");},mutateContact:async command=>{writes.push(command);return contactEnvelope(command,{tracks:[],commonRevision:4});}}));
  await service.createRegistrationCase({...commonContactInput(),subjects:["영어"]});await service.updateRegistrationCaseCommon(commonContactInput());
  await service.setRegistrationWorkflowStatus({...commonContactInput(),trackId:CONTACT_TRACK,workflowStatus:"inquiry",expectedWorkflowRevision:1}).catch(error=>{assert.match(error.message,/response_invalid/)});
  assert.equal(probes,0);assert.equal(writes.length,3);assert.equal(harness.rpcCalls.length,0);
  await assert.rejects(service.startRegistrationAdmissionBatch({taskId:CONTACT_TASK,trackIds:[CONTACT_TRACK],enrollmentIds:[],requestKey:CONTACT_KEY}),/runtime probe unavailable/);assert.equal(probes,1);

});

test("contact inquiry datetime-local facts serialize Seoul instants and omit student contact", async () => {

  const {createRegistrationTrackService}=await loadFactory();const calls=[];const service=createRegistrationTrackService(createClient().client,readyOptions({mutateContact:async command=>{calls.push(command);return contactEnvelope(command,{tracks:[],commonRevision:4});}}));
  await service.createRegistrationCase({...commonContactInput(),subjects:["영어"]});await service.updateRegistrationCaseCommon(commonContactInput());
  assert.equal(calls[0].payload.inquiryAt,"2026-09-01T09:49:00.000Z");assert.equal(calls[1].payload.inquiryAt,"2026-09-01T09:49:00.000Z");assert.doesNotMatch(JSON.stringify(calls),/studentPhone|RETIRED_STUDENT_CANARY/);

});

test("all cached registration reads require an authenticated viewer id", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());

  assert.throws(
    () => service.loadTrackSummaries(["73000000-0000-4000-8000-000000000001"], ""),
    /viewer id/i,
  );
  assert.throws(
    () => service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "   "),
    /viewer id/i,
  );
  assert.throws(
    () => service.loadWorkspaceOptionData({ viewerId: "" }),
    /viewer id/i,
  );
  assert.equal(harness.queries.length, 0);
});

test("appointment creation and director default clearing send nullable canonical values", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());

  await service.saveRegistrationSharedAppointment({
    appointmentId: null,
    taskId: "73000000-0000-4000-8000-000000000001",
    kind: "level_test",
    scheduledAt: "2026-07-13T01:00:00Z",
    place: "본관",
    trackIds: ["track-1"],
    replaceRemaining: false,
    expectedNotificationRevision: null,
    requestKey: "appointment-key",
  });
  await service.assignRegistrationTrackDirector({
    trackId: "track-1",
    directorProfileId: null,
    assignmentSource: "clear_default",
    ruleKey: null,
    expectedCommonRevision: 3,
    requestKey: "director-key",
  });

  assert.equal(harness.rpcCalls[0][1].p_appointment_id, null);
  assert.equal(harness.rpcCalls[0][1].p_expected_notification_revision, null);
  assert.deepEqual({ ...harness.rpcCalls[1][1] }, {
    p_track_id: "track-1",
    p_director_profile_id: null,
    p_assignment_source: "clear_default",
    p_rule_key: null,
    p_expected_common_revision: 3,
    p_request_key: "director-key",
  });

  const source = await readServiceSource();
  assert.match(source, /expectedNotificationRevision: number \| null/);
  assert.match(source, /appointmentId: string \| null/);
  assert.match(source, /assignmentSource: "default" \| "manual" \| "clear_default"/);
  assert.match(source, /directorProfileId: string \| null/);
  assert.match(source, /ruleKey: string \| null/);
});

test("registration mutations explicitly disable PostgREST automatic retries", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const retryArguments = [];
  const rpcCalls = [];
  const client = {
    from() {
      throw new Error("unexpected table read");
    },
    rpc(name, args) {
      rpcCalls.push([name, args]);
      const response = Promise.resolve({ data: { ok: true }, error: null });
      const builder = {
        retry(enabled) {
          retryArguments.push(enabled);
          return builder;
        },
        then(resolve, reject) {
          return response.then(resolve, reject);
        },
      };
      return builder;
    },
  };
  const service = createRegistrationTrackService(client, readyOptions());

  await service.assignRegistrationTrackDirector({
    trackId: "track-1",
    directorProfileId: "profile-1",
    assignmentSource: "default",
    ruleKey: "academic-director-v1:2026:영어:중1",
    expectedCommonRevision: 2,
    requestKey: "director-default-key",
  });

  assert.deepEqual(rpcCalls.map(([name]) => name), ["assign_registration_track_director"]);
  assert.deepEqual(retryArguments, [false]);
});

test("appointment save constrains only level-test places", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient();
  const service = createRegistrationTrackService(harness.client, readyOptions());
  const common = {
    appointmentId: null,
    taskId: "73000000-0000-4000-8000-000000000001",
    scheduledAt: "2026-07-13T01:00:00Z",
    trackIds: ["track-1"],
    replaceRemaining: false,
    expectedNotificationRevision: null,
    requestKey: "appointment-key",
  };

  await assert.rejects(
    service.saveRegistrationSharedAppointment({
      ...common,
      kind: "level_test",
      place: "본관 201호",
    }),
    /registration_level_test_place_invalid/,
  );
  assert.equal(harness.rpcCalls.length, 0);

  await service.saveRegistrationSharedAppointment({
    ...common,
    kind: "visit_consultation",
    place: "본관 201호",
  });
  assert.equal(harness.rpcCalls[0][1].p_place, "본관 201호");
});

test("incomplete profile or teacher identity makes the director catalog partial", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    queryHandler(query) {
      if (query.table === "profiles") {
        return { data: [{ id: "profile-1", name: "강부희", email: "", role: "", login_id: "" }], error: null };
      }
      if (query.table === "teacher_catalogs") {
        return { data: [{
          id: "teacher-1", name: "교사", subjects: ["영어"], is_visible: true,
          sort_order: 1, profile_id: null, account_email: "",
        }], error: null };
      }
      return { data: [], error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.loadWorkspaceOptionData({ viewerId: "viewer-1" });

  assert.equal(result.directorCatalogStatus, "partial");
  assert.equal(result.schemaReady, true);
});

test("a forced detail refresh cannot be overwritten by the stale request it superseded", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const staleGate = deferred();
  const freshGate = deferred();
  let queryNumber = 0;
  const harness = createClient({
    queryHandler(query) {
      queryNumber += 1;
      const base = detailRows(query.table);
      const stalePhaseOne = queryNumber <= 7;
      const freshPhaseOne = queryNumber > 7 && queryNumber <= 14;
      const gate = stalePhaseOne ? staleGate : freshPhaseOne ? freshGate : null;
      const title = stalePhaseOne ? "stale title" : "fresh title";
      const result = query.table === "ops_tasks"
        ? { ...base, data: { ...base.data, title } }
        : base;
      return gate ? gate.promise.then(() => result) : result;
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const stale = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  await Promise.resolve();
  const fresh = service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1", { force: true });
  await Promise.resolve();
  freshGate.resolve();
  assert.equal((await fresh).task.title, "fresh title");
  staleGate.resolve();
  assert.equal((await stale).task.title, "stale title");

  const queryCount = harness.queries.length;
  const cached = await service.loadCaseDetail("73000000-0000-4000-8000-000000000001", "viewer-1");
  assert.equal(cached.task.title, "fresh title");
  assert.equal(harness.queries.length, queryCount);
});

test("public service source exposes typed aliases and excludes server-only or cross-workflow RPCs", async () => {
  const source = await readServiceSource();
  for (const typeName of [
    "OpsRegistrationTrackSummary", "OpsRegistrationCaseDetail", "OpsRegistrationAppointment",
    "OpsRegistrationLevelTest", "OpsRegistrationConsultation", "OpsRegistrationAdmissionBatch",
    "OpsRegistrationEnrollment", "OpsRegistrationTrackEvent", "RegistrationCommonUpdateResponse",
    "RegistrationAdmissionMessageClaimResponse", "RegistrationAdmissionProviderEvidence",
    "RegistrationAppointmentMutationResponse", "RegistrationEnrollmentRowsSaveResponse",
    "RegistrationConsultationCompletionResponse", "RegistrationAdmissionBatchCompletionResponse",
    "RegistrationPhoneReadySource", "RegistrationCaseCreateWithInitialWorkflowInput",
    "RegistrationCaseCreateWithInitialWorkflowResponse", "StudentClassRosterModeResponse",
  ]) {
    assert.match(source, new RegExp(`export type ${typeName}`));
  }
  assert.doesNotMatch(source, /FinalizationResponse|finalize_registration_admission_message/);
  assert.doesNotMatch(source, /complete_ops_withdrawal_roster_transition|complete_ops_transfer_roster_transition/);
  assert.match(source, /export \{ probeRegistrationSubjectTrackRuntime \}/);
  assert.match(source, /export \{\s*probeRegistrationIntakeWorkflowRuntime,\s*resetRegistrationIntakeWorkflowRuntimeProbe,?\s*\}/);
  assert.match(source, /export type \{ RegistrationIntakeRuntimeState \}/);
  assert.match(source, /phoneReadyAt: string \| null/);
  assert.match(source, /phoneReadySource: RegistrationPhoneReadySource \| null/);
  assert.match(source, /readyAt: string \| null/);
  assert.match(source, /readySource: RegistrationPhoneReadySource \| null/);
  assert.match(source, /export function createRegistrationCaseWithInitialWorkflow/);
});

test("science registration database contract preserves public RPC signatures and fail-closed capability writes", async () => {
  const migration = await readFile(
    new URL("../supabase/migrations/20260722100000_registration_science_subject.sql", import.meta.url),
    "utf8",
  );
  const pgTap = await readFile(
    new URL("../supabase/tests/registration_science_subject_test.sql", import.meta.url),
    "utf8",
  );

  assert.match(
    migration,
    /create or replace function public\.create_registration_case_with_initial_workflow_v1\(\s*p_student_name text,[\s\S]*?p_request_key text[\s\S]*?returns jsonb/,
  );
  assert.match(
    migration,
    /create or replace function public\.save_registration_shared_appointment\(\s*p_appointment_id uuid,\s*p_task_id uuid,[\s\S]*?p_request_key text[\s\S]*?returns jsonb/,
  );
  assert.match(
    migration,
    /create or replace function dashboard_private\.create_registration_case_impl\([\s\S]*?registration_subject_unsupported[\s\S]*?assert_registration_subject_enabled/,
  );
  assert.match(
    migration,
    /create or replace function dashboard_private\.sync_registration_case_subjects_impl\([\s\S]*?registration_subject_unsupported[\s\S]*?assert_registration_subject_enabled/,
  );
  assert.match(
    migration,
    /update_registration_case_common_impl[\s\S]*?exists \([\s\S]*?subject = '과학'[\s\S]*?registration_science_grade_invalid/,
  );
  assert.match(migration, /target_fingerprint/);
  assert.match(migration, /dashboard_private\.ops_registration_mutations/);
  assert.match(migration, /idempotency_key_reused/);
  assert.match(migration, /v_legacy_target_fingerprint jsonb/);
  assert.equal(
    [...migration.matchAll(/v_legacy_target_fingerprint jsonb/g)].length,
    2,
  );
  assert.equal(
    [...migration.matchAll(/v_legacy_target_fingerprint is not null/g)].length,
    2,
  );
  assert.match(
    migration,
    /mutation\.target_fingerprint = v_target_fingerprint[\s\S]*?mutation\.target_fingerprint = v_legacy_target_fingerprint/,
  );
  assert.match(pgTap, /science-legacy-create-replay/);
  assert.match(pgTap, /science-legacy-sync-replay/);
  assert.match(pgTap, /'subjects', '\["\uc218\ud559", "\uc601\uc5b4"\]'::jsonb/);
  assert.match(migration, /registration_subject_removed/);
  assert.match(migration, /write_registration_track_event_v2/);
});

test("unified inquiry save sends one atomic HTTP command with original case revisions", async () => {

  const {createRegistrationTrackService}=await loadFactory();const harness=createClient();const calls=[];
  const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async command=>{calls.push(command);return contactEnvelope(command,{commonRevision:4,tracks:[{id:CONTACT_TRACK,task_id:CONTACT_TASK,subject:"영어",pipeline_status:"inquiry"}]});}}));
  const subjects=["수학","영어"],expectedSubjects=["영어"];const result=await service.saveRegistrationCaseInquiry({...commonContactInput(),subjects,expectedSubjects});
  assert.equal(calls.length,1);assert.equal(harness.rpcCalls.length,0);assert.equal(calls[0].command,"save_inquiry");assert.equal(calls[0].expectedGeneration,"1");assert.equal(calls[0].expectedRevision,"1");assert.deepEqual(Array.from(calls[0].payload.subjects),["영어","수학"]);assert.deepEqual(Array.from(calls[0].payload.expectedSubjects),["영어"]);assert.equal(calls[0].payload.expectedCommonRevision,3);assert.equal(calls[0].payload.parentPhone,"01000000000");assert.doesNotMatch(JSON.stringify(calls),/studentPhone|RETIRED_STUDENT_CANARY/);assert.deepEqual(subjects,["수학","영어"]);assert.deepEqual(expectedSubjects,["영어"]);assert.equal(result.contactState.parentPhone,null);assert.equal(result.tracks[0].subject,"영어");

});

test("waiting contact command uses observed case revisions with canonical class UUID", async () => {

 const {createRegistrationTrackService}=await loadFactory();const calls=[];const harness=createClient();const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async command=>{calls.push(command);return contactEnvelope(command,{trackId:CONTACT_TRACK,waitingKind:"current_class",classId:"73000000-0000-4000-8000-000000000010",retakeDecision:"required"});}}));
 await service.readContact(CONTACT_TASK);const result=await service.saveRegistrationWaitingDetails({trackId:CONTACT_TRACK,waitingKind:"current_class",classId:"73000000-0000-4000-8000-000000000010",retakeDecision:"required",requestKey:CONTACT_KEY});
 assert.equal(calls.length,1);assert.equal(calls[0].command,"waiting_details");assert.equal(calls[0].expectedGeneration,"1");assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)),{trackId:CONTACT_TRACK,waitingKind:"current_class",classId:"73000000-0000-4000-8000-000000000010",retakeDecision:"required"});assert.equal(result.trackId,CONTACT_TRACK);assert.equal(result.classId,"73000000-0000-4000-8000-000000000010");assert.equal(harness.rpcCalls.length,1);

});

test("waiting contact command preserves explicit nullable clearing", async () => {

 const {createRegistrationTrackService}=await loadFactory();const calls=[];const harness=createClient();const service=createRegistrationTrackService(harness.client,readyOptions({mutateContact:async command=>{calls.push(command);return contactEnvelope(command,{trackId:CONTACT_TRACK,waitingKind:"",classId:"",retakeDecision:""});}}));
 await service.readContact(CONTACT_TASK);const result=await service.saveRegistrationWaitingDetails({trackId:CONTACT_TRACK,waitingKind:"",classId:"",retakeDecision:"",requestKey:CONTACT_KEY});
 assert.equal(calls.length,1);assert.equal(calls[0].command,"waiting_details");assert.equal(calls[0].expectedGeneration,"1");assert.deepEqual(JSON.parse(JSON.stringify(calls[0].payload)),{trackId:CONTACT_TRACK,waitingKind:null,classId:null,retakeDecision:null});assert.equal(result.trackId,CONTACT_TRACK);assert.equal(result.classId,"");assert.equal(harness.rpcCalls.length,1);

});

test("level-test results use their dedicated data-only RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_level_test_result_v1");
      assert.deepEqual({ ...args }, {
        p_attempt_id: "attempt-1",
        p_status: "completed",
        p_material_link: "https://drive.test/result",
        p_request_key: "result-request",
      });
      return { data: { attemptId: "attempt-1", trackId: "track-1", status: "completed", materialLink: "https://drive.test/result" }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationLevelTestResult({
    attemptId: "attempt-1",
    status: "completed",
    materialLink: "https://drive.test/result",
    requestKey: "result-request",
  });

  assert.deepEqual({ ...result }, {
    attemptId: "attempt-1",
    trackId: "track-1",
    status: "completed",
    materialLink: "https://drive.test/result",
  });
});

test("consultation records use their dedicated data-only RPC", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const harness = createClient({
    rpcHandler(name, args) {
      assert.equal(name, "save_registration_consultation_details_v1");
      assert.deepEqual({ ...args }, {
        p_consultation_id: "consultation-1",
        p_status: "completed",
        p_outcome: "waiting",
        p_note: "보호자가 다음 학기 반을 요청함",
        p_request_key: "consultation-details-request",
      });
      return { data: { consultationId: "consultation-1", trackId: "track-1", status: "completed", outcome: "waiting", note: "보호자가 다음 학기 반을 요청함" }, error: null };
    },
  });
  const service = createRegistrationTrackService(harness.client, readyOptions());

  const result = await service.saveRegistrationConsultationDetails({
    consultationId: "consultation-1",
    status: "completed",
    outcome: "waiting",
    note: "보호자가 다음 학기 반을 요청함",
    requestKey: "consultation-details-request",
  });

  assert.deepEqual({ ...result }, {
    consultationId: "consultation-1",
    trackId: "track-1",
    status: "completed",
    outcome: "waiting",
    note: "보호자가 다음 학기 반을 요청함",
  });
});


test("enrollment detail save sends and hydrates every selected textbook, including explicit clearing", async () => {
  const { createRegistrationTrackService } = await loadFactory();
  const books = ["74000000-0000-4000-8000-000000000041", "74000000-0000-4000-8000-000000000042"];
  const harness = createClient({ rpcHandler(name, args) {
    assert.equal(name, "save_registration_enrollment_details_v1");
    return { data: { trackId: args.p_track_id, rows: args.p_rows }, error: null };
  } });
  const service = createRegistrationTrackService(harness.client, readyOptions());
  for (const selected of [books, []]) {
    const result = await service.saveRegistrationEnrollmentDetails({
      trackId: "74000000-0000-4000-8000-000000000030",
      rows: [{ classId: "74000000-0000-4000-8000-000000000010", textbookIds: selected }],
      requestKey: `textbooks-${selected.length}`,
    });
    assert.deepEqual(Array.from(harness.rpcCalls.at(-1)[1].p_rows[0].textbookIds), selected);
    assert.deepEqual(Array.from(result.rows[0].textbookIds), selected);
    assert.equal(result.rows[0].textbookId, selected[0] ?? null);
  }
  const legacy = await service.saveRegistrationEnrollmentDetails({
    trackId: "74000000-0000-4000-8000-000000000030",
    rows: [{ classId: "74000000-0000-4000-8000-000000000010", textbookId: books[0] }],
    requestKey: "legacy-textbook",
  });
  assert.deepEqual(Array.from(legacy.rows[0].textbookIds), [books[0]]);
});

test("fact audit mapper keeps the saved fact kind without copying private input values", async () => {
  const { mapTrackEvent } = await loadFactory();
  const result = mapTrackEvent({ id: "event-fact", task_id: "task", actor_id: "staff", event_type: "registration_fact_saved", created_at: "2026-10-04T14:00:00Z", after_value: JSON.stringify({ version: 1, factType: "waiting_details", trackId: "track", payload: { parentPhone: "PRIVATE_SYNTHETIC_PHONE", waitingKind: "current_class" } }) });
  assert.equal(result.eventType, "registration_fact_saved");
  assert.equal(result.trackId, "track");
  assert.equal(result.metadata.factType, "waiting_details");
  assert.equal(result.actorKind, "user");
  assert.ok(!JSON.stringify(result).includes("PRIVATE_SYNTHETIC_PHONE"));
});


test("real common v1/contact v2/subject envelopes retain row provenance through the timeline without private payloads", async () => {
  const { mapTrackEvent } = await loadFactory();
  const row = (id, type, time, payload, actor = "staff") => ({
    id, task_id: "task", actor_id: actor, event_type: type, created_at: time,
    before_value: "PRIVATE_BEFORE", after_value: JSON.stringify(payload),
  });
  const events = [
    row("common-v1", "registration_common_info_updated", "2026-10-04T14:00:00Z", {version: 1, commonRevision: 2, studentName: "PRIVATE_NAME", parentPhone: "PRIVATE_PHONE", requestNote: "PRIVATE_NOTE"}),
    row("common-v2", "registration_common_info_updated", "2026-10-04T14:02:00Z", {version: 2, commonRevision: 3, parentContactPresent: true, studentContactPresent: false, requestNotePresent: true, changedFields: ["parentContact", "requestNote"], occurredAt: "2026-10-04T14:02:00Z"}),
    row("subjects", "registration_subjects_synced", "2026-10-04T14:01:00Z", {version: 1, actorId: "staff", subjects: ["영어"], occurredAt: "2026-10-04T14:01:00Z"}),
    row("removed", "registration_subject_removed", "2026-10-04T14:03:00Z", {version: 1, trackId: "track", subject: "영어", actorId: "staff", directorProfileId: "PRIVATE_DIRECTOR", occurredAt: "2026-10-04T14:03:00Z"}),
    row("fact", "registration_fact_saved", "2026-10-04T13:00:00Z", {version: 1, factType: "waiting_details", trackId: "track", payload: {parentPhone: "PRIVATE_PHONE"}}),
    row("unknown", "registration_common_info_updated", null, {version: 1, requestNote: "PRIVATE_NOTE"}, null),
  ].map(mapTrackEvent);
  const history = buildRegistrationSubjectHistory({tracks: [{id: "track", subject: "영어"}], events});
  assert.deepEqual(history.map(item => item.id), ["event:removed", "event:common-v2", "event:subjects", "event:common-v1", "event:fact", "event:unknown"]);
  assert.deepEqual(history.slice(0, 5).map(item => [item.actorId, item.actorKind, item.timeKind]), Array.from({length: 5}, () => ["staff", "user", "exact"]));
  assert.equal(history[0].subjects[0], "영어");
  assert.equal(history[1].occurredAt, "2026-10-04T14:02:00Z");
  assert.equal(history.at(-1).actorKind, null);
  assert.equal(history.at(-1).timeKind, "unavailable");
  assert.doesNotMatch(JSON.stringify({events, history}), /PRIVATE_|parentPhone|requestNotePresent|changedFields/);
});
