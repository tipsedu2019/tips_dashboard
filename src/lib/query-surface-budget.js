import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import ts from "typescript"

export const QUERY_SURFACES = Object.freeze(["tasks", "management", "operations", "academic", "public"])
const BASELINE_SHA = "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101"
const BOUND_OPERATION_METHODS = new WeakMap()
const SCOPE_BINDINGS = new WeakMap()
const LEXICAL_BINDINGS = new WeakMap()
const UNKNOWN_LITERAL = Symbol("unknown literal")
const EXACT_SCALAR_RPC_NAMES = new Set([
  "get_ops_task_list_stats_v1",
  "get_management_stats_v1",
  "list_management_filter_options_v1",
  "get_management_detail_v1",
  "get_management_default_class_period_v1",
  "get_operations_calendar_range_v1",
  "get_operations_annual_board_v1",
  "get_academic_event_detail_v1",
  "get_class_schedule_v1",
  "get_operations_class_lesson_design_detail_v1",
  "list_operations_catalogs_v1",
  "list_active_science_subject_areas_v1",
  "get_academic_timetable_range_v1",
  "get_academic_curriculum_detail_v1",
  "current_dashboard_role",
  "close_class_atomic_v1",
])
const EXACT_CONTINUOUS_SCHEDULE_OPERATION_RPC_NAMES = new Set([
  "save_class_schedule_defaults_v1",
  "preview_class_lesson_session_generation_v1",
  "generate_class_lesson_sessions_v1",
  "save_class_lesson_session_v1",
  "save_class_lesson_content_v1",
])

// Pageable, not scalar: additions require final migration + pgTAP proof of a
// strict server-side allowlist, not a client promise or a clamped default.
// management: 20260831013310_management_numbered_pages.sql (final),
// management_numbered_pages_test.sql; local final-only proof 114/114.
const EXACT_NUMBERED_RPC_CONTRACTS = new Map([
  ["list_management_numbered_page_v1", { parameter: "p_page_size", sizes: [10, 15, 20] }],
])

const PUBLIC_CLASSES_SUMMARY_COMPATIBILITY_PROJECTION = "PUBLIC_CLASSES_SUMMARY_COMPATIBILITY_PROJECTION"
// The public API keeps four exact compatibility chains unpaged for unknown
// external consumers. This is not a pattern allowance: each chain is bound to
// its exact ordinal, source table, and projection.
const LEGACY_PUBLIC_UNPAGED_COMPATIBILITY_CHAINS = new Map([
  [0, {
    table: "classes",
    projection: "id,name,subject,grade,teacher,room,schedule,status,fee,capacity,student_ids,waitlist_ids,start_date,end_date",
    selector: PUBLIC_CLASSES_SUMMARY_COMPATIBILITY_PROJECTION,
  }],
  [1, {
    table: "classes",
    projection: "id,name,subject,grade,teacher,room,schedule,status,fee,tuition,capacity,student_ids,waitlist_ids,textbook_ids,textbook_info,lessons,schedule_plan,start_date,end_date",
  }],
  [2, {
    table: "textbooks",
    projection: "id,title,name,publisher,price,tags,lessons,updated_at",
  }],
  [3, {
    table: "progress_logs",
    projection: "id,class_id,textbook_id,progress_key,session_id,session_order,status,range_start,range_end,range_label,public_note,teacher_note,updated_at,date,completed_lesson_ids",
  }],
])

function isLegacyPublicFullCompatibilityQuery({ surface, file, symbol, query, constants }) {
  const expected = LEGACY_PUBLIC_UNPAGED_COMPATIBILITY_CHAINS.get(query.ordinal)
  const [fromOperation, projection] = query.operations
  const projectionArgument = projection?.arguments[0]
  const value = projectionArgument && argumentValue(projectionArgument, constants)
  const table = query.entry.arguments[0] && argumentValue(query.entry.arguments[0], constants)
  const entry = accessParts(query.entry)
  const projectionAccess = projection ? accessParts(projection) : null
  const hasExactLiteralChain = query.operations.length === 2
    && fromOperation === query.entry
    && callMethod(fromOperation) === "from"
    && callMethod(projection) === "select"
    && projectionAccess?.receiver === query.entry
    && rootIdentifier(entry?.receiver) === "supabase"
    && !hasOptionalChain(query.entry)
    && !hasOptionalChain(projection)
  const namedSummaryCompatibilityProjection = expected?.selector
    ? Boolean(projectionArgument && ts.isIdentifier(projectionArgument))
      && projectionArgument.text === expected.selector
    : true
  return surface === "public"
    && file === "src/server/public-classes-payload.js"
    && symbol === "buildPublicClassesPayload"
    && Boolean(expected)
    && hasExactLiteralChain
    && namedSummaryCompatibilityProjection
    && table === expected.table
    && value === expected.projection
}

function hasOptionalChain(expression) {
  let current = expression && unwrap(expression)
  while (current && (ts.isCallExpression(current) || ts.isPropertyAccessExpression(current)
    || ts.isElementAccessExpression(current))) {
    if (current.questionDotToken) return true
    current = unwrap(current.expression)
  }
  return false
}

// These are deliberately literal records, not path patterns. Each one binds a
// specific baseline query chain, so moving or duplicating legacy debt is a new
// violation rather than an interchangeable allowance.
const LEGACY_DEBT_OCCURRENCE_FINGERPRINTS = new Map([
  ["9c925ec82011b4d50c8761e57ec33f2c0fd13b8af7c9e20cabd22122c05b5cfd", "fd867d5885a2fb5e52d6653685ec9636acd2dc455ac8d6f3d45213ebd5fdebd4"],
  ["f634c3bdbd371fe0badf43b9b774dc13d73ecb9e4151061aeea6bd93f2e47510", "986dc220fa183ef8267853bb0a7b1db18451d9a038186887cd5bffdff37ea31b"],
  ["19a4d722ed35299a88bf06fb3164ebec2081d2ce16a53835c398624485ef48b1", "38fc4f6997e9edf0412ad389699ac36a13f1da1394f38710a68731beaf685e46"],
  ["ce8eacaf5a088c1bd6a02532bd8a974e8b87bb56ee6fa929abee23f550046ca9", "d82e248868a699b522c0b9bd5ea203aedd075ffe8d5bb3c9e2aaea0b40d132fb"],
  ["c298131d70d0b561467e5dcdfe3196f8be304ea1de9e8d2e91bbbd82f9019965", "86b739cb298a9b284e78223dd0e219aa6df29ecf1dda864bdfc6ab7c5e772564"],
  ["1d10c6da117bcc226bd4b3a2b1511de9dc10cf22fb8655b6c6a439934543485b", "f206f74d1417bb46d3b3b91d3024d2f954a90b18a008c12132f385e3c9a760f2"],
  ["d31238040cb5ecb0b1979fa01fe8a784c8377466de1a5a4bb41a273d4a0832f8", "86b739cb298a9b284e78223dd0e219aa6df29ecf1dda864bdfc6ab7c5e772564"],
  ["53187d67160e2b5f8abb237db5414df034bc01b78a8baf35611506a2c25a49da", "f206f74d1417bb46d3b3b91d3024d2f954a90b18a008c12132f385e3c9a760f2"],
  ["bb47c9d77c189079d6544f15850441de3880742fae7d5891c44cc04c01a278c4", "a587828d5e7c3b44d8ee0de1cf93262068e00ba41dd57a596dc7e73716a3defd"],
  ["1d6333930b09982ad59d086dae3e203f55e2577fa266904b7cc729acf5c2240c", "93e0e8939868c947ee0abce3c9ebe06088a898d3c0ce12eca8a8da5560a35d54"],
  ["2c96a45dbc1c66b7e71a5870ff26b2f5385c3937705c5ac6cc886b4f3c355401", "54fc7cbcda4808761a490471b9eb195658793268d8f8aee40b3abd7abdf1b6ad"],
  ["eb75288993a7bbd901544dd155cdc276764ab97a28b7d75622d069ebdaadb2d7", "f4361f26cb7a2e6fa1b14123d2decd850b6d0c0da610cffb97ab8a80d0dbf2e5"],
  ["9ec60a4049e9d6defd81e44652e6d11f70d14aff2e41b13a22e023346618802d", "f19f1c18babb1667f17c5ab1f14e33073033c07f9b52c7c0e45896b509e8c942"],
  ["91089c83905a97981897078f1f116d88f17314217f4a04d1958b91c83ff2cb58", "a2f9f135cdd93ddd4775e7ffb03c4398570ed5c7130dcd269c12af0b361b5279"],
  ["7ad267651103e94ecda0049485e915e7c577351c85c5693bc4d87c4e6c17cbbb", "3d83353476698d6cb9d3ad0a3d4d9c99ca2e298e303d88c361d103d74ae9fa96"],
  ["65280cf9e7670073ed6c2af811fba866f2a819a0e814dc736bc30e85325a9f76", "33c82b5cbd6e5d3bc5732017d865c8b029b963bf7041f55ef2e193799dc49ff1"],
  ["8eb0d3f8f2d72a47ab438bb9f74a837ca9a23162cc611b6b2d02f5150b2c5790", "2a87e41d8f3896856c8fdee3d70686782a7afa6dc53dd20445474d5c31986f2d"],
  ["193816049298234fe788de7b9aec7bbab89eebaab8aadb18da74705673611b94", "8b0649f89bb7509b01a63d50f4b7aaabf25e64c055ed63167f13bd5ec4b784da"],
  ["bddeb9462f15759b516eed0505dfbb8961248ba29c8cdb16189d6738ab15142d", "19a9a424c68d4620afc1e744ecdf72eb9a09916406794029391231b0e1e56940"],
  ["c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df", "0263adc403612292e9a84677bb4ccd39a2ba6966be101e159249c12dff1affcb"],
  ["1776d0c6146161aec132299b221e8c18bf4b2b5714a4d0d3aff6e04204c211e1", "e82a8c79ae28ca0e4099925679573fdeef7cddea213a0b1612dff3833e101594"],
  ["83591208210d5c3ac8ea9cbc99055719321c9c77dcf228be70b638650f725cb5", "caf068dd72647f9b00a8d47baa1c5e7f6098bdbd79512b7ed86282b7a104ef23"],
])

function legacyDebt(surface, file, symbol, violation, fingerprint) {
  const occurrenceFingerprint = LEGACY_DEBT_OCCURRENCE_FINGERPRINTS.get(fingerprint)
  if (!occurrenceFingerprint) throw new Error("legacy_query_debt_occurrence_missing")
  return Object.freeze({ surface, file, symbol, violation, baselineSha: BASELINE_SHA, fingerprint, occurrenceFingerprint })
}

