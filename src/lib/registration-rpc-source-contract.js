import { createHash } from "node:crypto"
import ts from "typescript"

// These are contract identities, not name-only pagination exemptions. A caller
// needs the reviewed source closure AND request/result validator boundaries.
export const REGISTRATION_RPC_SOURCE_MANIFEST = "docs/security/registration-nonpageable-rpc-source-contract.json"
export const REGISTRATION_RPC_RUNTIME_MODULE = "src/lib/registration-nonpageable-rpc-contract.js"
export const REGISTRATION_RPC_CALL_SITES = Object.freeze([
  { file: "src/features/tasks/server/registration-contact-command-route.ts", symbol: "submitContactCommand", rpc: "mutate_registration_contact_v1" },
  { file: "src/features/tasks/server/registration-customer-message-bundle-preview-route.ts", symbol: "readBundleContactFence", rpc: "read_registration_contact_message_fence_v1" },
  { file: "src/features/tasks/server/registration-customer-message-bundle-preview-route.ts", symbol: "readBundleSource", rpc: "read_registration_contact_bundle_preview_v1" },
  { file: "src/features/tasks/server/registration-customer-message-route.ts", symbol: "readRegistrationCustomerMessageContactFence", rpc: "read_registration_contact_message_fence_v1" },
].map(Object.freeze))
export const REGISTRATION_RPC_SOURCE_DEPENDENCIES = Object.freeze([
  REGISTRATION_RPC_RUNTIME_MODULE,
  "src/lib/registration-rpc-source-contract.js",
  "src/lib/query-surface-budget.js",
  "scripts/verify-free-tier-query-contracts.mjs",
  ...new Set(REGISTRATION_RPC_CALL_SITES.map(({ file }) => file)),
  "src/features/tasks/server/registration-customer-message-auth.ts",
  "src/features/tasks/server/registration-customer-message-contact-fence.ts",
  "src/features/tasks/server/registration-customer-message-bundle-source.ts",
  "src/features/tasks/registration-contact-client.ts",
  "src/features/tasks/registration-contact-message-policy.ts",
  "docs/security/sql/registration-contact-lifecycle-integration-draft.sql",
  "docs/security/sql/registration-contact-message-fence-draft.sql",
  "tests/registration-contact-command-route.test.mjs",
  "tests/registration-observation-customer-message-route.test.mjs",
  "tests/registration-customer-message-bundle-preview-route.test.mjs",
  "tests/registration-nonpageable-rpc-contract.test.mjs",
  "tests/registration-rpc-source-contract.test.mjs",
  "tests/query-surface-budget.test.mjs",
  "tests/query-surface-imported-constants.test.mjs",
  "tests/free-tier-operational-guardrails.test.mjs",
])
const PARAMETERS = Object.freeze({
  mutate_registration_contact_v1: ["p_actor_id", "p_command", "p_task_id", "p_request_key", "p_expected_generation", "p_expected_revision", "p_payload", "p_request_hmac"],
  read_registration_contact_message_fence_v1: ["p_actor_profile_id", "p_message_kind", "p_source_id"],
  resolve_registration_customer_message_bundle_source_v1: ["p_message_kind", "p_task_id", "p_service_date"],
  read_registration_contact_bundle_preview_v1: ["p_message_kind", "p_task_id", "p_service_date"],
})
const PARAMETER_VALUES = Object.freeze({
  mutate_registration_contact_v1: ["actorId", "command.command", "command.taskId", "command.requestKey", "command.expectedGeneration", "command.expectedRevision", "command.payload", "registrationContactCommandHmac(actorId,command,pepper)"],
  read_registration_contact_message_fence_v1: ["actorProfileId", "messageKind", "sourceId"],
  resolve_registration_customer_message_bundle_source_v1: ["messageKind", "sourceId", "null"],
  read_registration_contact_bundle_preview_v1: ["messageKind", "sourceId", "null"],
})
const SHA = /^[a-f0-9]{64}$/u
const PROOFS = new WeakMap()

export function registrationRpcSourceHash(source) {
  return createHash("sha256").update(source).digest("hex")
}

