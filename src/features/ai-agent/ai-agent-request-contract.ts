import { z } from 'zod';

export const AI_REQUEST_STATUSES = ['pending', 'processing', 'question', 'done', 'cancelled'] as const;
// Symbolic slots only; provider resource names and settings never enter this contract.
export const AI_NOTIFICATION_SPACE_KEYS = ['space_1', 'space_2', 'space_3', 'space_4', 'space_5', 'space_6', 'space_7'] as const;
export const AI_CREDENTIAL_SCOPES = ['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update', 'chat:outbox:read', 'chat:send'] as const;
const uuid = z.uuid();
const content = (max: number) => z.string().refine(value => [...value].length <= max && value.trim().length > 0, '내용의 길이를 확인해 주세요');
const space = z.enum(AI_NOTIFICATION_SPACE_KEYS);
const pageSize = z.union([z.literal(10), z.literal(15), z.literal(20)]);
const version = z.string().refine(value => /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= BigInt('9223372036854775807'));
export const aiCreateRequestSchema = z.strictObject({
  title: content(200), body: content(20_000), notifyOnDone: z.boolean().default(false), notificationSpace: space.optional(),
}).refine(input => input.notifyOnDone ? input.notificationSpace !== undefined : input.notificationSpace === undefined, '알림 공간을 확인해 주세요');
export const aiRequestListQuerySchema = z.strictObject({
  page: z.number().int().min(1).max(10_000).default(1), pageSize: pageSize.default(10), scope: z.enum(['own', 'all']).default('own'),
  status: z.enum(AI_REQUEST_STATUSES).optional(), search: z.string().max(200).optional(),
});
export const aiRequestSchema = z.strictObject({
  id: uuid, requesterId: uuid, requesterName: z.string().nullable(), title: content(200), body: content(20_000),
  status: z.enum(AI_REQUEST_STATUSES), version, createdAt: z.iso.datetime({ offset: true }), updatedAt: z.iso.datetime({ offset: true }), readyAt: z.iso.datetime({ offset: true }),
  openQuestionId: uuid.nullable(), result: content(20_000).nullable(), notifyOnDone: z.boolean(), notificationSpace: space.nullable(),
});
export const aiRequestListSchema = z.strictObject({items: z.array(aiRequestSchema), total: z.number().int().nonnegative(), page: z.number().int().positive(), pageSize});
export const aiMessageInputSchema = z.discriminatedUnion('kind', [
  z.strictObject({kind: z.literal('comment'), text: content(5_000)}),
  z.strictObject({kind: z.literal('answer'), questionId: uuid, text: content(5_000)}),
]);
export const aiRequestMessageSchema = z.strictObject({
  id: uuid, requestId: uuid, seq: version, kind: z.enum(['question','answer','comment','progress']), text: content(5_000),
  authorKind: z.enum(['user','bot']), authorId: uuid, questionId: uuid.nullable(), createdAt: z.iso.datetime({offset: true}),
});
export const aiCredentialGrantSchema = z.strictObject({
  queues: z.array(z.literal('employee_requests')).min(1).max(1).optional(),
  actions: z.array(z.enum(['read','claim','renew','progress','question','done'])).min(1).max(6).optional(),
  spaceKeys: z.array(space).min(1).max(7).optional(),
  purposes: z.array(z.enum(['ai_completion','bridge_reply'])).min(1).max(2).optional(),
  bridgeSourceId: uuid.optional(),
}).superRefine((input, ctx) => {
  const ai = input.queues !== undefined || input.actions !== undefined;
  const chat = input.spaceKeys !== undefined || input.purposes !== undefined;
  if (!ai && !chat || ai && (!input.queues || !input.actions) || chat && (!input.spaceKeys || !input.purposes)) ctx.addIssue({code:'custom',message:'명시적인 목적별 권한이 필요합니다'});
  for (const values of [input.queues,input.actions,input.spaceKeys,input.purposes]) if (values && new Set(values).size !== values.length) ctx.addIssue({code:'custom',message:'중복 권한은 허용되지 않습니다'});
  if (Boolean(input.purposes?.includes('bridge_reply')) !== (input.bridgeSourceId !== undefined)) ctx.addIssue({code:'custom',message:'bridge 목적에는 안정적인 source ID가 필요합니다'});
});
export type AiRequest = z.infer<typeof aiRequestSchema>;
export type AiCreateRequest = z.infer<typeof aiCreateRequestSchema>;
export type AiRequestListQuery = z.infer<typeof aiRequestListQuerySchema>;
export type AiMessageInput = z.infer<typeof aiMessageInputSchema>;
export type AiCredentialGrant = z.infer<typeof aiCredentialGrantSchema>;