export const QUERY_SURFACE_DEBT_MANIFEST = Object.freeze([
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "task_id_batch_in_list", "9c925ec82011b4d50c8761e57ec33f2c0fd13b8af7c9e20cabd22122c05b5cfd"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_abort_signal_missing", "9c925ec82011b4d50c8761e57ec33f2c0fd13b8af7c9e20cabd22122c05b5cfd"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_limit_missing", "9c925ec82011b4d50c8761e57ec33f2c0fd13b8af7c9e20cabd22122c05b5cfd"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_projection_unresolved", "9c925ec82011b4d50c8761e57ec33f2c0fd13b8af7c9e20cabd22122c05b5cfd"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readTaskScopedTable", "list_retry_false_missing", "9c925ec82011b4d50c8761e57ec33f2c0fd13b8af7c9e20cabd22122c05b5cfd"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_select_star", "f634c3bdbd371fe0badf43b9b774dc13d73ecb9e4151061aeea6bd93f2e47510"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_abort_signal_missing", "f634c3bdbd371fe0badf43b9b774dc13d73ecb9e4151061aeea6bd93f2e47510"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_limit_missing", "f634c3bdbd371fe0badf43b9b774dc13d73ecb9e4151061aeea6bd93f2e47510"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "readOpsTaskWorkspaceData", "list_retry_false_missing", "f634c3bdbd371fe0badf43b9b774dc13d73ecb9e4151061aeea6bd93f2e47510"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "applyReadyOpsRosterMode", "rpc_page_limit_missing", "19a4d722ed35299a88bf06fb3164ebec2081d2ce16a53835c398624485ef48b1"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "applyReadyOpsRosterMode", "list_abort_signal_missing", "19a4d722ed35299a88bf06fb3164ebec2081d2ce16a53835c398624485ef48b1"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "applyReadyOpsRosterMode", "list_retry_false_missing", "19a4d722ed35299a88bf06fb3164ebec2081d2ce16a53835c398624485ef48b1"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "completeReadyOpsRosterTransition", "rpc_page_limit_missing", "ce8eacaf5a088c1bd6a02532bd8a974e8b87bb56ee6fa929abee23f550046ca9"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "completeReadyOpsRosterTransition", "list_abort_signal_missing", "ce8eacaf5a088c1bd6a02532bd8a974e8b87bb56ee6fa929abee23f550046ca9"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "completeReadyOpsRosterTransition", "list_retry_false_missing", "ce8eacaf5a088c1bd6a02532bd8a974e8b87bb56ee6fa929abee23f550046ca9"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_limit_missing", "c298131d70d0b561467e5dcdfe3196f8be304ea1de9e8d2e91bbbd82f9019965"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_order_missing", "c298131d70d0b561467e5dcdfe3196f8be304ea1de9e8d2e91bbbd82f9019965"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_abort_signal_missing", "c298131d70d0b561467e5dcdfe3196f8be304ea1de9e8d2e91bbbd82f9019965"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_retry_false_missing", "c298131d70d0b561467e5dcdfe3196f8be304ea1de9e8d2e91bbbd82f9019965"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_limit_missing", "1d10c6da117bcc226bd4b3a2b1511de9dc10cf22fb8655b6c6a439934543485b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_order_missing", "1d10c6da117bcc226bd4b3a2b1511de9dc10cf22fb8655b6c6a439934543485b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_abort_signal_missing", "1d10c6da117bcc226bd4b3a2b1511de9dc10cf22fb8655b6c6a439934543485b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToClass", "list_retry_false_missing", "1d10c6da117bcc226bd4b3a2b1511de9dc10cf22fb8655b6c6a439934543485b"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_limit_missing", "d31238040cb5ecb0b1979fa01fe8a784c8377466de1a5a4bb41a273d4a0832f8"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_order_missing", "d31238040cb5ecb0b1979fa01fe8a784c8377466de1a5a4bb41a273d4a0832f8"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_abort_signal_missing", "d31238040cb5ecb0b1979fa01fe8a784c8377466de1a5a4bb41a273d4a0832f8"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_retry_false_missing", "d31238040cb5ecb0b1979fa01fe8a784c8377466de1a5a4bb41a273d4a0832f8"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_limit_missing", "53187d67160e2b5f8abb237db5414df034bc01b78a8baf35611506a2c25a49da"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_order_missing", "53187d67160e2b5f8abb237db5414df034bc01b78a8baf35611506a2c25a49da"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_abort_signal_missing", "53187d67160e2b5f8abb237db5414df034bc01b78a8baf35611506a2c25a49da"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsStudentToWaitlist", "list_retry_false_missing", "53187d67160e2b5f8abb237db5414df034bc01b78a8baf35611506a2c25a49da"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsTextbookToClass", "list_limit_missing", "bb47c9d77c189079d6544f15850441de3880742fae7d5891c44cc04c01a278c4"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsTextbookToClass", "list_order_missing", "bb47c9d77c189079d6544f15850441de3880742fae7d5891c44cc04c01a278c4"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsTextbookToClass", "list_abort_signal_missing", "bb47c9d77c189079d6544f15850441de3880742fae7d5891c44cc04c01a278c4"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "assignOpsTextbookToClass", "list_retry_false_missing", "bb47c9d77c189079d6544f15850441de3880742fae7d5891c44cc04c01a278c4"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_limit_missing", "1d6333930b09982ad59d086dae3e203f55e2577fa266904b7cc729acf5c2240c"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_order_missing", "1d6333930b09982ad59d086dae3e203f55e2577fa266904b7cc729acf5c2240c"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_abort_signal_missing", "1d6333930b09982ad59d086dae3e203f55e2577fa266904b7cc729acf5c2240c"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_retry_false_missing", "1d6333930b09982ad59d086dae3e203f55e2577fa266904b7cc729acf5c2240c"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_limit_missing", "2c96a45dbc1c66b7e71a5870ff26b2f5385c3937705c5ac6cc886b4f3c355401"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_order_missing", "2c96a45dbc1c66b7e71a5870ff26b2f5385c3937705c5ac6cc886b4f3c355401"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_abort_signal_missing", "2c96a45dbc1c66b7e71a5870ff26b2f5385c3937705c5ac6cc886b4f3c355401"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "removeOpsStudentFromClass", "list_retry_false_missing", "2c96a45dbc1c66b7e71a5870ff26b2f5385c3937705c5ac6cc886b4f3c355401"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "updateOpsTaskStatus", "list_limit_missing", "eb75288993a7bbd901544dd155cdc276764ab97a28b7d75622d069ebdaadb2d7"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "updateOpsTaskStatus", "list_order_missing", "eb75288993a7bbd901544dd155cdc276764ab97a28b7d75622d069ebdaadb2d7"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "updateOpsTaskStatus", "list_abort_signal_missing", "eb75288993a7bbd901544dd155cdc276764ab97a28b7d75622d069ebdaadb2d7"),
  legacyDebt("tasks", "src/features/tasks/ops-task-service.ts", "updateOpsTaskStatus", "list_retry_false_missing", "eb75288993a7bbd901544dd155cdc276764ab97a28b7d75622d069ebdaadb2d7"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_projection_unresolved", "c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_detail_predicate_missing", "c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_limit_missing", "c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_order_missing", "c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_abort_signal_missing", "c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_retry_false_missing", "c4a7a26ac9c9cc3c6412f631435d94e5516ccdd96ef19188a52893c1e092c4df"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_projection_unresolved", "1776d0c6146161aec132299b221e8c18bf4b2b5714a4d0d3aff6e04204c211e1"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_limit_missing", "1776d0c6146161aec132299b221e8c18bf4b2b5714a4d0d3aff6e04204c211e1"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_order_missing", "1776d0c6146161aec132299b221e8c18bf4b2b5714a4d0d3aff6e04204c211e1"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_abort_signal_missing", "1776d0c6146161aec132299b221e8c18bf4b2b5714a4d0d3aff6e04204c211e1"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_retry_false_missing", "1776d0c6146161aec132299b221e8c18bf4b2b5714a4d0d3aff6e04204c211e1"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_projection_unresolved", "83591208210d5c3ac8ea9cbc99055719321c9c77dcf228be70b638650f725cb5"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_order_missing", "83591208210d5c3ac8ea9cbc99055719321c9c77dcf228be70b638650f725cb5"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_abort_signal_missing", "83591208210d5c3ac8ea9cbc99055719321c9c77dcf228be70b638650f725cb5"),
  legacyDebt("tasks", "src/features/tasks/registration-track-service.ts", "loadCaseDetail", "list_retry_false_missing", "83591208210d5c3ac8ea9cbc99055719321c9c77dcf228be70b638650f725cb5"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_select_star", "9ec60a4049e9d6defd81e44652e6d11f70d14aff2e41b13a22e023346618802d"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_abort_signal_missing", "9ec60a4049e9d6defd81e44652e6d11f70d14aff2e41b13a22e023346618802d"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_limit_missing", "9ec60a4049e9d6defd81e44652e6d11f70d14aff2e41b13a22e023346618802d"),
  legacyDebt("management", "src/features/management/management-service.js", "selectRows", "list_retry_false_missing", "9ec60a4049e9d6defd81e44652e6d11f70d14aff2e41b13a22e023346618802d"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_select_star", "91089c83905a97981897078f1f116d88f17314217f4a04d1958b91c83ff2cb58"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_abort_signal_missing", "91089c83905a97981897078f1f116d88f17314217f4a04d1958b91c83ff2cb58"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_limit_missing", "91089c83905a97981897078f1f116d88f17314217f4a04d1958b91c83ff2cb58"),
  legacyDebt("management", "src/features/management/use-management-records.ts", "useManagementRecords", "list_retry_false_missing", "91089c83905a97981897078f1f116d88f17314217f4a04d1958b91c83ff2cb58"),
  legacyDebt("operations", "src/features/operations/use-operations-workspace-data.ts", "readTable", "list_select_star", "7ad267651103e94ecda0049485e915e7c577351c85c5693bc4d87c4e6c17cbbb"),
  legacyDebt("operations", "src/features/operations/use-operations-workspace-data.ts", "readTable", "list_limit_missing", "7ad267651103e94ecda0049485e915e7c577351c85c5693bc4d87c4e6c17cbbb"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_select_star", "65280cf9e7670073ed6c2af811fba866f2a819a0e814dc736bc30e85325a9f76"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_select_star", "8eb0d3f8f2d72a47ab438bb9f74a837ca9a23162cc611b6b2d02f5150b2c5790"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_select_star", "193816049298234fe788de7b9aec7bbab89eebaab8aadb18da74705673611b94"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "bddeb9462f15759b516eed0505dfbb8961248ba29c8cdb16189d6738ab15142d"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "65280cf9e7670073ed6c2af811fba866f2a819a0e814dc736bc30e85325a9f76"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "8eb0d3f8f2d72a47ab438bb9f74a837ca9a23162cc611b6b2d02f5150b2c5790"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_abort_signal_missing", "193816049298234fe788de7b9aec7bbab89eebaab8aadb18da74705673611b94"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "bddeb9462f15759b516eed0505dfbb8961248ba29c8cdb16189d6738ab15142d"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "65280cf9e7670073ed6c2af811fba866f2a819a0e814dc736bc30e85325a9f76"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "8eb0d3f8f2d72a47ab438bb9f74a837ca9a23162cc611b6b2d02f5150b2c5790"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_limit_missing", "193816049298234fe788de7b9aec7bbab89eebaab8aadb18da74705673611b94"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "bddeb9462f15759b516eed0505dfbb8961248ba29c8cdb16189d6738ab15142d"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "65280cf9e7670073ed6c2af811fba866f2a819a0e814dc736bc30e85325a9f76"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "8eb0d3f8f2d72a47ab438bb9f74a837ca9a23162cc611b6b2d02f5150b2c5790"),
  legacyDebt("public", "src/server/public-classes-payload.js", "buildPublicClassesPayload", "list_retry_false_missing", "193816049298234fe788de7b9aec7bbab89eebaab8aadb18da74705673611b94"),
])

const SURFACE_PREFIXES = Object.freeze({
  tasks: ["src/features/tasks/"],
  management: ["src/features/management/"],
  operations: ["src/features/operations/"],
  academic: ["src/features/academic/"],
  public: ["src/server/public-", "src/app/api/public-classes/", "src/app/classes/"],
})

function queryBudgetError(code) {
  const error = new Error(code)
  error.code = code
  return error
}

function git(root, args) {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  } catch (error) {
    throw queryBudgetError(`query_surface_git_${String(error?.status ?? "failed")}`)
  }
}

function assertSurface(surface) {
  if (surface !== "all" && !QUERY_SURFACES.includes(surface)) throw queryBudgetError("query_surface_unknown")
}

function selectedSurfaces(surface) {
  return surface === "all" ? QUERY_SURFACES : [surface]
}

function isSurfacePath(surface, file) {
  return SURFACE_PREFIXES[surface].some((prefix) => file.startsWith(prefix))
}

function scriptKind(file) {
  if (file.endsWith(".tsx")) return ts.ScriptKind.TSX
  if (file.endsWith(".js")) return ts.ScriptKind.JS
  return ts.ScriptKind.TS
}

function unwrap(expression) {
  let value = expression
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value)
    || ts.isNonNullExpression(value) || ts.isAwaitExpression(value)) value = value.expression
  return value
}