export function registrationRpcMigrationClosureHash(migrations) {
  return registrationRpcSourceHash([...migrations].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([file, source]) => `${file}\u0000${registrationRpcSourceHash(source)}\n`).join(""))
}

export function isRegistrationNonpageableRpcName(name) {
  return typeof name === "string" && Object.prototype.hasOwnProperty.call(PARAMETERS, name)
}

function sameKeys(value, expected) {
  return value && typeof value === "object" && !Array.isArray(value)
    && Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000")
}

function compactCode(source, file) {
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
  return ts.createPrinter({ removeComments: true }).printFile(parsed).replace(/\s+/gu, "")
}

// Full byte pins include call order and every auth/error branch. These semantic
// anchors additionally prevent issuing a new pin for a name-only mock caller.
const AUTH_ANCHORS = Object.freeze({
  "src/features/tasks/server/registration-contact-command-route.ts": [
    "awaitoptions.auth.authenticate(request)", "![\"admin\",\"staff\"].includes(context.role)",
    "!awaitoptions.auth.authorizeTask(context,command.taskId)",
    "registrationContactCommandHmac(actorId,command,pepper)", "length>128000",
  ],
  "src/features/tasks/server/registration-customer-message-bundle-preview-route.ts": [
    "awaitauth.authenticate(request)", "![\"admin\",\"staff\"].includes(context.role)",
    "!awaitauth.authorizeTask(context,target.sourceId)", "assertRegistrationCustomerMessageContactUse({",
    "sendAllowed:false",
  ],
  "src/features/tasks/server/registration-customer-message-route.ts": [
    "awaitdependencies.authenticate(request)", "requireRole(context,OPERATOR_ROLES)",
    "!awaitdependencies.authorizeTask(context,taskId)", "requireContactUse({",
    "awaitreadContactFence(dependencies,", "awaitdependencies.claimMessage({",
  ],
})

function sqlAnchorsPresent(sources) {
  const lifecycle = sources.get("docs/security/sql/registration-contact-lifecycle-integration-draft.sql") ?? ""
  const fence = sources.get("docs/security/sql/registration-contact-message-fence-draft.sql") ?? ""
  const normalized = lifecycle.replace(/\s+/gu, "")
  const fenceNormalized = fence.replace(/\s+/gu, "")
  return normalized.includes("createfunctionpublic.mutate_registration_contact_v1(p_actor_iduuid,p_commandtext,p_task_iduuid,p_request_keytext,p_expected_generationbigint,p_expected_revisionbigint,p_payloadjsonb,p_request_hmactext)")
    && normalized.includes("auth.role())isdistinctfrom'service_role'")
    && normalized.includes("assert_registration_actor_is_active_manager_v1(p_actor_id)")
    && normalized.includes("assert_registration_mutation_access(p_task_id,null,'update_common')")
    && normalized.includes("octet_length(p_payload::text)>128000")
    && normalized.includes("registration_contact_assert_receipt_v1(")
    && normalized.includes("frompublic,anon,authenticated,service_role;")
    && fenceNormalized.includes("createfunctionpublic.read_registration_contact_message_fence_v1(p_actor_profile_iduuid,p_message_kindtext,p_source_iduuid)")
    && fenceNormalized.includes("registration_customer_message_assert_actor_v1(p_actor_profile_id,task_id,'send')")
    && fenceNormalized.includes("fence->>'taskId'isdistinctfromtask_id::text")
    && fenceNormalized.includes("createorreplacefunctionpublic.resolve_registration_customer_message_bundle_source_v1(p_message_kindtext,p_task_iduuid,p_service_datedatedefaultnull)")
    && fenceNormalized.includes("assert_registration_contact_message_source_v1(p_message_kind,p_task_id,null)")
    && fenceNormalized.includes("contact_bundle_source_legacy_v1(p_message_kind,p_task_id,p_service_date)")
    && fenceNormalized.includes("createfunctionpublic.read_registration_contact_bundle_preview_v1(p_message_kindtext,p_task_iduuid,p_service_datedatedefaultnull)")
}