// Producer contracts for the scoped lifecycle gateway. Bigints stay decimal strings.
export const aiDecimalSchema = version;
const timestamp = z.iso.datetime({offset: true});
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const aiSafeJsonObjectSchema = z.record(z.string(), z.json()).refine(value => !/"(?:claimTokenHash|claimToken|tokenHash|token|nonce|authorization|secret)"\s*:/i.test(JSON.stringify(value)), '비밀값은 DTO에 포함할 수 없습니다');
export const aiMutationRequestSchema = z.union([aiRequestSchema, z.strictObject({id:uuid,status:z.enum(AI_REQUEST_STATUSES),version})]);
export const aiClaimSchema = z.strictObject({generation:version,leaseExpiresAt:timestamp});
export const aiClaimMutationSchema = z.strictObject({request:aiMutationRequestSchema,claim:aiClaimSchema});
export const aiMessageMutationSchema = z.strictObject({request:aiMutationRequestSchema,message:aiRequestMessageSchema});
export const aiDoneMutationSchema = z.strictObject({request:aiMutationRequestSchema});
export const aiActionSchema = z.strictObject({
  id:uuid,requestId:uuid,credentialId:uuid,actionKey:uuid,stepKey:content(100),kind:z.string().regex(/^[a-z][a-z0-9_]{0,79}$/),target:content(500),payload:aiSafeJsonObjectSchema,payloadHash:hash,
  generation:version,revision:version,state:z.enum(['prepared','started','succeeded','failed','unknown','cancelled']),createdAt:timestamp,updatedAt:timestamp,
});
export const aiActionEventSchema = z.strictObject({id:uuid,actionId:uuid,seq:version,kind:z.enum(['prepared','started','cancelled','result','incident','reconciled_manual_observation','reconciled_domain_receipt']),actorKind:z.enum(['user','bot']),actorId:uuid,evidence:aiSafeJsonObjectSchema,createdAt:timestamp});
export const aiRequestEventSchema = z.strictObject({
  id:uuid,requestId:uuid,seq:version,kind:z.enum(['created','claimed','renewed','progress','question','answer','comment','done','cancelled','resumed']),actorKind:z.enum(['user','bot']),actorId:uuid,
  requesterId:uuid,credentialId:uuid.nullable(),issuerId:uuid.nullable(),previousStatus:z.enum(AI_REQUEST_STATUSES).nullable(),nextStatus:z.enum(AI_REQUEST_STATUSES),version,
  metadata:z.strictObject({messageId:uuid.optional(),generation:version.optional(),reviewReason:content(2000).optional(),confirmed:z.literal(true).optional()}),createdAt:timestamp,
});
export const aiNotificationSchema = z.strictObject({intentId:uuid,state:z.enum(['pending','sending','sent','retry_wait','delivery_unknown','failed','cancelled','incident']),reason:z.enum(['space_unconfigured','space_permission_revoked','requester_inactive','request_cancelled','space_configuration_changed','dispatch_lease_expired','success_evidence_missing','provider_resource_mismatch','contradictory_or_old_result','provider_rate_limited','provider_rejected','delivery_unresolved']).nullable(),updatedAt:timestamp});
export const aiActivitySchema = z.strictObject({
  request:aiRequestSchema,claim:aiClaimSchema.extend({leaseState:z.enum(['live','expired'])}).nullable(),messages:z.array(aiRequestMessageSchema).max(50),events:z.array(aiRequestEventSchema).max(50),actions:z.array(aiActionSchema).max(50),notification:aiNotificationSchema.nullable(),nextMessageSeq:version.nullable(),nextEventSeq:version.nullable(),
});
const cursor = z.string().min(1).max(2048);
export const aiBotListSchema = z.strictObject({items:z.array(aiRequestSchema).max(50),nextCursor:cursor.nullable()});
export const aiActionsSchema = z.strictObject({items:z.array(aiActionSchema).max(50),nextCursor:cursor.nullable()});
export const aiActionJournalSchema = z.strictObject({action:aiActionSchema,events:z.array(aiActionEventSchema).max(50),nextCursor:cursor.nullable()});

export const aiPolicyRevisionSchema = z.string().refine(value => /^(0|[1-9][0-9]{0,18})$/.test(value) && BigInt(value) <= BigInt('9223372036854775807'));
export const aiPolicySpaceKeysSchema = z.array(space).max(7).refine(values => new Set(values).size === values.length);
export const aiSpacePermissionSchema = z.strictObject({userId:uuid,spaceKeys:aiPolicySpaceKeysSchema,revision:aiPolicyRevisionSchema,updatedAt:timestamp.nullable()});
export const aiSpaceCatalogSchema = z.strictObject({items:z.array(z.strictObject({key:space,label:content(200),configured:z.boolean(),selectable:z.boolean(),reason:z.enum(['space_not_configured','space_not_allowed']).nullable(),revision:version})).length(7)}).refine(value => new Set(value.items.map(item => item.key)).size === 7);