function functionSymbol(node) {
  if (ts.isFunctionDeclaration(node) && node.name) return node.name.text
  if ((ts.isArrowFunction(node) || ts.isFunctionExpression(node)) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name)) return node.parent.name.text
  let current = node.parent
  while (current) {
    if (ts.isFunctionDeclaration(current) && current.name) return current.name.text
    if ((ts.isArrowFunction(current) || ts.isFunctionExpression(current)) && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name)) return current.parent.name.text
    current = current.parent
  }
  return "module"
}

function accessParts(call) {
  const expression = call.expression
  if (ts.isPropertyAccessExpression(expression)) return { receiver: unwrap(expression.expression), method: expression.name.text }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression && unwrap(expression.argumentExpression)
    return {
      receiver: unwrap(expression.expression),
      method: argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument)) ? argument.text : null,
      computed: true,
    }
  }
  return null
}

function primitiveConstants(node, use) {
  const values = new Map()
  const declarations = []
  const visit = (child) => {
    if (child !== node && ts.isFunctionLike(child)) return
    if (ts.isVariableDeclaration(child) && ts.isIdentifier(child.name) && child.initializer) declarations.push(child)
    ts.forEachChild(child, visit)
  }
  ts.forEachChild(node, visit)
  for (const declaration of declarations) {
    if (!isImmutableConst(declaration) || !isVisibleBindingAt(declaration, use, node)
      || hasLaterWrite(node, declaration)) continue
    const value = unwrap(declaration.initializer)
    if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) values.set(declaration.name.text, value.text)
    else if (ts.isNumericLiteral(value)) values.set(declaration.name.text, Number(value.text))
  }
  return values
}

function isImmutableConst(declaration) {
  return ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const) !== 0
}

function hasLaterWrite(scope, declaration) {
  const name = declaration.name.text
  let written = false
  const visit = (node) => {
    if (written || (node !== scope && ts.isFunctionLike(node))) return
    if (node.pos >= declaration.end && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && isWriteTarget(node.left, name) && nearestDeclaration(scope, name, node.left) === declaration) written = true
    if (node.pos >= declaration.end && (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && isWriteTarget(node.operand, name) && nearestDeclaration(scope, name, node.operand) === declaration) written = true
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  return written
}

function nearestDeclaration(scope, name, use) {
  let nearest = null
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name
      && isVisibleBindingAt(node, use, scope) && (!nearest || node.pos > nearest.pos)) nearest = node
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  return nearest
}

function isWriteTarget(target, name) {
  const value = unwrap(target)
  if (ts.isIdentifier(value)) return value.text === name
  if (ts.isPropertyAccessExpression(value) || ts.isElementAccessExpression(value)) return rootIdentifier(value.expression) === name
  return false
}

function bindingDeclarationNode(declaration) {
  if (ts.isVariableDeclaration(declaration) || ts.isParameter(declaration)) return declaration
  let node = declaration
  while (ts.isIdentifier(node) || ts.isBindingElement(node)
    || ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) {
    node = node.parent
    if (ts.isVariableDeclaration(node) || ts.isParameter(node)) return node
  }
  return declaration
}

function isFunctionScopedBinding(declaration) {
  const node = bindingDeclarationNode(declaration)
  return ts.isParameter(node) || (ts.isVariableDeclaration(node) && ts.isVariableDeclarationList(node.parent)
    && (node.parent.flags & (ts.NodeFlags.Let | ts.NodeFlags.Const)) === 0)
}

function isVisibleBindingAt(declaration, use, scope) {
  const binding = bindingDeclarationNode(declaration)
  const functionScoped = isFunctionScopedBinding(declaration)
  if (!use || (!functionScoped && binding.pos >= use.pos)) return false
  for (let parent = binding.parent; parent && parent !== scope; parent = parent.parent) {
    if (!functionScoped && (ts.isBlock(parent) || ts.isCatchClause(parent))
      && !(parent.pos <= use.pos && use.end <= parent.end)) return false
  }
  return true
}

function immutableConstInitializers(scope, use) {
  const bindings = new Map()
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer
      && isImmutableConst(node) && isVisibleBindingAt(node, use, scope) && !hasLaterWrite(scope, node)) bindings.set(node.name.text, node.initializer)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  return bindings
}

function argumentValue(argument, constants) {
  const value = unwrap(argument)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) return -Number(value.operand.text)
  if (ts.isIdentifier(value)) return constants.get(value.text)
  return undefined
}

function rootIdentifier(expression) {
  const value = unwrap(expression)
  return ts.isIdentifier(value) ? value.text : null
}

function bindingAlias(map, expression, scope, use = expression) {
  const value = unwrap(expression)
  if (!ts.isIdentifier(value)) return null
  return map.get(nearestBindingIdentifier(scope, value.text, use) ?? `unbound:${value.text}`) ?? null
}

function isTrustedReceiver(expression, aliases, scope, use = expression) {
  const identifier = rootIdentifier(expression)
  if (identifier === "Array") return false
  if (identifier && bindingAlias(aliases, unwrap(expression), scope, use)) return true
  return null
}

function receiverOrigin(expression, aliases, scope, use = expression) {
  return bindingAlias(aliases, unwrap(expression), scope, use)
}

function sameTrustedReceiver(left, right, aliases, scope, use = left) {
  const leftReceiver = receiverOrigin(left, aliases, scope, use)
  const rightReceiver = receiverOrigin(right, aliases, scope, use)
  return Boolean(leftReceiver && rightReceiver && !leftReceiver.unresolved && !rightReceiver.unresolved
    && leftReceiver.origin === rightReceiver.origin)
}

function sameReceiverOrigin(receiver, expression, aliases, scope, use = expression) {
  const other = receiverOrigin(expression, aliases, scope, use)
  return Boolean(receiver && other && !receiver.unresolved && !other.unresolved && receiver.origin === other.origin)
}

function outerQueryCall(call) {
  let current = call
  while (current.parent && ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current
    && current.parent.parent && ts.isCallExpression(current.parent.parent)) current = current.parent.parent
  return current
}

function assignmentName(call) {
  let current = outerQueryCall(call)
  while (current.parent && (ts.isAwaitExpression(current.parent) || ts.isParenthesizedExpression(current.parent)
    || ts.isAsExpression(current.parent) || ts.isNonNullExpression(current.parent))) current = current.parent
  if (ts.isVariableDeclaration(current.parent) && current.parent.initializer === current && ts.isIdentifier(current.parent.name)) return current.parent.name.text
  if (ts.isBinaryExpression(current.parent) && current.parent.right === current && current.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken
    && ts.isIdentifier(current.parent.left)) return current.parent.left.text
  return null
}

function queryOperations(call) {
  const operations = []
  let current = call
  while (true) {
    operations.push(current)
    const next = current.parent && ts.isPropertyAccessExpression(current.parent) && current.parent.expression === current
      && current.parent.parent && ts.isCallExpression(current.parent.parent) ? current.parent.parent : null
    if (!next) return operations
    current = next
  }
}

function callMethod(call) {
  return call ? accessParts(call)?.method ?? BOUND_OPERATION_METHODS.get(call) ?? null : null
}

function aliasProvenanceAssignments(scope) {
  const assignments = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && node.initializer
      && (ts.isIdentifier(node.name) || ts.isObjectBindingPattern(node.name))) {
      assignments.push({ target: node.name, initializer: node.initializer, node, pos: node.end })
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
      const target = unwrap(node.left)
      if (ts.isIdentifier(target) || ts.isObjectLiteralExpression(target)) {
        assignments.push({ target, initializer: node.right, node, pos: node.end })
      }
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  return assignments.sort((left, right) => left.pos - right.pos)
}

function computedPropertyText(name) {
  if (name && ts.isComputedPropertyName(name)) {
    const property = unwrap(name.expression)
    return property && (ts.isStringLiteral(property) || ts.isNoSubstitutionTemplateLiteral(property)) ? property.text : null
  }
  return name && (ts.isIdentifier(name) || ts.isStringLiteral(name)
    || ts.isNoSubstitutionTemplateLiteral(name)) ? name.text : null
}

function destructuredAliasTargets(target) {
  if (ts.isObjectBindingPattern(target)) {
    return target.elements.flatMap((element) => {
      if (!ts.isIdentifier(element.name)) return []
      return [{
        name: element.name.text,
        identifier: element.name,
        property: element.propertyName ? computedPropertyText(element.propertyName) : element.name.text,
        computed: Boolean(element.propertyName && ts.isComputedPropertyName(element.propertyName)),
      }]
    })
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return [{ name: property.name.text, identifier: property.name, property: property.name.text, computed: false }]
      }
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(unwrap(property.initializer))) return []
      return [{
        name: unwrap(property.initializer).text,
        identifier: unwrap(property.initializer),
        property: computedPropertyText(property.name),
        computed: ts.isComputedPropertyName(property.name),
      }]
    })
  }
  return []
}

function methodTarget(expression) {
  const target = ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression) ? expression : null
  if (!target) return null
  return {
    method: ts.isPropertyAccessExpression(target)
      ? target.name.text
      : (target.argumentExpression && (ts.isStringLiteral(unwrap(target.argumentExpression))
        || ts.isNoSubstitutionTemplateLiteral(unwrap(target.argumentExpression)))
          ? unwrap(target.argumentExpression).text
          : null),
    receiver: unwrap(target.expression),
    computed: ts.isElementAccessExpression(target),
  }
}

function queryFunctionMethod(expression, aliases, scope, use = expression) {
  const invocation = methodTarget(expression)
  if (!invocation || !["call", "apply"].includes(invocation.method)) return null
  const target = methodTarget(invocation.receiver)
  if (!target || (!target.computed && !["from", "rpc"].includes(target.method))
    || (target.method !== null && !["from", "rpc"].includes(target.method))
    || !isTrustedReceiver(target.receiver, aliases, scope, use)) return null
  return {
    invocation: invocation.method,
    method: target.method,
    receiver: receiverOrigin(target.receiver, aliases, scope, use),
  }
}

function functionPrototypeInvocation(expression) {
  const invocation = methodTarget(expression)
  if (!invocation || !["call", "apply"].includes(invocation.method)) return null
  const prototype = methodTarget(invocation.receiver)
  return prototype?.method === "prototype" && rootIdentifier(prototype.receiver) === "Function"
    ? invocation.method
    : null
}

function sameQueryMethodReference(expression, descriptor, aliases, scope, use = expression) {
  const target = methodTarget(unwrap(expression))
  return Boolean(target && target.method === descriptor.method
    && sameReceiverOrigin(descriptor.receiver, target.receiver, aliases, scope, use))
}

function sameMethodAlias(left, right) {
  const leftArguments = left?.entryArgumentKeys ?? []
  const rightArguments = right?.entryArgumentKeys ?? []
  return Boolean(left && right && left.method === right.method && left.receiver?.origin === right.receiver?.origin
    && Boolean(left.receiver?.unresolved) === Boolean(right.receiver?.unresolved)
    && left.invocation === right.invocation && left.bound === right.bound && left.unresolved === right.unresolved
    && leftArguments.length === rightArguments.length
    && leftArguments.every((value, index) => value !== null && value === rightArguments[index]))
}

function mergeAliasBranches(left, right, equal, unresolved) {
  if (!left && !right) return null
  if (left && right && equal(left, right)) return left
  return unresolved(left ?? right)
}

function resolveConditionalAlias(expression, resolve, equal, unresolved) {
  const value = unwrap(expression)
  if (!ts.isConditionalExpression(value)) return resolve(value)
  return mergeAliasBranches(
    resolveConditionalAlias(value.whenTrue, resolve, equal, unresolved),
    resolveConditionalAlias(value.whenFalse, resolve, equal, unresolved),
    equal,
    unresolved,
  )
}

