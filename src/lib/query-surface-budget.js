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
])

// These are deliberately literal records, not path patterns. Each one binds a
// specific baseline query chain, so moving or duplicating legacy debt is a new
// violation rather than an interchangeable allowance.
function legacyDebt(surface, file, symbol, violation, fingerprint) {
  return Object.freeze({ surface, file, symbol, violation, baselineSha: BASELINE_SHA, fingerprint })
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
  legacyDebt("academic", "src/features/academic/use-academic-workspace-data.ts", "readTable", "list_select_star", "9c4456bfadebd9c19fe3272fc78ee97be5846d526651ff2e7fe1a3992a911b5d"),
  legacyDebt("academic", "src/features/academic/use-academic-workspace-data.ts", "readTable", "list_limit_missing", "9c4456bfadebd9c19fe3272fc78ee97be5846d526651ff2e7fe1a3992a911b5d"),
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
  if (identifier && (aliases.has(identifier) || ["client", "supabase", "db"].includes(identifier))) return true
  return null
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

function receiverAliases(scope) {
  const aliases = new Set(["client", "supabase", "db"])
  const declarations = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  for (const declaration of declarations.sort((left, right) => left.pos - right.pos)) {
    if (isTrustedReceiver(declaration.initializer, aliases)) aliases.add(declaration.name.text)
  }
  return aliases
}

function boundQueryMethods(scope, aliases) {
  const methods = new Map()
  const declarations = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && isImmutableConst(node)) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  ts.forEachChild(scope, visit)
  for (const node of declarations.sort((left, right) => left.pos - right.pos)) {
      const initializer = unwrap(node.initializer)
      const bind = ts.isCallExpression(initializer) && callMethod(initializer) === "bind" ? accessParts(initializer) : null
      const target = bind && (ts.isPropertyAccessExpression(bind.receiver) || ts.isElementAccessExpression(bind.receiver)) ? bind.receiver : null
      const targetMethod = target && (ts.isPropertyAccessExpression(target) ? target.name.text : (ts.isStringLiteral(target.argumentExpression) ? target.argumentExpression.text : null))
      const receiver = target && unwrap(target.expression)
      if (["from", "rpc"].includes(targetMethod) && isTrustedReceiver(receiver, aliases)) methods.set(node.name.text, targetMethod)
      else if (ts.isIdentifier(initializer) && methods.has(initializer.text)) methods.set(node.name.text, methods.get(initializer.text))
  }
  return methods
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
  const reasons = []
  if (query.receiverUnresolved) reasons.push("list_query_receiver_unresolved")
  else if (query.directMethod === null) reasons.push("list_query_method_unresolved")
  if (query.controlFlowUnresolved) reasons.push("list_query_control_flow_unresolved")
  if (query.receiverUnresolved || query.directMethod === null) {
    const fingerprint = createQueryChainFingerprint({ symbol, ordinal: query.ordinal, operations: query.operations })
    const { startLine, endLine } = queryLineSpan(scope, query)
    return reasons.map((reason) => ({ file, symbol, surface, reason, fingerprint, startLine, endLine, ...scopeLineSpan(scope) }))
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
  if (query.directMethod === "rpc") {
    const rpcName = query.entry.arguments[0] && argumentValue(query.entry.arguments[0], constants)
    const exactScalarRpc = typeof rpcName === "string" && EXACT_SCALAR_RPC_NAMES.has(rpcName)
    const argument = query.entry.arguments[1] ? unwrap(query.entry.arguments[1]) : null
    const hasSpread = argument && ts.isObjectLiteralExpression(argument) && argument.properties.some((property) => ts.isSpreadAssignment(property))
    const limits = argument && ts.isObjectLiteralExpression(argument) ? argument.properties.filter((property) => ts.isPropertyAssignment(property)
      && ((ts.isIdentifier(property.name) && property.name.text === "p_limit") || (ts.isStringLiteral(property.name) && property.name.text === "p_limit"))) : []
    if (hasSpread) reasons.push("rpc_page_limit_unresolved")
    else if (limits.length === 0 && !exactScalarRpc) reasons.push("rpc_page_limit_missing")
    for (const limit of limits) {
      const value = argumentValue(limit.initializer, constants)
      if (value === undefined) reasons.push("rpc_page_limit_unresolved")
      else if (typeof value !== "number" || !Number.isInteger(value) || value < 1) reasons.push("rpc_page_limit_invalid")
      else if (value > 30) reasons.push("rpc_page_limit_exceeds_30")
    }
  }
  if (query.directMethod && !isExactTimeoutAbortSignal(finalOperation(query.operations, "abortSignal"))) reasons.push("list_abort_signal_missing")
  const retry = finalOperation(query.operations, "retry")
  if (query.directMethod && !(retry && retry.arguments.length === 1 && retry.arguments[0].kind === ts.SyntaxKind.FalseKeyword)) reasons.push("list_retry_false_missing")
  if (surface === "tasks" && query.directMethod === "from") {
    for (const operation of query.operations.filter((candidate) => callMethod(candidate) === "in")) {
      if (argumentValue(operation.arguments[0], constants) === "task_id") reasons.push("task_id_batch_in_list")
      else if (argumentValue(operation.arguments[0], constants) === undefined) reasons.push("task_in_column_unresolved")
    }
  }
  const fingerprint = createQueryChainFingerprint({ symbol, ordinal: query.ordinal, operations: query.operations })
  const { startLine, endLine } = queryLineSpan(scope, query)
  return reasons.map((reason) => ({ file, symbol, surface, reason, fingerprint, startLine, endLine, ...scopeLineSpan(scope) }))
}

function analyzeScope({ surface, file, scope, symbol }) {
  const aliases = receiverAliases(scope)
  const boundMethods = boundQueryMethods(scope, aliases)
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
    const boundMethod = ts.isIdentifier(call.expression) ? boundMethods.get(call.expression.text) : null
    if (boundMethod) {
      const record = { entry: call, directMethod: boundMethod, receiverUnresolved: false, ordinal: records.length, operations: queryOperations(call) }
      records.push(record)
      const name = assignmentName(call)
      if (name) {
        record.controlFlowUnresolved = isConditionalExecution(call, scope)
        queryAliases.set(name, record)
      }
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
  const manifestDebt = new Set()
  for (const entry of debtManifest.filter((candidate) => surfaces.includes(candidate.surface))) {
    if (!entry || typeof entry.file !== "string" || typeof entry.symbol !== "string" || typeof entry.violation !== "string"
      || typeof entry.baselineSha !== "string" || typeof entry.fingerprint !== "string" || !/^[0-9a-f]{40}$/u.test(entry.baselineSha)
      || !/^[0-9a-f]{64}$/u.test(entry.fingerprint)) throw queryBudgetError("query_surface_debt_manifest_invalid")
    const manifestBaseline = await sourceAt({ root, file: entry.file, revision: entry.baselineSha, includeWorktree: false })
    if (manifestBaseline === null) {
      throw queryBudgetError("query_surface_debt_manifest_invalid")
    }
    const baselineKey = exactDebtKey({ surface: entry.surface, file: entry.file, symbol: entry.symbol, reason: entry.violation, fingerprint: entry.fingerprint })
    if (!countedViolations(manifestBaseline, entry.surface, entry.file).has(baselineKey)) {
      throw queryBudgetError("query_surface_debt_manifest_invalid")
    }
    manifestDebt.add(baselineKey)
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
    for (const violation of inspectQuerySurfaceSource({ surface: owner, file, source })) {
        const key = exactDebtKey(violation)
        const allowedDebt = manifestDebt.has(key) && baseDebt.has(key)
        if (overlapsChangedRange(violation, ranges) && !allowedDebt) violations.push(violation)
    }
  }
  violations.sort((left, right) => exactDebtKey(left).localeCompare(exactDebtKey(right)))
  return {
    ok: violations.length === 0,
    violations: violations.map(publicViolation),
  }
}