/** Verifies text only. It does not install SQL, inspect an account or prove DB execution. */
export function verifyRegistrationRpcSourceClosure({ manifest, sources, migrations }) {
  const reasons = []
  if (!sameKeys(manifest, ["version", "assurance", "databaseRuntimeVerified", "sqlApplied", "sourceHashes", "migrationClosure", "contracts"])
    || manifest.version !== 1 || manifest.assurance !== "reviewed-source-contract-only"
    || manifest.databaseRuntimeVerified !== false || manifest.sqlApplied !== false
    || !sameKeys(manifest.sourceHashes, REGISTRATION_RPC_SOURCE_DEPENDENCIES)
    || !sameKeys(manifest.migrationClosure, ["count", "sha256"])
    || !Number.isInteger(manifest.migrationClosure.count) || manifest.migrationClosure.count < 1
    || !SHA.test(manifest.migrationClosure.sha256)
    || JSON.stringify(manifest.contracts) !== JSON.stringify(REGISTRATION_RPC_CALL_SITES)) {
    return { proof: null, reasons: ["registration_rpc_contract_manifest_invalid"] }
  }
  for (const file of REGISTRATION_RPC_SOURCE_DEPENDENCIES) {
    const source = sources.get(file)
    if (typeof source !== "string") reasons.push("registration_rpc_contract_dependency_missing")
    else if (!SHA.test(manifest.sourceHashes[file]) || registrationRpcSourceHash(source) !== manifest.sourceHashes[file]) reasons.push("registration_rpc_contract_source_drift")
  }
  if (migrations.length !== manifest.migrationClosure.count
    || migrations.some(([file, source]) => !/^supabase\/migrations\/[^/]+\.sql$/u.test(file) || typeof source !== "string")
    || registrationRpcMigrationClosureHash(migrations) !== manifest.migrationClosure.sha256) reasons.push("registration_rpc_contract_sql_drift")
  for (const [file, anchors] of Object.entries(AUTH_ANCHORS)) {
    const source = sources.get(file)
    if (typeof source !== "string" || !anchors.every((anchor) => compactCode(source, file).includes(anchor))) reasons.push("registration_rpc_contract_authorization_missing")
  }
  if (!sqlAnchorsPresent(sources)) reasons.push("registration_rpc_contract_sql_scope_invalid")
  if (reasons.length) return { proof: null, reasons: [...new Set(reasons)] }
  const proof = Object.freeze({})
  PROOFS.set(proof, { sources: new Map(sources), manifest: Object.freeze({
    migrationClosure: Object.freeze({ count: manifest.migrationClosure.count, sha256: manifest.migrationClosure.sha256 }),
  }) })
  return { proof, reasons: [] }
}

function unwrap(node) {
  let current = node
  while (current && (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isAwaitExpression(current) || ts.isNonNullExpression(current))) current = current.expression
  return current
}

function directCalls(scope) {
  const calls = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isCallExpression(node)) calls.push(node)
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return calls
}

function unconditionallyInScope(node, scope) {
  for (let ancestor = node.parent; ancestor && ancestor !== scope; ancestor = ancestor.parent) {
    if (ts.isIfStatement(ancestor) || ts.isConditionalExpression(ancestor) || ts.isSwitchStatement(ancestor)
      || ts.isForStatement(ancestor) || ts.isForInStatement(ancestor) || ts.isForOfStatement(ancestor)
      || ts.isWhileStatement(ancestor) || ts.isDoStatement(ancestor) || ts.isTryStatement(ancestor)
      || ts.isBinaryExpression(ancestor) && [ts.SyntaxKind.AmpersandAmpersandToken,
        ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(ancestor.operatorToken.kind)) return false
  }
  return true
}

function publishesBeforeValidation(scope, guard, resultVariable) {
  let premature = false
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isReturnStatement(node) && node.pos < guard.pos && unwrap(node.expression) !== guard) {
      // Preserve PostgREST's error path. Successful data may only leave the
      // helper after its task-bound result validator has run.
      const parent = node.parent
      const statement = ts.isBlock(parent) ? parent.parent : parent
      const errorOnly = resultVariable && ts.isIfStatement(statement)
        && statement.thenStatement === (ts.isBlock(parent) ? parent : node)
        && statement.expression.getText().replace(/\s+/gu, "") === `${resultVariable}.error`
        && node.expression?.getText().replace(/\s+/gu, "") === resultVariable
      if (!errorOnly) premature = true
    }
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return premature
}