function unresolvedMethodAlias(candidate) {
  return {
    ...candidate,
    receiver: { origin: null, unresolved: true },
    unresolved: true,
  }
}

function bindingIdentifiers(name) {
  if (ts.isIdentifier(name)) return [name]
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap((element) => ts.isBindingElement(element) ? bindingIdentifiers(element.name) : [])
  }
  return []
}

function scopeBindings(scope) {
  const cached = SCOPE_BINDINGS.get(scope)
  if (cached) return cached
  const bindings = new Map()
  const add = (identifier) => {
    const candidates = bindings.get(identifier.text) ?? []
    candidates.push(identifier)
    bindings.set(identifier.text, candidates)
  }
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node)) bindingIdentifiers(node.name).forEach(add)
    if (ts.isParameter(node)) bindingIdentifiers(node.name).forEach(add)
    if (ts.isCatchClause(node) && node.variableDeclaration) bindingIdentifiers(node.variableDeclaration.name).forEach(add)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  SCOPE_BINDINGS.set(scope, bindings)
  return bindings
}

function nearestBindingIdentifier(scope, name, use) {
  let nearest = null
  for (const identifier of scopeBindings(scope).get(name) ?? []) {
    if (isVisibleBindingAt(identifier, use, scope) && (!nearest || identifier.pos > nearest.pos)) nearest = identifier
  }
  if (!nearest || !isFunctionScopedBinding(nearest)) return nearest
  return (scopeBindings(scope).get(name) ?? []).find(isFunctionScopedBinding) ?? nearest
}

function assignmentBindingKey(assignment, target, scope) {
  return ts.isVariableDeclaration(assignment.node)
    ? (isFunctionScopedBinding(target)
        ? (scopeBindings(scope).get(target.text) ?? []).find(isFunctionScopedBinding) ?? target
        : target)
    : nearestBindingIdentifier(scope, target.text, target) ?? `unbound:${target.text}`
}

function boundArgumentKey(argument, scope, use) {
  const value = argumentValue(argument, primitiveConstants(scope, use))
  return value === undefined ? null : `${typeof value}:${JSON.stringify(value)}`
}

function assignOrderedAlias(map, name, next, conditional) {
  if (!conditional) {
    if (next) map.set(name, next)
    else map.delete(name)
    return
  }
  const previous = map.get(name)
  if (!previous && !next) return
  if (sameMethodAlias(previous, next)) return
  const candidate = next ?? previous
  map.set(name, {
    ...candidate,
    receiver: { origin: null, unresolved: true },
    unresolved: true,
  })
}

function assignReceiverAlias(aliases, key, next, conditional, trustedName = false) {
  if (!conditional) {
    if (next) aliases.set(key, next)
    else if (trustedName) aliases.set(key, { origin: null, unresolved: true })
    else aliases.delete(key)
    return
  }
  const previous = aliases.get(key)
  if (!previous && !next) return
  if (previous && next && previous.origin === next.origin && previous.unresolved === next.unresolved) return
  aliases.set(key, { origin: null, unresolved: true })
}

function aliasProvenanceAt(assignments, use, scope) {
  const aliases = new Map([
    ["unbound:client", { origin: "client", unresolved: false }],
    ["unbound:supabase", { origin: "supabase", unresolved: false }],
    ["unbound:db", { origin: "db", unresolved: false }],
  ])
  for (const name of ["client", "supabase", "db"]) {
    for (const identifier of scopeBindings(scope).get(name) ?? []) {
      if (ts.isParameter(identifier.parent)) aliases.set(identifier, { origin: name, unresolved: false })
    }
  }
  const boundMethods = new Map()
  const detachedMethods = new Map()
  const applyAliases = new Map()
  const invocationMethods = new Map()
  const prototypeInvocations = new Map()
  for (const assignment of assignments) {
    if (assignment.pos > use.pos) break
    const initializer = unwrap(assignment.initializer)
    const conditional = isConditionalExecution(assignment.node, scope)
    const destructured = destructuredAliasTargets(assignment.target)
    if (destructured.length > 0) {
      const receiver = receiverOrigin(initializer, aliases, scope, assignment.node)
      for (const target of destructured) {
        const key = assignmentBindingKey(assignment, target.identifier, scope)
        const detached = receiver && (["from", "rpc"].includes(target.property) || (target.computed && target.property === null))
          ? { method: target.property, receiver }
          : null
        assignOrderedAlias(detachedMethods, key, detached, conditional)
        assignOrderedAlias(boundMethods, key, null, conditional)
        assignOrderedAlias(applyAliases, key, null, conditional)
        assignOrderedAlias(invocationMethods, key, null, conditional)
        assignOrderedAlias(prototypeInvocations, key, null, conditional)
      }
      continue
    }
    if (!ts.isIdentifier(assignment.target)) continue
    const name = assignment.target.text
    const key = assignmentBindingKey(assignment, assignment.target, scope)
    const resolveReceiver = (value) => ts.isIdentifier(value)
      ? bindingAlias(aliases, value, scope, assignment.node)
      : null
    const copiedReceiver = resolveConditionalAlias(initializer, resolveReceiver,
      (left, right) => left.origin === right.origin && left.unresolved === right.unresolved,
      () => ({ origin: null, unresolved: true }))
    assignReceiverAlias(aliases, key, copiedReceiver, conditional, ["client", "supabase", "db"].includes(name))

    const resolveBound = (value) => {
      const bindAccess = ts.isCallExpression(value) && callMethod(value) === "bind" ? accessParts(value) : null
      const bindTarget = bindAccess ? methodTarget(bindAccess.receiver) : null
      if (bindTarget && (["from", "rpc"].includes(bindTarget.method) || (bindTarget.computed && bindTarget.method === null))
        && isTrustedReceiver(bindTarget.receiver, aliases, scope, assignment.node)) {
        return {
          method: bindTarget.method,
          receiver: sameTrustedReceiver(bindTarget.receiver, value.arguments[0], aliases, scope, assignment.node)
            ? receiverOrigin(bindTarget.receiver, aliases, scope, assignment.node)
            : { origin: null, unresolved: true },
          entryArguments: [...value.arguments].slice(1),
          entryArgumentKeys: [...value.arguments].slice(1).map((argument) => boundArgumentKey(argument, scope, assignment.node)),
        }
      }
      return ts.isIdentifier(value) ? bindingAlias(boundMethods, value, scope, assignment.node) : null
    }
    const bound = resolveConditionalAlias(initializer, resolveBound, sameMethodAlias, unresolvedMethodAlias)
    assignOrderedAlias(boundMethods, key, bound, conditional)

    const resolveDetached = (value) => {
      const target = methodTarget(value)
      if (target && (["from", "rpc"].includes(target.method) || (target.computed && target.method === null))
        && isTrustedReceiver(target.receiver, aliases, scope, assignment.node)) {
        return { method: target.method, receiver: receiverOrigin(target.receiver, aliases, scope, assignment.node) }
      }
      return ts.isIdentifier(value) ? bindingAlias(detachedMethods, value, scope, assignment.node) : null
    }
    const detached = resolveConditionalAlias(initializer, resolveDetached, sameMethodAlias, unresolvedMethodAlias)
    assignOrderedAlias(detachedMethods, key, detached, conditional)

    const resolvePrototypeInvocation = (value) => {
      const invocation = functionPrototypeInvocation(value)
      if (invocation) return { invocation, unresolved: false }
      return ts.isIdentifier(value) ? bindingAlias(prototypeInvocations, value, scope, assignment.node) : null
    }
    const prototypeAlias = resolveConditionalAlias(initializer, resolvePrototypeInvocation,
      (left, right) => left.invocation === right.invocation && left.unresolved === right.unresolved,
      (candidate) => ({ ...candidate, unresolved: true }))
    assignOrderedAlias(prototypeInvocations, key, prototypeAlias, conditional)

    const resolveInvocation = (value) => {
      const directInvocation = queryFunctionMethod(value, aliases, scope, assignment.node)
      if (directInvocation) return { ...directInvocation, bound: false }
      const bindAccess = ts.isCallExpression(value) && callMethod(value) === "bind" ? accessParts(value) : null
      const boundInvocation = bindAccess && queryFunctionMethod(bindAccess.receiver, aliases, scope, assignment.node)
      if (boundInvocation && sameQueryMethodReference(value.arguments[0], boundInvocation, aliases, scope, assignment.node)) {
        return { ...boundInvocation, bound: true }
      }
      const prototypeInvocation = bindAccess && (functionPrototypeInvocation(bindAccess.receiver)
        ?? (ts.isIdentifier(bindAccess.receiver)
          ? bindingAlias(prototypeInvocations, bindAccess.receiver, scope, assignment.node)?.invocation
          : null))
      const prototypeDescriptor = bindAccess && ts.isIdentifier(bindAccess.receiver)
        ? bindingAlias(prototypeInvocations, bindAccess.receiver, scope, assignment.node)
        : null
      const prototypeTarget = prototypeInvocation && value.arguments[0]
      const targetDescriptor = prototypeTarget && ts.isIdentifier(unwrap(prototypeTarget))
        ? bindingAlias(detachedMethods, unwrap(prototypeTarget), scope, assignment.node)
        : (() => {
            const target = prototypeTarget ? methodTarget(unwrap(prototypeTarget)) : null
            return target && (target.method === null || ["from", "rpc"].includes(target.method))
              && isTrustedReceiver(target.receiver, aliases, scope, assignment.node)
              ? { method: target.method, receiver: receiverOrigin(target.receiver, aliases, scope, assignment.node) }
              : null
          })()
      if (targetDescriptor) {
        return {
          invocation: prototypeInvocation,
          method: targetDescriptor.method,
          receiver: prototypeDescriptor?.unresolved
            ? { origin: null, unresolved: true }
            : targetDescriptor.receiver,
          bound: true,
          unresolved: Boolean(prototypeDescriptor?.unresolved),
        }
      }
      return ts.isIdentifier(value) ? bindingAlias(invocationMethods, value, scope, assignment.node) : null
    }
    const invocation = resolveConditionalAlias(initializer, resolveInvocation, sameMethodAlias, unresolvedMethodAlias)
    assignOrderedAlias(invocationMethods, key, invocation, conditional)

    const resolveApply = (value) => {
      const target = methodTarget(value)
      const bindAccess = ts.isCallExpression(value) && callMethod(value) === "bind" ? accessParts(value) : null
      const directApply = target && target.method === "apply" && rootIdentifier(target.receiver) === "Reflect"
      const boundReflectApply = bindAccess && methodTarget(bindAccess.receiver)?.method === "apply"
        && rootIdentifier(methodTarget(bindAccess.receiver)?.receiver) === "Reflect"
        && rootIdentifier(value.arguments[0]) === "Reflect"
      if (directApply || boundReflectApply) return { unresolved: false }
      return ts.isIdentifier(value) ? bindingAlias(applyAliases, value, scope, assignment.node) : null
    }
    const apply = resolveConditionalAlias(initializer, resolveApply,
      (left, right) => left.unresolved === right.unresolved,
      () => ({ unresolved: true }))
    assignOrderedAlias(applyAliases, key, apply, conditional)
  }
  return { aliases, boundMethods, detachedMethods, applyAliases, invocationMethods }
}

