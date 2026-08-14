import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { resolve } from "node:path"
import ts from "typescript"

export const QUERY_SURFACES = Object.freeze(["tasks", "management", "operations", "academic", "public"])
const BASELINE_SHA = "fad56ae59f6b5ec6999e3232bbe68e4c1d26b101"
const BOUND_OPERATION_METHODS = new WeakMap()
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
])
const EXACT_CONTINUOUS_SCHEDULE_OPERATION_RPC_NAMES = new Set([
  "save_class_schedule_defaults_v1",
  "preview_class_lesson_session_generation_v1",
  "generate_class_lesson_sessions_v1",
  "save_class_lesson_session_v1",
  "save_class_lesson_content_v1",
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
  ["f634c3bdbd371fe0badf43b9b774dc13d73ecb9e4151061aeea6bd93f2e47510", "36155799ed2b16b75931485780ba9a97b4d7dbae505f671a8124b302cf90afdf"],
  ["19a4d722ed35299a88bf06fb3164ebec2081d2ce16a53835c398624485ef48b1", "38fc4f6997e9edf0412ad389699ac36a13f1da1394f38710a68731beaf685e46"],
  ["ce8eacaf5a088c1bd6a02532bd8a974e8b87bb56ee6fa929abee23f550046ca9", "d82e248868a699b522c0b9bd5ea203aedd075ffe8d5bb3c9e2aaea0b40d132fb"],
  ["c298131d70d0b561467e5dcdfe3196f8be304ea1de9e8d2e91bbbd82f9019965", "661ffe54d7b667bc98ca5d83eb1f765c7344a558dff7ff71e25963ce7a6c5b86"],
  ["1d10c6da117bcc226bd4b3a2b1511de9dc10cf22fb8655b6c6a439934543485b", "88eb22ad0c6baac6d5423935d95be226781f03f668702f2297cbd1608f103d83"],
  ["d31238040cb5ecb0b1979fa01fe8a784c8377466de1a5a4bb41a273d4a0832f8", "661ffe54d7b667bc98ca5d83eb1f765c7344a558dff7ff71e25963ce7a6c5b86"],
  ["53187d67160e2b5f8abb237db5414df034bc01b78a8baf35611506a2c25a49da", "88eb22ad0c6baac6d5423935d95be226781f03f668702f2297cbd1608f103d83"],
  ["bb47c9d77c189079d6544f15850441de3880742fae7d5891c44cc04c01a278c4", "54614d10a5b739c8c3df3fc0c6f821f4b5a013899aaab0b99a587d3dfce951aa"],
  ["1d6333930b09982ad59d086dae3e203f55e2577fa266904b7cc729acf5c2240c", "209c094c9f2ddfcc0d6102747d58176d5c1e76cf55aff49ba613afaaa43ce7f2"],
  ["2c96a45dbc1c66b7e71a5870ff26b2f5385c3937705c5ac6cc886b4f3c355401", "036b518140220d304a1fe019d20e351d471d56e80322c87e008197196a53914a"],
  ["eb75288993a7bbd901544dd155cdc276764ab97a28b7d75622d069ebdaadb2d7", "f4361f26cb7a2e6fa1b14123d2decd850b6d0c0da610cffb97ab8a80d0dbf2e5"],
  ["9ec60a4049e9d6defd81e44652e6d11f70d14aff2e41b13a22e023346618802d", "f19f1c18babb1667f17c5ab1f14e33073033c07f9b52c7c0e45896b509e8c942"],
  ["91089c83905a97981897078f1f116d88f17314217f4a04d1958b91c83ff2cb58", "a2f9f135cdd93ddd4775e7ffb03c4398570ed5c7130dcd269c12af0b361b5279"],
  ["7ad267651103e94ecda0049485e915e7c577351c85c5693bc4d87c4e6c17cbbb", "3d83353476698d6cb9d3ad0a3d4d9c99ca2e298e303d88c361d103d74ae9fa96"],
  ["65280cf9e7670073ed6c2af811fba866f2a819a0e814dc736bc30e85325a9f76", "7397ba41378948785a89414a4bcc260c549ddb90e36397aa7b37e761e31190e1"],
  ["8eb0d3f8f2d72a47ab438bb9f74a837ca9a23162cc611b6b2d02f5150b2c5790", "1f0f3f0640b2f0ec709385a1a1a4d760f45152aabcf5fb4daa2345a46b2e7553"],
  ["193816049298234fe788de7b9aec7bbab89eebaab8aadb18da74705673611b94", "dc87aa145b10d137d7f181c87d1a01725a2eeb7dcccf94a40e5b212778dd1a2d"],
  ["bddeb9462f15759b516eed0505dfbb8961248ba29c8cdb16189d6738ab15142d", "1cd961f6b9793fbbf6078fdbb549dc16a1f2d8d73739864de8f328cbbb20de83"],
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

function isVisibleBindingAt(declaration, use, scope) {
  if (!use || declaration.pos >= use.pos) return false
  for (let parent = declaration.parent; parent && parent !== scope; parent = parent.parent) {
    if (ts.isBlock(parent) && !(parent.pos <= use.pos && use.end <= parent.end)) return false
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

function isTrustedReceiver(expression, aliases) {
  const identifier = rootIdentifier(expression)
  if (identifier === "Array") return false
  if (identifier && aliases.has(identifier)) return true
  return null
}

function receiverOrigin(expression, aliases) {
  const identifier = rootIdentifier(expression)
  return identifier ? aliases.get(identifier) ?? null : null
}

function sameTrustedReceiver(left, right, aliases) {
  const leftReceiver = receiverOrigin(left, aliases)
  const rightReceiver = receiverOrigin(right, aliases)
  return Boolean(leftReceiver && rightReceiver && !leftReceiver.unresolved && !rightReceiver.unresolved
    && leftReceiver.origin === rightReceiver.origin)
}

function sameReceiverOrigin(receiver, expression, aliases) {
  const other = receiverOrigin(expression, aliases)
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
        property: element.propertyName ? computedPropertyText(element.propertyName) : element.name.text,
        computed: Boolean(element.propertyName && ts.isComputedPropertyName(element.propertyName)),
      }]
    })
  }
  if (ts.isObjectLiteralExpression(target)) {
    return target.properties.flatMap((property) => {
      if (ts.isShorthandPropertyAssignment(property)) {
        return [{ name: property.name.text, property: property.name.text, computed: false }]
      }
      if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(unwrap(property.initializer))) return []
      return [{
        name: unwrap(property.initializer).text,
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

function queryFunctionMethod(expression, aliases) {
  const invocation = methodTarget(expression)
  if (!invocation || !["call", "apply"].includes(invocation.method)) return null
  const target = methodTarget(invocation.receiver)
  if (!target || (!target.computed && !["from", "rpc"].includes(target.method))
    || (target.method !== null && !["from", "rpc"].includes(target.method))
    || !isTrustedReceiver(target.receiver, aliases)) return null
  return {
    invocation: invocation.method,
    method: target.method,
    receiver: receiverOrigin(target.receiver, aliases),
  }
}

function sameQueryMethodReference(expression, descriptor, aliases) {
  const target = methodTarget(unwrap(expression))
  return Boolean(target && target.method === descriptor.method
    && sameReceiverOrigin(descriptor.receiver, target.receiver, aliases))
}

function sameMethodAlias(left, right) {
  return Boolean(left && right && left.method === right.method && left.receiver?.origin === right.receiver?.origin
    && Boolean(left.receiver?.unresolved) === Boolean(right.receiver?.unresolved)
    && left.invocation === right.invocation && left.bound === right.bound && left.unresolved === right.unresolved
    && (left.entryArguments?.length ?? 0) === (right.entryArguments?.length ?? 0))
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

function assignReceiverAlias(aliases, name, next, conditional) {
  if (!conditional) {
    if (next) aliases.set(name, next)
    else if (["client", "supabase", "db"].includes(name)) aliases.set(name, { origin: null, unresolved: true })
    else aliases.delete(name)
    return
  }
  const previous = aliases.get(name)
  if (!previous && !next) return
  if (previous && next && previous.origin === next.origin && previous.unresolved === next.unresolved) return
  aliases.set(name, { origin: null, unresolved: true })
}

function aliasProvenanceAt(assignments, use, scope) {
  const aliases = new Map([
    ["client", { origin: "client", unresolved: false }],
    ["supabase", { origin: "supabase", unresolved: false }],
    ["db", { origin: "db", unresolved: false }],
  ])
  const boundMethods = new Map()
  const detachedMethods = new Map()
  const applyAliases = new Map()
  const invocationMethods = new Map()
  for (const assignment of assignments) {
    if (assignment.pos > use.pos) break
    const initializer = unwrap(assignment.initializer)
    const conditional = isConditionalExecution(assignment.node, scope)
    const destructured = destructuredAliasTargets(assignment.target)
    if (destructured.length > 0) {
      const receiver = receiverOrigin(initializer, aliases)
      for (const target of destructured) {
        const detached = receiver && (["from", "rpc"].includes(target.property) || (target.computed && target.property === null))
          ? { method: target.property, receiver }
          : null
        assignOrderedAlias(detachedMethods, target.name, detached, conditional)
        assignOrderedAlias(boundMethods, target.name, null, conditional)
        assignOrderedAlias(applyAliases, target.name, null, conditional)
        assignOrderedAlias(invocationMethods, target.name, null, conditional)
      }
      continue
    }
    if (!ts.isIdentifier(assignment.target)) continue
    const name = assignment.target.text
    const copiedReceiver = ts.isIdentifier(initializer) ? aliases.get(initializer.text) ?? null : null
    assignReceiverAlias(aliases, name, copiedReceiver, conditional)

    const bindAccess = ts.isCallExpression(initializer) && callMethod(initializer) === "bind" ? accessParts(initializer) : null
    const bindTarget = bindAccess ? methodTarget(bindAccess.receiver) : null
    const bound = bindTarget && (["from", "rpc"].includes(bindTarget.method) || (bindTarget.computed && bindTarget.method === null))
      && isTrustedReceiver(bindTarget.receiver, aliases)
      ? {
          method: bindTarget.method,
          receiver: sameTrustedReceiver(bindTarget.receiver, initializer.arguments[0], aliases)
            ? receiverOrigin(bindTarget.receiver, aliases)
            : { origin: null, unresolved: true },
          entryArguments: [...initializer.arguments].slice(1),
        }
      : (ts.isIdentifier(initializer) ? boundMethods.get(initializer.text) ?? null : null)
    assignOrderedAlias(boundMethods, name, bound, conditional)

    const target = methodTarget(initializer)
    const detached = target && (["from", "rpc"].includes(target.method) || (target.computed && target.method === null))
      && isTrustedReceiver(target.receiver, aliases)
      ? { method: target.method, receiver: receiverOrigin(target.receiver, aliases) }
      : (ts.isIdentifier(initializer) ? detachedMethods.get(initializer.text) ?? null : null)
    assignOrderedAlias(detachedMethods, name, detached, conditional)

    const directInvocation = queryFunctionMethod(initializer, aliases)
    const boundInvocation = bindAccess && queryFunctionMethod(bindAccess.receiver, aliases)
    const invocation = directInvocation
      ? { ...directInvocation, bound: false }
      : (boundInvocation && sameQueryMethodReference(initializer.arguments[0], boundInvocation, aliases)
          ? { ...boundInvocation, bound: true }
          : (ts.isIdentifier(initializer) ? invocationMethods.get(initializer.text) ?? null : null))
    assignOrderedAlias(invocationMethods, name, invocation, conditional)

    const directApply = target && target.method === "apply" && rootIdentifier(target.receiver) === "Reflect"
    const boundReflectApply = bindAccess && methodTarget(bindAccess.receiver)?.method === "apply"
      && rootIdentifier(methodTarget(bindAccess.receiver)?.receiver) === "Reflect"
      && rootIdentifier(initializer.arguments[0]) === "Reflect"
    const apply = directApply || boundReflectApply ? { unresolved: false }
      : (ts.isIdentifier(initializer) ? applyAliases.get(initializer.text) ?? null : null)
    assignOrderedAlias(applyAliases, name, apply, conditional)
  }
  return { aliases, boundMethods, detachedMethods, applyAliases, invocationMethods }
}

function reflectedQueryEntry(call, aliases, boundMethods, detachedMethods, applyAliases) {
  const access = accessParts(call)
  const directApply = access?.method === "apply" && rootIdentifier(access.receiver) === "Reflect"
  const applyAlias = ts.isIdentifier(call.expression) ? applyAliases.get(call.expression.text) : null
  const aliasedApply = Boolean(applyAlias)
  if ((!directApply && !aliasedApply) || call.arguments.length !== 3) return null
  const target = unwrap(call.arguments[0])
  const argumentList = unwrap(call.arguments[2])
  const entryArguments = ts.isArrayLiteralExpression(argumentList) && !argumentList.elements.some(ts.isSpreadElement)
    ? [...argumentList.elements]
    : []
  if (ts.isIdentifier(target) && boundMethods.has(target.text)) {
    const bound = boundMethods.get(target.text)
    return { directMethod: bound.method, receiverUnresolved: Boolean(bound.receiver?.unresolved || applyAlias?.unresolved), entryArguments: [...bound.entryArguments, ...entryArguments] }
  }
  if (ts.isIdentifier(target) && detachedMethods.has(target.text)) {
    const detached = detachedMethods.get(target.text)
    return {
      directMethod: detached.method,
      receiverUnresolved: Boolean(applyAlias?.unresolved || !sameReceiverOrigin(detached.receiver, call.arguments[1], aliases)),
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
  if (!isTrustedReceiver(receiver, aliases)) return null
  return { directMethod: targetMethod, receiverUnresolved: Boolean(applyAlias?.unresolved
    || !sameTrustedReceiver(receiver, call.arguments[1], aliases)), entryArguments }
}

function functionInvocationQueryEntry(call, aliases, boundMethods, detachedMethods) {
  const invocation = accessParts(call)
  if (!["call", "apply"].includes(invocation?.method) || call.arguments.length === 0) return null
  const target = unwrap(invocation.receiver)
  let method = null
  let receiver = null
  let isBound = false
  let preboundArguments = []
  if (ts.isIdentifier(target) && boundMethods.has(target.text)) {
    const bound = boundMethods.get(target.text)
    method = bound.method
    isBound = true
    preboundArguments = bound.entryArguments
    receiver = bound.receiver
  } else if (ts.isIdentifier(target) && detachedMethods.has(target.text)) {
    const detached = detachedMethods.get(target.text)
    method = detached.method
    receiver = detached.receiver
  } else if (ts.isPropertyAccessExpression(target) || ts.isElementAccessExpression(target)) {
    method = ts.isPropertyAccessExpression(target)
      ? target.name.text
      : (target.argumentExpression && (ts.isStringLiteral(target.argumentExpression) || ts.isNoSubstitutionTemplateLiteral(target.argumentExpression))
        ? target.argumentExpression.text
        : null)
    const targetReceiver = unwrap(target.expression)
    if (!isTrustedReceiver(targetReceiver, aliases) || (method !== null && !["from", "rpc"].includes(method))) return null
    receiver = receiverOrigin(targetReceiver, aliases)
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
    receiverUnresolved: isBound ? Boolean(receiver?.unresolved) : !sameReceiverOrigin(receiver, call.arguments[0], aliases),
    entryArguments: [...preboundArguments, ...invocationArguments],
  }
}

function aliasedFunctionInvocationEntry(call, aliases, invocationMethods) {
  if (!ts.isIdentifier(call.expression)) return null
  const invocation = invocationMethods.get(call.expression.text)
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
    receiverUnresolved: Boolean(invocation.unresolved || !sameReceiverOrigin(invocation.receiver, thisArgument, aliases)),
    entryArguments,
  }
}

function inlineBoundQueryEntry(call, aliases) {
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
  if (!isTrustedReceiver(receiver, aliases)) return null
  return {
    directMethod: targetMethod,
    receiverUnresolved: !sameTrustedReceiver(receiver, bind.arguments[0], aliases),
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

function isExactTimeoutAbortSignal(call) {
  if (callMethod(call) !== "abortSignal" || call.arguments.length !== 1) return false
  const timeout = unwrap(call.arguments[0])
  if (!ts.isCallExpression(timeout) || timeout.arguments.length !== 1) return false
  const access = accessParts(timeout)
  return access?.method === "timeout" && rootIdentifier(access.receiver) === "AbortSignal"
    && argumentValue(timeout.arguments[0], new Map()) === 8000
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
  return createHash("sha256")
    .update([
      context.previousStatement ?? "<scope-start>",
      context.query,
    ].join("\u0000").replace(/\s+/gu, " "))
    .digest("hex")
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
    const hasSpread = argument && ts.isObjectLiteralExpression(argument) && argument.properties.some((property) => ts.isSpreadAssignment(property))
    const limits = argument && ts.isObjectLiteralExpression(argument) ? argument.properties.filter((property) => ts.isPropertyAssignment(property)
      && ((ts.isIdentifier(property.name) && property.name.text === "p_limit") || (ts.isStringLiteral(property.name) && property.name.text === "p_limit"))) : []
    if (hasSpread) reasons.push("rpc_page_limit_unresolved")
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
    const reflectedEntry = reflectedQueryEntry(call, aliases, boundMethods, detachedMethods, applyAliases)
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
    const functionInvocationEntry = functionInvocationQueryEntry(call, aliases, boundMethods, detachedMethods)
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
    const aliasedFunctionEntry = aliasedFunctionInvocationEntry(call, aliases, invocationMethods)
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
    const inlineBoundEntry = inlineBoundQueryEntry(call, aliases)
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
    const boundMethod = ts.isIdentifier(call.expression) ? boundMethods.get(call.expression.text) : null
    if (boundMethod) {
      const record = {
        entry: call,
        directMethod: boundMethod.method,
        receiverUnresolved: false,
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
    const detachedMethod = ts.isIdentifier(call.expression) ? detachedMethods.get(call.expression.text) : null
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
    const trusted = isTrustedReceiver(access.receiver, aliases)
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
        if (overlapsChangedRange(violation, ranges) && !allowedDebt) violations.push(violation)
    }
  }
  violations.sort((left, right) => exactDebtKey(left).localeCompare(exactDebtKey(right)))
  return {
    ok: violations.length === 0,
    violations: violations.map(publicViolation),
  }
}