function argumentsEscape(scope, name, allowed) {
  let escaped = false
  const visit = (node) => {
    if (ts.isIdentifier(node) && node.text === name && !allowed.has(node)) escaped = true
    ts.forEachChild(node, visit)
  }
  visit(scope)
  return escaped
}

function validatorImports(sourceFile) {
  const expected = ["assertRegistrationNonpageableRpcArguments", "assertRegistrationNonpageableRpcResult"]
  const imported = new Set()
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)
      || statement.moduleSpecifier.text !== "../../../lib/registration-nonpageable-rpc-contract.js") continue
    const bindings = statement.importClause?.namedBindings
    if (!bindings || !ts.isNamedImports(bindings)) continue
    for (const item of bindings.elements) if (!item.propertyName && expected.includes(item.name.text)) imported.add(item.name.text)
  }
  return expected.every((name) => imported.has(name))
}

function validatorShadowed(scope) {
  const names = new Set(["assertRegistrationNonpageableRpcArguments", "assertRegistrationNonpageableRpcResult"])
  let shadowed = false
  const bindingHasName = (node) => {
    if (ts.isIdentifier(node)) return names.has(node.text)
    if (ts.isObjectBindingPattern(node) || ts.isArrayBindingPattern(node)) return node.elements.some((element) => ts.isBindingElement(element) && bindingHasName(element.name))
    return false
  }
  const visit = (node) => {
    if (ts.isImportDeclaration(node)) return
    if ((ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node))
      && node.name && bindingHasName(node.name)) shadowed = true
    ts.forEachChild(node, visit)
  }
  // Module declarations and enclosing scopes can shadow the named import too.
  visit(scope.getSourceFile())
  return shadowed
}

function constDeclaration(scope, name, before) {
  const declarations = []
  const visit = (node) => {
    if (node !== scope && ts.isFunctionLike(node)) return
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) declarations.push(node)
    ts.forEachChild(node, visit)
  }
  visit(scope)
  const declaration = declarations[0]
  return declarations.length === 1 && declaration.end < before && declaration.initializer
    && ts.isVariableDeclarationList(declaration.parent) && (declaration.parent.flags & ts.NodeFlags.Const)
    ? declaration : null
}