function reflectedQueryEntry(call, aliases, boundMethods, detachedMethods, applyAliases, scope) {
  const access = accessParts(call)
  const directApply = access?.method === "apply" && rootIdentifier(access.receiver) === "Reflect"
  const applyAlias = ts.isIdentifier(call.expression) ? bindingAlias(applyAliases, call.expression, scope, call) : null
  const aliasedApply = Boolean(applyAlias)
  if ((!directApply && !aliasedApply) || call.arguments.length !== 3) return null
  const target = unwrap(call.arguments[0])
  const argumentList = unwrap(call.arguments[2])
  const entryArguments = ts.isArrayLiteralExpression(argumentList) && !argumentList.elements.some(ts.isSpreadElement)
    ? [...argumentList.elements]
    : []
  if (ts.isIdentifier(target) && bindingAlias(boundMethods, target, scope, call)) {
    const bound = bindingAlias(boundMethods, target, scope, call)
    return { directMethod: bound.method, receiverUnresolved: Boolean(bound.receiver?.unresolved || applyAlias?.unresolved), entryArguments: [...bound.entryArguments, ...entryArguments] }
  }
  if (ts.isIdentifier(target) && bindingAlias(detachedMethods, target, scope, call)) {
    const detached = bindingAlias(detachedMethods, target, scope, call)
    return {
      directMethod: detached.method,
      receiverUnresolved: Boolean(applyAlias?.unresolved || !sameReceiverOrigin(detached.receiver, call.arguments[1], aliases, scope, call)),
      entryArguments,
    }
  }
  if (!ts.isPropertyAccessExpression(target) && !ts.isElementAccessExpression(target)) return null
  const targetMethod = ts.isPropertyAccessExpression(target)
    ? target.name.text
    : (target.argumentExpression && (ts.isStringLiteral(target.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(target.argumentExpression))
      ? target.argumentExpression.text
      : null)
  if (!["from", "rpc"].includes(targetMethod)) return null
  const receiver = unwrap(target.expression)
  if (!isTrustedReceiver(receiver, aliases, scope, call)) return null
  return { directMethod: targetMethod, receiverUnresolved: Boolean(applyAlias?.unresolved
    || !sameTrustedReceiver(receiver, call.arguments[1], aliases, scope, call)), entryArguments }
}

function functionInvocationQueryEntry(call, aliases, boundMethods, detachedMethods, scope) {
  const invocation = accessParts(call)
  if (!["call", "apply"].includes(invocation?.method) || call.arguments.length === 0) return null
  const target = unwrap(invocation.receiver)
  let method = null
  let receiver = null
  let isBound = false
  let preboundArguments = []
  if (ts.isIdentifier(target) && bindingAlias(boundMethods, target, scope, call)) {
    const bound = bindingAlias(boundMethods, target, scope, call)
    method = bound.method
    isBound = true
    preboundArguments = bound.entryArguments
    receiver = bound.receiver
  } else if (ts.isIdentifier(target) && bindingAlias(detachedMethods, target, scope, call)) {
    const detached = bindingAlias(detachedMethods, target, scope, call)
    method = detached.method
    receiver = detached.receiver
  } else if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    method = ts.isPropertyAccessExpression(target)
      ? target.name.text
      : (target.argumentExpression && (ts.isStringLiteral(target.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(target.argumentExpression))
        ? target.argumentExpression.text
        : null)
    const targetReceiver = unwrap(target.expression)
    if (!isTrustedReceiver(targetReceiver, aliases, scope, call) || (method !== null && !["from", "rpc"].includes(method))) return null
    receiver = receiverOrigin(targetReceiver, aliases, scope, call)
  } else {
    return null
  }
  if (method !== null && !["from", "rpc"].includes(method)) return null
  const invocationArguments = invocation.method === "call"
    ? [...call.arguments].slice(1)
    : (() => {
        const argumentList = call.arguments[1] && unwrap(call.arguments[1])
        return argumentList && ts.isArrayLiteralExpression(argumentList) && !argumentList.elements.some(ts.isSpreadElement)
          ? [...argumentList.elements]
          : []
      })()
  return {
    directMethod: method,
    receiverUnresolved: isBound ? Boolean(receiver?.unresolved) : !sameReceiverOrigin(receiver, call.arguments[0], aliases, scope, call),
    entryArguments: [...preboundArguments, ...invocationArguments],
  }
}

function aliasedFunctionInvocationEntry(call, aliases, invocationMethods, scope) {
  if (!ts.isIdentifier(call.expression)) return null
  const invocation = bindingAlias(invocationMethods, call.expression, scope, call)
  if (!invocation) return null
  const thisArgument = call.arguments[0]
  const entryArguments = invocation.invocation === "call"
    ? [...call.arguments].slice(1)
    : (() => {
        const argumentList = call.arguments[1] && unwrap(call.arguments[1])
        return argumentList && ts.isArrayLiteralExpression(argumentList) && !argumentList.elements.some(ts.isSpreadElement)
          ? [...argumentList.elements]
          : []
      })()
  return {
    directMethod: invocation.method,
    receiverUnresolved: Boolean(invocation.unresolved || !sameReceiverOrigin(invocation.receiver, thisArgument, aliases, scope, call)),
    entryArguments,
  }
}

function inlineBoundQueryEntry(call, aliases, scope) {
  const bind = ts.isCallExpression(call.expression) ? call.expression : null
  const bindAccess = bind && accessParts(bind)
  const target = bindAccess?.method === "bind"
    && (ts.isPropertyAccessExpression(bindAccess.receiver) || ts.isElementAccessExpression(bindAccess.receiver))
    ? bindAccess.receiver
    : null
  const targetMethod = target && (ts.isPropertyAccessExpression(target)
    ? target.name.text
    : (target.argumentExpression && (ts.isStringLiteral(target.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(target.argumentExpression))
      ? target.argumentExpression.text
      : null))
  if (!["from", "rpc"].includes(targetMethod) || bind.arguments.length === 0) return null
  const receiver = unwrap(target.expression)
  if (!isTrustedReceiver(receiver, aliases, scope, call)) return null
  return {
    directMethod: targetMethod,
    receiverUnresolved: !sameTrustedReceiver(receiver, bind.arguments[0], aliases, scope, call),
    entryArguments: [...bind.arguments].slice(1).concat([...call.arguments]),
  }
}

function isConditionalExecution(node, scope) {
  for (let parent = node.parent; parent && parent !== scope; parent = parent.parent) {
    if (ts.isIfStatement(parent) || ts.isConditionalExpression(parent) || ts.isForStatement(parent) || ts.isForInStatement(parent)
      || ts.isForOfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent) || ts.isSwitchStatement(parent)
      || ts.isTryStatement(parent) || ts.isCatchClause(parent)) return true
  }
  return false
}

function aliasAssignments(scope) {
  const assignments = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isIdentifier(unwrap(node.initializer))) {
      assignments.push({ pos: node.end, name: node.name.text, source: unwrap(node.initializer).text, node })
    }
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken
      && ts.isIdentifier(unwrap(node.left)) && ts.isIdentifier(unwrap(node.right))) {
      assignments.push({ pos: node.end, name: unwrap(node.left).text, source: unwrap(node.right).text, node })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  return assignments.sort((left, right) => left.pos - right.pos)
}

function boundOperationAssignments(scope) {
  const assignments = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isImmutableConst(node)) {
      const initializer = unwrap(node.initializer)
      const bind = ts.isCallExpression(initializer) && callMethod(initializer) === "bind" ? accessParts(initializer) : null
      const target = bind && (ts.isPropertyAccessExpression(bind.receiver) || ts.isElementAccessExpression(bind.receiver)) ? bind.receiver : null
      const method = target && (ts.isPropertyAccessExpression(target) ? target.name.text : (target.argumentExpression && (ts.isStringLiteral(target.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(target.argumentExpression)) ? target.argumentExpression.text : null))
      const source = target && rootIdentifier(target.expression)
      const boundTo = ts.isCallExpression(initializer) && initializer.arguments[0] && rootIdentifier(initializer.arguments[0])
      if (source && boundTo === source && method) assignments.push({ pos: node.end, name: node.name.text, source, method, node })
    }
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  return assignments.sort((left, right) => left.pos - right.pos)
}

export function createQueryChainFingerprint({ symbol, ordinal, operations }) {
  return createHash("sha256")
    .update(`${symbol}\u0000${ordinal}\u0000${operations.map((operation) => operation.getText().replace(/\s+/gu, " ")).join("\u0000")}`)
    .digest("hex")
}

function chainHasWildcardProjection(value) {
  return /(?:^|[,(])\s*(?:[A-Za-z_$][\w$]*\s*:\s*)?\*(?=\s*(?:[,)]|$))/u.test(value)
}

function isLexicalScope(node) {
  return ts.isSourceFile(node) || ts.isBlock(node) || ts.isModuleBlock(node) || ts.isCaseBlock(node)
    || ts.isFunctionLike(node) || ts.isCatchClause(node) || ts.isForStatement(node)
    || ts.isForInStatement(node) || ts.isForOfStatement(node) || ts.isClassExpression(node)
}

function lexicalBindingIndex(source) {
  const cached = LEXICAL_BINDINGS.get(source)
  if (cached) return cached
  const index = { scopes: new Map(), writes: new WeakMap() }
  const add = (name, start, functionScoped = false) => {
    let owner = start
    while (owner && !(functionScoped ? ts.isFunctionLike(owner) || ts.isSourceFile(owner) : isLexicalScope(owner))) owner = owner.parent
    if (!owner) return
    const names = index.scopes.get(owner) ?? new Map()
    for (const identifier of bindingIdentifiers(name)) {
      names.set(identifier.text, [...(names.get(identifier.text) ?? []), identifier])
    }
    index.scopes.set(owner, names)
  }
  const visit = (node) => {
    if (ts.isVariableDeclaration(node)) add(node.name, node.parent, isFunctionScopedBinding(node))
    else if (ts.isParameter(node)) add(node.name, node.parent)
    else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isEnumDeclaration(node) || ts.isModuleDeclaration(node)) && node.name) add(node.name, node.parent)
    else if ((ts.isFunctionExpression(node) || ts.isClassExpression(node)) && node.name) add(node.name, node)
    else if ((ts.isImportClause(node) || ts.isImportSpecifier(node) || ts.isNamespaceImport(node) || ts.isImportEqualsDeclaration(node)) && node.name) add(node.name, node.parent)
    ts.forEachChild(node, visit)
  }
  visit(source)
  LEXICAL_BINDINGS.set(source, index)
  return index
}

// Resolve the nearest lexical declaration even in its TDZ. Skipping an unsafe
// parameter, destructuring binding or later declaration could borrow an outer
// timeout with the same spelling. Binding nodes, not names, carry the proof.
function lexicalBindingsAt(identifier) {
  const { scopes } = lexicalBindingIndex(identifier.getSourceFile())
  for (let owner = identifier.parent; owner; owner = owner.parent) {
    const bindings = scopes.get(owner)?.get(identifier.text)
    if (bindings) return bindings
  }
  return []
}

function lexicalWriteTargets(expression) {
  const target = unwrap(expression)
  if (ts.isIdentifier(target)) return [target]
  if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) return lexicalWriteTargets(target.expression)
  if (ts.isArrayLiteralExpression(target)) return target.elements.flatMap(lexicalWriteTargets)
  if (ts.isObjectLiteralExpression(target)) return target.properties.flatMap((property) => {
    if (ts.isShorthandPropertyAssignment(property)) return [property.name]
    if (ts.isPropertyAssignment(property)) return lexicalWriteTargets(property.initializer)
    if (ts.isSpreadAssignment(property)) return lexicalWriteTargets(property.expression)
    return []
  })
  if (ts.isSpreadElement(target)) return lexicalWriteTargets(target.expression)
  if (ts.isBinaryExpression(target) && target.operatorToken.kind === ts.SyntaxKind.EqualsToken) return lexicalWriteTargets(target.left)
  return []
}

function hasLexicalWrite(binding) {
  const source = binding.getSourceFile()
  const { writes } = lexicalBindingIndex(source)
  if (writes.has(binding)) return writes.get(binding)
  let written = false
  const visit = (node) => {
    if (written) return
    let target
    if (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment
      && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) target = node.left
    else if ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node))
      && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) target = node.operand
    else if (ts.isDeleteExpression(node)) target = node.expression
    else if ((ts.isForInStatement(node) || ts.isForOfStatement(node)) && !ts.isVariableDeclarationList(node.initializer)) target = node.initializer
    if (target && lexicalWriteTargets(target).some((identifier) => lexicalBindingsAt(identifier).includes(binding))) written = true
    ts.forEachChild(node, visit)
  }
  visit(source)
  writes.set(binding, written)
  return written
}