/** Contextual contract failures cannot be disguised by adding a fake p_limit. */
export function inspectRegistrationRpcCallContract({ proof, file, symbol, scope, query, rpcName }) {
  if (!isRegistrationNonpageableRpcName(rpcName)) return { applicable: false, valid: false, reasons: [] }
  const site = REGISTRATION_RPC_CALL_SITES.find((candidate) => candidate.file === file && candidate.symbol === symbol && candidate.rpc === rpcName)
  const verified = proof && PROOFS.get(proof)
  const reasons = []
  if (!site) reasons.push("registration_rpc_contract_caller_invalid")
  if (!verified) reasons.push("registration_rpc_contract_unverified")
  else if (verified.sources.get(file) !== scope.getSourceFile().text) reasons.push("registration_rpc_contract_source_drift")
  const sourceFile = scope.getSourceFile()
  if (!validatorImports(sourceFile)) reasons.push("registration_rpc_contract_validator_import_missing")
  if (validatorShadowed(scope)) reasons.push("registration_rpc_contract_validator_shadowed")
  const args = query.entryArguments ?? query.entry.arguments
  if (!ts.isStringLiteral(args[0]) || args[0].text !== rpcName
    || !ts.isPropertyAccessExpression(query.entry.expression) || query.entry.expression.name.text !== "rpc"
    || !ts.isIdentifier(query.entry.expression.expression) || query.entry.expression.expression.text !== "client"
    || !scope.parameters?.some((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === "client"
      && parameter.type?.getText(sourceFile) === "SupabaseClient")) reasons.push("registration_rpc_contract_entry_invalid")
  const argument = args[1] && unwrap(args[1])
  const name = argument && ts.isIdentifier(argument) ? argument.text : null
  const declaration = name && constDeclaration(scope, name, query.entry.pos)
  const initializer = declaration && unwrap(declaration.initializer)
  const properties = initializer && ts.isObjectLiteralExpression(initializer) ? initializer.properties : []
  const keys = properties.map((property) => ts.isPropertyAssignment(property)
    && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) ? property.name.text : null)
  if (!name || !initializer || !ts.isObjectLiteralExpression(initializer) || keys.includes(null)
    || new Set(keys).size !== keys.length || [...keys].sort().join("\u0000") !== [...PARAMETERS[rpcName]].sort().join("\u0000")) reasons.push("registration_rpc_contract_arguments_invalid")
  else if (properties.some((property) => {
    const index = PARAMETERS[rpcName].indexOf(property.name.text)
    return property.initializer.getText(sourceFile).replace(/\s+/gu, "") !== PARAMETER_VALUES[rpcName][index]
  })) reasons.push("registration_rpc_contract_argument_scope_invalid")
  const calls = directCalls(scope)
  const argumentGuards = calls.filter((call) => ts.isIdentifier(call.expression) && call.expression.text === "assertRegistrationNonpageableRpcArguments")
  const resultGuards = calls.filter((call) => ts.isIdentifier(call.expression) && call.expression.text === "assertRegistrationNonpageableRpcResult")
  const request = argumentGuards[0]
  if (argumentGuards.length !== 1 || !request || request.arguments.length !== 2
    || !ts.isStringLiteral(request.arguments[0]) || request.arguments[0].text !== rpcName
    || !ts.isIdentifier(request.arguments[1]) || request.arguments[1].text !== name
    || request.end > query.entry.pos || !unconditionallyInScope(request, scope)) reasons.push("registration_rpc_contract_request_validation_missing")
  const result = resultGuards[0]
  let current = query.entry
  while (current.parent && current.parent !== scope && !ts.isVariableDeclaration(current.parent)) current = current.parent
  const resultVariable = current.parent && ts.isVariableDeclaration(current.parent) && ts.isIdentifier(current.parent.name) ? current.parent.name.text : null
  if (resultGuards.length !== 1 || !result || result.arguments.length !== 3
    || !ts.isStringLiteral(result.arguments[0]) || result.arguments[0].text !== rpcName
    || !ts.isPropertyAccessExpression(result.arguments[1]) || !ts.isIdentifier(result.arguments[1].expression)
    || result.arguments[1].expression.text !== resultVariable || result.arguments[1].name.text !== "data"
    || !ts.isIdentifier(result.arguments[2]) || result.arguments[2].text !== name
    || result.pos < query.entry.end || !unconditionallyInScope(result, scope)
    || publishesBeforeValidation(scope, result, resultVariable)) reasons.push("registration_rpc_contract_result_validation_missing")
  // const freezes the binding, not its object. No writes, alias escapes or
  // unknown helper calls may change the validated object before transport.
  if (name && argumentsEscape(scope, name, new Set([declaration?.name, argument,
    request?.arguments[1], result?.arguments[2]]))) reasons.push("registration_rpc_contract_argument_scope_invalid")
  return { applicable: true, valid: reasons.length === 0, reasons: [...new Set(reasons)] }
}

export function registrationRpcSourceAssurance(proof) {
  const verified = proof && PROOFS.get(proof)
  return verified ? {
    assurance: "reviewed-source-contract-only", databaseRuntimeVerified: false, sqlApplied: false,
    runtimeMockVerification: "separate-required-suite", responseBudgetBytes: 128000,
    rpcCount: 4, activeClientRpcCount: 3, callSiteCount: 4, migrationClosure: verified.manifest.migrationClosure,
  } : null
}