function immutableLexicalInitializer(identifier, seen) {
  const bindings = lexicalBindingsAt(identifier)
  if (bindings.length !== 1) return null
  const binding = bindings[0]
  const declaration = binding.parent
  if (!ts.isVariableDeclaration(declaration) || declaration.name !== binding || !declaration.initializer
    || !isImmutableConst(declaration) || declaration.end > identifier.pos || seen.has(binding) || hasLexicalWrite(binding)) return null
  return { initializer: declaration.initializer, seen: new Set([...seen, binding]) }
}

function lexicalLiteralValue(expression, seen = new Set()) {
  const value = unwrap(expression)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value)) return value.text
  if (ts.isNumericLiteral(value)) return Number(value.text)
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) return -Number(value.operand.text)
  if (value.kind === ts.SyntaxKind.NullKeyword) return null
  if (value.kind === ts.SyntaxKind.TrueKeyword) return true
  if (value.kind === ts.SyntaxKind.FalseKeyword) return false
  if (ts.isIdentifier(value)) {
    if (value.text === "undefined" && lexicalBindingsAt(value).length === 0) return undefined
    const alias = immutableLexicalInitializer(value, seen)
    if (alias) return lexicalLiteralValue(alias.initializer, alias.seen)
  }
  return UNKNOWN_LITERAL
}

function isProvablyBoundedAbortExpression(expression, seen = new Set()) {
  const signal = unwrap(expression)
  if (ts.isIdentifier(signal)) {
    const alias = immutableLexicalInitializer(signal, seen)
    return Boolean(alias && isProvablyBoundedAbortExpression(alias.initializer, alias.seen))
  }
  if (ts.isConditionalExpression(signal)) {
    return isProvablyBoundedAbortExpression(signal.whenTrue, seen)
      && isProvablyBoundedAbortExpression(signal.whenFalse, seen)
  }
  if (!ts.isCallExpression(signal)) return false
  const access = accessParts(signal)
  if (rootIdentifier(access?.receiver) !== "AbortSignal" || lexicalBindingsAt(access.receiver).length > 0) return false
  if (access.method === "timeout") {
    return signal.arguments.length === 1
      && lexicalLiteralValue(signal.arguments[0], seen) === 8000
  }
  if (access.method !== "any" || signal.arguments.length !== 1) return false
  const signals = unwrap(signal.arguments[0])
  return ts.isArrayLiteralExpression(signals)
    && signals.elements.length === 2
    && !signals.elements.some(ts.isSpreadElement)
    && signals.elements.some((candidate) => isProvablyBoundedAbortExpression(candidate, seen))
}

function numberedRpcLimitViolation(argument, contract) {
  if (!argument) return "rpc_page_limit_missing"
  if (!ts.isObjectLiteralExpression(argument) || argument.properties.some((property) => !ts.isPropertyAssignment(property)
    || ts.isComputedPropertyName(property.name))) return "rpc_page_limit_unresolved"
  const limits = argument.properties.filter((property) => optionName(property) === contract.parameter)
  if (limits.length === 0) return "rpc_page_limit_missing"
  if (limits.length !== 1) return "rpc_page_limit_unresolved"
  const value = lexicalLiteralValue(limits[0].initializer)
  // Dynamic values are safe only for this exact server-validated contract.
  return value !== UNKNOWN_LITERAL && !contract.sizes.includes(value) ? "rpc_page_limit_invalid" : null
}

function isExactTimeoutAbortSignal(call) {
  return callMethod(call) === "abortSignal"
    && call.arguments.length === 1
    && isProvablyBoundedAbortExpression(call.arguments[0])
}

function hasExactDetailPredicate(operations, constants, scope, surface) {
  return operations.some((operation) => callMethod(operation) === "eq" && operation.arguments.length === 2
    && ["id", ...(surface === "tasks" ? ["task_id"] : [])].includes(argumentValue(operation.arguments[0], constants))
    && isDefinedDetailValue(operation.arguments[1], constants, scope))
}

function isDefinedDetailValue(argument, constants, scope) {
  const value = unwrap(argument)
  if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isNumericLiteral(value)) return true
  if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.MinusToken && ts.isNumericLiteral(value.operand)) return true
  if (!ts.isIdentifier(value) || value.text === "undefined") return false
  if (constants.has(value.text)) return true
  return scope.parameters.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === value.text)
}

function optionName(property) {
  return ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) ? property.name.text : null
}

function optionTarget(operation, bindings, optionIndex = 1, seen = new Set()) {
  const options = operation.arguments[optionIndex]
  if (!options) return "root"
  const value = unwrap(options)
  if (ts.isIdentifier(value)) {
    if (seen.has(value.text) || !bindings.has(value.text)) return "unproven"
    seen.add(value.text)
    return optionTarget({ arguments: [undefined, bindings.get(value.text)] }, bindings, 1, seen)
  }
  if (!ts.isObjectLiteralExpression(value)) return "unproven"
  for (const property of value.properties) {
    if (!ts.isPropertyAssignment(property) || property.name.kind === ts.SyntaxKind.ComputedPropertyName) return "unproven"
    if (["foreignTable", "referencedTable"].includes(optionName(property))) return "relation"
  }
  return "root"
}

function rootOperations(operations, method, bindings, optionIndex = 1) {
  return operations.filter((operation) => callMethod(operation) === method && optionTarget(operation, bindings, optionIndex) === "root")
}

function hasExplicitOrder(operations, bindings) {
  return rootOperations(operations, "order", bindings).length > 0
}

function hasIdTieBreak(operations, constants, bindings) {
  return rootOperations(operations, "order", bindings).some((operation) => argumentValue(operation.arguments[0], constants) === "id")
}

function finalOperation(operations, method) {
  return [...operations].reverse().find((operation) => callMethod(operation) === method)
}

function queryLineSpan(scope, query) {
  const sourceFile = scope.getSourceFile()
  const start = query.entry.getStart(sourceFile)
  const end = Math.max(...query.operations.map((operation) => operation.end))
  return {
    startLine: sourceFile.getLineAndCharacterOfPosition(start).line + 1,
    endLine: sourceFile.getLineAndCharacterOfPosition(end).line + 1,
  }
}

function queryOccurrenceFingerprint(scope, query) {
  const context = queryOccurrenceContext(scope, query)
  const ancestry = context.controlFlowAncestry.length > 0
    ? ["<control-flow>", ...context.controlFlowAncestry]
    : []
  return createHash("sha256")
    .update([
      context.previousStatement ?? "<scope-start>",
      context.query,
      ...ancestry,
    ].join("\u0000").replace(/\s+/gu, " "))
    .digest("hex")
}

function queryControlFlowAncestry(query, scope, sourceFile) {
  const ancestry = []
  const normalize = (value) => value.getText(sourceFile).replace(/\s+/gu, " ")
  let child = query.entry
  for (let parent = child.parent; parent && parent !== scope; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      const branch = child === parent.thenStatement ? "then" : child === parent.elseStatement ? "else" : "condition"
      ancestry.push(`if:${branch}:${normalize(parent.expression)}`)
    } else if (ts.isConditionalExpression(parent)) {
      const branch = child === parent.whenTrue ? "true" : child === parent.whenFalse ? "false" : "condition"
      ancestry.push(`conditional:${branch}:${normalize(parent.condition)}`)
    } else if (ts.isForStatement(parent)) {
      ancestry.push(`for:${parent.condition ? normalize(parent.condition) : "<none>"}`)
    } else if (ts.isForInStatement(parent) || ts.isForOfStatement(parent)) {
      ancestry.push(`${ts.isForInStatement(parent) ? "for-in" : "for-of"}:${normalize(parent.expression)}`)
    } else if (ts.isWhileStatement(parent) || ts.isDoStatement(parent)) {
      ancestry.push(`${ts.isWhileStatement(parent) ? "while" : "do"}:${normalize(parent.expression)}`)
    } else if (ts.isCaseClause(parent)) {
      ancestry.push(`switch-case:${normalize(parent.expression)}`)
    } else if (ts.isDefaultClause(parent)) {
      ancestry.push("switch-default")
    } else if (ts.isTryStatement(parent)) {
      const branch = child === parent.tryBlock ? "try" : child === parent.catchClause ? "catch" : "finally"
      ancestry.push(`try:${branch}`)
    } else if (ts.isCatchClause(parent)) {
      ancestry.push("catch")
    } else if (isStandaloneStatementBlock(parent)) {
      ancestry.push("block")
    }
  }
  return ancestry.reverse()
}

function controlFlowSiblingOrdinal(node, sourceFile) {
  const parent = node.parent
  if (!parent || !isStatementListContainer(parent)) return 0
  const normalize = (value) => value.getText(sourceFile).replace(/\s+/gu, " ")
  const identity = (candidate) => {
    if (ts.isBlock(candidate)) return "block"
    if (ts.isIfStatement(candidate)) return `if:${normalize(candidate.expression)}`
    if (ts.isForStatement(candidate)) return `for:${candidate.condition ? normalize(candidate.condition) : "<none>"}`
    if (ts.isForInStatement(candidate) || ts.isForOfStatement(candidate)) {
      return `${ts.isForInStatement(candidate) ? "for-in" : "for-of"}:${normalize(candidate.expression)}`
    }
    if (ts.isWhileStatement(candidate) || ts.isDoStatement(candidate)) {
      return `${ts.isWhileStatement(candidate) ? "while" : "do"}:${normalize(candidate.expression)}`
    }
    if (ts.isTryStatement(candidate)) return "try"
    if (ts.isSwitchStatement(candidate)) return `switch:${normalize(candidate.expression)}`
    return null
  }
  const target = identity(node)
  if (!target) return 0
  let ordinal = 0
  for (const sibling of parent.statements) {
    if (sibling === node) return ordinal
    if (identity(sibling) === target) ordinal += 1
  }
  return ordinal
}

function isStatementListContainer(node) {
  return ts.isBlock(node) || ts.isSourceFile(node) || ts.isCaseClause(node) || ts.isDefaultClause(node)
}

function isStandaloneStatementBlock(node) {
  return ts.isBlock(node) && isStatementListContainer(node.parent)
}

function queryControlFlowStructure(query, scope, sourceFile) {
  const structure = []
  let child = query.entry
  for (let parent = child.parent; parent && parent !== scope; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent) || ts.isForStatement(parent) || ts.isForInStatement(parent)
      || ts.isForOfStatement(parent) || ts.isWhileStatement(parent) || ts.isDoStatement(parent)
      || ts.isTryStatement(parent) || ts.isSwitchStatement(parent)
      || isStandaloneStatementBlock(parent)) {
      structure.push(controlFlowSiblingOrdinal(parent, sourceFile))
    }
  }
  return structure.reverse()
}

function queryOccurrenceContext(scope, query) {
  const sourceFile = scope.getSourceFile()
  let statement = query.entry
  while (statement.parent && !ts.isStatement(statement)) statement = statement.parent
  const parent = statement.parent
  const siblings = parent && (ts.isBlock(parent) || ts.isSourceFile(parent))
    ? parent.statements
    : []
  const index = [...siblings].findIndex((candidate) => candidate === statement)
  const previousStatement = index > 0 ? siblings[index - 1] : null
  const start = query.entry.getStart(sourceFile)
  const end = query.operations.at(-1)?.getEnd() ?? query.entry.getEnd()
  const normalize = (value) => value.replace(/\s+/gu, " ")
  return {
    previousStatement: previousStatement ? normalize(previousStatement.getText(sourceFile)) : null,
    query: normalize(sourceFile.text.slice(start, end)),
    controlFlowAncestry: queryControlFlowAncestry(query, scope, sourceFile),
    controlFlowStructure: queryControlFlowStructure(query, scope, sourceFile),
    before: [...siblings].slice(0, index).map((candidate) => normalize(candidate.getText(sourceFile))),
    after: [...siblings].slice(index + 1).map((candidate) => normalize(candidate.getText(sourceFile))),
  }
}

function withQueryOccurrence(violations, occurrenceFingerprint, occurrenceContext) {
  return violations.map((violation) => {
    Object.defineProperties(violation, {
      occurrenceFingerprint: { value: occurrenceFingerprint, enumerable: false },
      occurrenceContext: { value: occurrenceContext, enumerable: false },
    })
    return violation
  })
}

function statementCounts(statements) {
  const counts = new Map()
  for (const statement of statements) counts.set(statement, (counts.get(statement) ?? 0) + 1)
  return counts
}

function queryOccurrenceRelocated(baseline, candidate) {
  if (!baseline || !candidate || baseline.query !== candidate.query) return true
  if (baseline.controlFlowAncestry.length !== candidate.controlFlowAncestry.length
    || baseline.controlFlowAncestry.some((ancestor, index) => ancestor !== candidate.controlFlowAncestry[index])) return true
  if (baseline.controlFlowStructure.length !== candidate.controlFlowStructure.length
    || baseline.controlFlowStructure.some((position, index) => position !== candidate.controlFlowStructure[index])) return true
  const baselineBefore = statementCounts(baseline.before)
  const baselineAfter = statementCounts(baseline.after)
  const candidateBefore = statementCounts(candidate.before)
  const candidateAfter = statementCounts(candidate.after)
  const statements = new Set([...baselineBefore.keys(), ...baselineAfter.keys(), ...candidateBefore.keys(), ...candidateAfter.keys()])
  return [...statements].some((statement) => (
    (candidateBefore.get(statement) ?? 0) < (baselineBefore.get(statement) ?? 0)
      && (candidateAfter.get(statement) ?? 0) > (baselineAfter.get(statement) ?? 0)
  ) || (
    (candidateAfter.get(statement) ?? 0) < (baselineAfter.get(statement) ?? 0)
      && (candidateBefore.get(statement) ?? 0) > (baselineBefore.get(statement) ?? 0)
  ))
}

function scopeLineSpan(scope) {
  const sourceFile = scope.getSourceFile()
  return {
    scopeStartLine: sourceFile.getLineAndCharacterOfPosition(scope.getStart(sourceFile)).line + 1,
    scopeEndLine: sourceFile.getLineAndCharacterOfPosition(scope.end).line + 1,
  }
}

function analyzeChain({ surface, file, symbol, scope, query }) {
  const constants = primitiveConstants(scope, query.entry)
  const optionBindings = immutableConstInitializers(scope, query.entry)
  const legacyFullCompatibility = isLegacyPublicFullCompatibilityQuery({ surface, file, symbol, query, constants })
  const reasons = []
  if (query.receiverUnresolved) reasons.push("list_query_receiver_unresolved")
  else if (query.directMethod === null) reasons.push("list_query_method_unresolved")
  if (query.controlFlowUnresolved) reasons.push("list_query_control_flow_unresolved")
  if (query.receiverUnresolved || query.directMethod === null) {
    const fingerprint = createQueryChainFingerprint({ symbol, ordinal: query.ordinal, operations: query.operations })
    const { startLine, endLine } = queryLineSpan(scope, query)
    return withQueryOccurrence(
      reasons.map((reason) => ({ file, symbol, surface, reason, fingerprint, startLine, endLine, ...scopeLineSpan(scope) })),
      queryOccurrenceFingerprint(scope, query),
      queryOccurrenceContext(scope, query),
    )
  }
  if (query.directMethod === "from") {
    const projections = query.operations.filter((operation) => callMethod(operation) === "select")
    if (projections.length === 0) reasons.push("list_projection_missing")
    for (const projection of projections) {
      const value = projection.arguments[0] && argumentValue(projection.arguments[0], constants)
      if (value === undefined) reasons.push("list_projection_unresolved")
      else if (typeof value !== "string" || value.trim() === "") reasons.push("list_projection_invalid")
      else if (chainHasWildcardProjection(value)) reasons.push("list_select_star")
    }
    const limits = rootOperations(query.operations, "limit", optionBindings)
    const singleResult = query.operations.some((operation) => ["maybeSingle", "single"].includes(callMethod(operation)))
    const ranges = rootOperations(query.operations, "range", optionBindings, 2)
    const exactDetail = singleResult && hasExactDetailPredicate(query.operations, constants, scope, surface)
    if (singleResult && !exactDetail) reasons.push("list_detail_predicate_missing")
    if (!legacyFullCompatibility) {
      if (limits.length === 0 && !exactDetail && ranges.length === 0) reasons.push("list_limit_missing")
      if (!exactDetail && !hasExplicitOrder(query.operations, optionBindings)) reasons.push("list_order_missing")
      else if (!exactDetail && !hasIdTieBreak(query.operations, constants, optionBindings)) reasons.push("list_order_tie_break_missing")
      for (const limit of limits) {
        const value = limit.arguments[0] && argumentValue(limit.arguments[0], constants)
        if (value === undefined) reasons.push("list_limit_unresolved")
        else if (typeof value !== "number" || !Number.isInteger(value) || value < 1) reasons.push("list_limit_invalid")
        else if (value > 30) reasons.push("list_limit_exceeds_30")
      }
      for (const range of ranges) {
        const first = range.arguments[0] && argumentValue(range.arguments[0], constants)
        const last = range.arguments[1] && argumentValue(range.arguments[1], constants)
        if (!Number.isInteger(first) || !Number.isInteger(last)) reasons.push("list_range_unresolved")
        else if (first < 0 || last < first || last - first + 1 > 30) reasons.push("list_range_invalid")
      }
    }
  }
  if (query.directMethod === "rpc") {
    const entryArguments = query.entryArguments ?? query.entry.arguments
    const rpcName = entryArguments[0] && argumentValue(entryArguments[0], constants)
    const exactNonpageableRpc = typeof rpcName === "string"
      && (EXACT_SCALAR_RPC_NAMES.has(rpcName) || EXACT_CONTINUOUS_SCHEDULE_OPERATION_RPC_NAMES.has(rpcName))
    const argument = entryArguments[1] ? unwrap(entryArguments[1]) : null
    const numberedContract = entryArguments[0] && EXACT_NUMBERED_RPC_CONTRACTS.get(lexicalLiteralValue(entryArguments[0]))
    const hasSpread = argument && ts.isObjectLiteralExpression(argument) && argument.properties.some((property) => ts.isSpreadAssignment(property))
    const limits = argument && ts.isObjectLiteralExpression(argument) ? argument.properties.filter((property) => ts.isPropertyAssignment(property)
      && ((ts.isIdentifier(property.name) && property.name.text === "p_limit") || (ts.isStringLiteral(property.name) && property.name.text === "p_limit"))) : []
    if (numberedContract) {
      const violation = numberedRpcLimitViolation(argument, numberedContract)
      if (violation) reasons.push(violation)
    } else if (hasSpread) reasons.push("rpc_page_limit_unresolved")
    else if (limits.length === 0 && !exactNonpageableRpc) reasons.push("rpc_page_limit_missing")
    for (const limit of limits) {
      const value = argumentValue(limit.initializer, constants)
      if (value === undefined) reasons.push("rpc_page_limit_unresolved")
      else if (typeof value !== "number" || !Number.isInteger(value) || value < 1) reasons.push("rpc_page_limit_invalid")
      else if (value > 30) reasons.push("rpc_page_limit_exceeds_30")
    }
  }
  if (query.directMethod && !legacyFullCompatibility && !isExactTimeoutAbortSignal(finalOperation(query.operations, "abortSignal"))) reasons.push("list_abort_signal_missing")
  const retry = finalOperation(query.operations, "retry")
  if (query.directMethod && !legacyFullCompatibility && !(retry && retry.arguments.length === 1 && retry.arguments[0].kind === ts.SyntaxKind.FalseKeyword)) reasons.push("list_retry_false_missing")
  if (surface === "tasks" && query.directMethod === "from") {
    for (const operation of query.operations.filter((candidate) => callMethod(candidate) === "in")) {
      if (argumentValue(operation.arguments[0], constants) === "task_id") reasons.push("task_id_batch_in_list")
      else if (argumentValue(operation.arguments[0], constants) === undefined) reasons.push("task_in_column_unresolved")
    }
  }
  const fingerprint = createQueryChainFingerprint({ symbol, ordinal: query.ordinal, operations: query.operations })
  const { startLine, endLine } = queryLineSpan(scope, query)
  return withQueryOccurrence(
    reasons.map((reason) => ({ file, symbol, surface, reason, fingerprint, startLine, endLine, ...scopeLineSpan(scope) })),
    queryOccurrenceFingerprint(scope, query),
    queryOccurrenceContext(scope, query),
  )
}

function analyzeScope({ surface, file, scope, symbol }) {
  const provenanceAssignments = aliasProvenanceAssignments(scope)
  const queryAliases = new Map()
  const operationAliases = new Map()
  const aliasesToAssign = aliasAssignments(scope)
  const operationsToAssign = boundOperationAssignments(scope)
  let aliasIndex = 0
  let operationIndex = 0
  const records = []
  const calls = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  for (const call of calls.sort((left, right) => left.pos - right.pos)) {
    const { aliases, boundMethods, detachedMethods, applyAliases, invocationMethods } = aliasProvenanceAt(provenanceAssignments, call, scope)
    while (operationIndex < operationsToAssign.length && operationsToAssign[operationIndex].pos <= call.pos) {
      const assignment = operationsToAssign[operationIndex]
      const parent = queryAliases.get(assignment.source)
      if (parent) operationAliases.set(assignment.name, { parent, method: assignment.method, node: assignment.node })
      operationIndex += 1
    }
    while (aliasIndex < aliasesToAssign.length && aliasesToAssign[aliasIndex].pos <= call.pos) {
      const assignment = aliasesToAssign[aliasIndex]
      const parent = queryAliases.get(assignment.source)
      if (parent) {
        parent.controlFlowUnresolved ||= isConditionalExecution(assignment.node, scope)
        queryAliases.set(assignment.name, parent)
      }
      const operation = operationAliases.get(assignment.source)
      if (operation && ts.isVariableDeclaration(assignment.node) && isImmutableConst(assignment.node)) {
        operationAliases.set(assignment.name, { ...operation, node: assignment.node })
      }
      aliasIndex += 1
    }
    const operationAlias = ts.isIdentifier(call.expression) ? operationAliases.get(call.expression.text) : null
    if (operationAlias) {
      const parent = operationAlias.parent
      const firstBranch = !parent.usedAsReceiver
      parent.usedAsReceiver = true
      BOUND_OPERATION_METHODS.set(call, operationAlias.method)
      const record = {
        entry: parent.entry,
        directMethod: parent.directMethod,
        receiverUnresolved: parent.receiverUnresolved,
        controlFlowUnresolved: parent.controlFlowUnresolved || isConditionalExecution(operationAlias.node, scope),
        ordinal: firstBranch ? parent.ordinal : records.length,
        operations: [...parent.operations, ...queryOperations(call)],
      }
      records.push(record)
      const name = assignmentName(call)
      if (name) queryAliases.set(name, record)
      continue
    }
    const reflectedEntry = reflectedQueryEntry(call, aliases, boundMethods, detachedMethods, applyAliases, scope)
    if (reflectedEntry) {
      BOUND_OPERATION_METHODS.set(call, reflectedEntry.directMethod)
      records.push({
        entry: call,
        directMethod: reflectedEntry.directMethod,
        receiverUnresolved: reflectedEntry.receiverUnresolved,
        entryArguments: reflectedEntry.entryArguments,
        ordinal: records.length,
        operations: queryOperations(call),
      })
      continue
    }
    const functionInvocationEntry = functionInvocationQueryEntry(call, aliases, boundMethods, detachedMethods, scope)
    if (functionInvocationEntry) {
      BOUND_OPERATION_METHODS.set(call, functionInvocationEntry.directMethod)
      records.push({
        entry: call,
        directMethod: functionInvocationEntry.directMethod,
        receiverUnresolved: functionInvocationEntry.receiverUnresolved,
        entryArguments: functionInvocationEntry.entryArguments,
        ordinal: records.length,
        operations: queryOperations(call),
      })
      continue
    }
    const aliasedFunctionEntry = aliasedFunctionInvocationEntry(call, aliases, invocationMethods, scope)
    if (aliasedFunctionEntry) {
      BOUND_OPERATION_METHODS.set(call, aliasedFunctionEntry.directMethod)
      records.push({
        entry: call,
        directMethod: aliasedFunctionEntry.directMethod,
        receiverUnresolved: aliasedFunctionEntry.receiverUnresolved,
        entryArguments: aliasedFunctionEntry.entryArguments,
        ordinal: records.length,
        operations: queryOperations(call),
      })
      continue
    }
    const inlineBoundEntry = inlineBoundQueryEntry(call, aliases, scope)
    if (inlineBoundEntry) {
      BOUND_OPERATION_METHODS.set(call, inlineBoundEntry.directMethod)
      records.push({
        entry: call,
        directMethod: inlineBoundEntry.directMethod,
        receiverUnresolved: inlineBoundEntry.receiverUnresolved,
        entryArguments: inlineBoundEntry.entryArguments,
        ordinal: records.length,
        operations: queryOperations(call),
      })
      continue
    }
    const boundMethod = ts.isIdentifier(call.expression) ? bindingAlias(boundMethods, call.expression, scope, call) : null
    if (boundMethod) {
      const record = {
        entry: call,
        directMethod: boundMethod.method,
        receiverUnresolved: Boolean(boundMethod.receiver?.unresolved || boundMethod.unresolved),
        entryArguments: [...boundMethod.entryArguments, ...call.arguments],
        ordinal: records.length,
        operations: queryOperations(call),
      }
      records.push(record)
      const name = assignmentName(call)
      if (name) {
        record.controlFlowUnresolved = isConditionalExecution(call, scope)
        queryAliases.set(name, record)
      }
      continue
    }
    const detachedMethod = ts.isIdentifier(call.expression) ? bindingAlias(detachedMethods, call.expression, scope, call) : null
    if (detachedMethod) {
      records.push({
        entry: call,
        directMethod: detachedMethod.method,
        receiverUnresolved: true,
        entryArguments: [...call.arguments],
        ordinal: records.length,
        operations: queryOperations(call),
      })
      continue
    }
    const access = accessParts(call)
    if (!access) continue
    const trusted = isTrustedReceiver(access.receiver, aliases, scope, call)
    const entryMethod = access.method === "from" || access.method === "rpc" ? access.method : null
    const dynamicEntry = access.computed && access.method === null && trusted
    const unknownReceiver = entryMethod && trusted === null
    if ((entryMethod && trusted) || dynamicEntry || unknownReceiver) {
      const record = { entry: call, directMethod: entryMethod, receiverUnresolved: unknownReceiver, ordinal: records.length, operations: queryOperations(call) }
      records.push(record)
      const name = assignmentName(call)
      if (name) {
        record.controlFlowUnresolved = isConditionalExecution(call, scope)
        queryAliases.set(name, record)
      }
      continue
    }
    const alias = rootIdentifier(access.receiver)
    const parent = alias && queryAliases.get(alias)
    if (!parent) continue
    const firstBranch = !parent.usedAsReceiver
    parent.usedAsReceiver = true
    const record = {
      entry: parent.entry,
      directMethod: parent.directMethod,
      receiverUnresolved: parent.receiverUnresolved,
      controlFlowUnresolved: parent.controlFlowUnresolved,
      // Preserve the root record's historical fingerprint through one linear
      // reassignment; subsequent uses are independent sibling branches.
      ordinal: firstBranch ? parent.ordinal : records.length,
      operations: [...parent.operations, ...queryOperations(call)],
    }
    records.push(record)
    const name = assignmentName(call)
    if (name) {
      record.controlFlowUnresolved ||= isConditionalExecution(call, scope)
      queryAliases.set(name, record)
    }
  }
  return records.filter((query) => !query.usedAsReceiver).flatMap((query) => analyzeChain({ surface, file, symbol, scope, query }))
}

export function inspectQuerySurfaceSource({ surface, file, source }) {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, scriptKind(file))
  const scopes = [{ symbol: "module", scope: sourceFile }]
  const visit = (node) => {
    if (ts.isFunctionLike(node)) scopes.push({ symbol: functionSymbol(node), scope: node })
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(sourceFile, visit)
  return scopes.flatMap(({ symbol, scope }) => analyzeScope({ surface, file, symbol, scope }))
}

function countedViolations(source, surface, file) {
  const counts = new Map()
  for (const violation of inspectQuerySurfaceSource({ surface, file, source })) {
      const key = exactDebtKey(violation)
      counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

function occurrenceKeys(source, surface, file) {
  const keys = new Set()
  for (const violation of inspectQuerySurfaceSource({ surface, file, source })) {
    keys.add(`${exactDebtKey(violation)}\u0000${violation.occurrenceFingerprint}`)
  }
  return keys
}

function exactDebtKey({ surface, file, symbol, reason }) {
  return `${surface}\u0000${file}\u0000${symbol}\u0000${reason}\u0000${arguments[0].fingerprint ?? ""}`
}

async function sourceAt({ root, file, revision, includeWorktree }) {
  if (includeWorktree) return readFile(resolve(root, file), "utf8")
  try {
    return git(root, ["show", `${revision}:${file}`])
  } catch (error) {
    if (error.code?.startsWith("query_surface_git_")) return null
    throw error
  }
}

function changedFiles({ root, baseSha, headSha, includeWorktree }) {
  const range = includeWorktree ? ["diff", "--name-only", baseSha] : ["diff", "--name-only", `${baseSha}..${headSha}`]
  const changed = git(root, range).split("\n").filter(Boolean)
  if (!includeWorktree) return changed
  const untracked = git(root, ["ls-files", "--others", "--exclude-standard"]).split("\n").filter(Boolean)
  return [...new Set([...changed, ...untracked])]
}

function changedLineRanges({ root, baseSha, headSha, includeWorktree, file, baselineExists }) {
  if (!baselineExists) return [{ start: 1, end: Infinity }]
  const args = includeWorktree
    ? ["diff", "--unified=0", baseSha, "--", file]
    : ["diff", "--unified=0", `${baseSha}..${headSha}`, "--", file]
  const ranges = []
  for (const line of git(root, args).split("\n")) {
    const match = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/u)
    if (!match) continue
    const start = Number(match[1])
    const count = match[2] === undefined ? 1 : Number(match[2])
    // A pure deletion has no candidate-side lines. Associate it with the
    // adjacent candidate line so the containing function is rechecked.
    ranges.push(count > 0 ? { start, end: start + count - 1 } : { start: Math.max(1, start - 1), end: start })
  }
  return ranges
}

function overlapsChangedRange(violation, ranges) {
  return ranges.some((range) => (violation.startLine <= range.end && violation.endLine >= range.start)
    || (violation.scopeStartLine <= range.end && violation.scopeEndLine >= range.start))
}

function publicViolation({ file, symbol, surface, reason }) {
  return { file, symbol, surface, reason }
}

/**
 * Checks query chains touched by a changed owned source file. Existing debt is
 * accepted only by its exact manifest fingerprint; unchanged legacy chains are
 * outside this diff guard's candidate set.
 */
export async function verifyQuerySurfaceBudget({ surface, baseSha, headSha, includeWorktree = false, root = process.cwd(), debtManifest = QUERY_SURFACE_DEBT_MANIFEST }) {
  assertSurface(surface)
  if (typeof baseSha !== "string" || baseSha.length === 0) throw queryBudgetError("query_surface_base_required")
  if (!includeWorktree && (typeof headSha !== "string" || headSha.length === 0)) throw queryBudgetError("query_surface_head_required")
  if (includeWorktree && headSha !== undefined) throw queryBudgetError("query_surface_mode_invalid")

  const surfaces = selectedSurfaces(surface)
  const files = changedFiles({ root, baseSha, headSha, includeWorktree })
  if (!Array.isArray(debtManifest)) throw queryBudgetError("query_surface_debt_manifest_invalid")
  const manifestDebt = new Map()
  for (const entry of debtManifest.filter((candidate) => surfaces.includes(candidate.surface))) {
    if (!entry || typeof entry.file !== "string" || typeof entry.symbol !== "string" || typeof entry.violation !== "string"
      || typeof entry.baselineSha !== "string" || typeof entry.fingerprint !== "string" || !/^[0-9a-f]{40}$/u.test(entry.baselineSha)
      || !/^[0-9a-f]{64}$/u.test(entry.fingerprint) || typeof entry.occurrenceFingerprint !== "string"
      || !/^[0-9a-f]{64}$/u.test(entry.occurrenceFingerprint)) throw queryBudgetError("query_surface_debt_manifest_invalid")
    const manifestBaseline = await sourceAt({ root, file: entry.file, revision: entry.baselineSha, includeWorktree: false })
    if (manifestBaseline === null) {
      throw queryBudgetError("query_surface_debt_manifest_invalid")
    }
    const baselineKey = exactDebtKey({ surface: entry.surface, file: entry.file, symbol: entry.symbol, reason: entry.violation, fingerprint: entry.fingerprint })
    const manifestViolation = inspectQuerySurfaceSource({ surface: entry.surface, file: entry.file, source: manifestBaseline })
      .find((violation) => exactDebtKey(violation) === baselineKey
        && violation.occurrenceFingerprint === entry.occurrenceFingerprint)
    if (!manifestViolation) {
      throw queryBudgetError("query_surface_debt_manifest_invalid")
    }
    manifestDebt.set(baselineKey, {
      occurrenceFingerprint: entry.occurrenceFingerprint,
      occurrenceContext: manifestViolation.occurrenceContext,
    })
  }
  const violations = []
  for (const file of files) {
    const owner = surfaces.find((candidate) => isSurfacePath(candidate, file))
    if (!owner) continue
    const source = await sourceAt({ root, file, revision: headSha, includeWorktree })
    if (source === null) continue
    const baselineSource = await sourceAt({ root, file, revision: baseSha, includeWorktree: false })
    const ranges = changedLineRanges({ root, baseSha, headSha, includeWorktree, file, baselineExists: baselineSource !== null })
    const baseDebt = baselineSource === null ? new Map() : countedViolations(baselineSource, owner, file)
    const baseOccurrences = baselineSource === null ? new Set() : occurrenceKeys(baselineSource, owner, file)
    const sourceViolations = inspectQuerySurfaceSource({ surface: owner, file, source })
    const sourceDebt = countedViolations(source, owner, file)
    for (const violation of sourceViolations) {
        const key = exactDebtKey(violation)
        const expected = manifestDebt.get(key)
        const allowedDebt = manifestDebt.has(key) && baseDebt.has(key)
          && sourceDebt.get(key) <= baseDebt.get(key)
          && baseOccurrences.has(`${key}\u0000${expected.occurrenceFingerprint}`)
          && !queryOccurrenceRelocated(expected.occurrenceContext, violation.occurrenceContext)
        // An immutable deadline may be declared outside the query function.
        // Compare raw baseline diagnostics by exact chain/occurrence so a
        // module-only edit cannot silently remove a previously proven bound.
        const newlyUnboundedAbort = violation.reason === "list_abort_signal_missing"
          && !baseOccurrences.has(`${key}\u0000${violation.occurrenceFingerprint}`)
        if ((overlapsChangedRange(violation, ranges) || newlyUnboundedAbort) && !allowedDebt) violations.push(violation)
    }
  }
  violations.sort((left, right) => exactDebtKey(left).localeCompare(exactDebtKey(right)))
  return {
    ok: violations.length === 0,
    violations: violations.map(publicViolation),
  }
}
