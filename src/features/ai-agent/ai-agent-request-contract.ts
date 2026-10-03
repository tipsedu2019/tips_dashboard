import { z } from 'zod';

export const AI_REQUEST_STATUSES = ['pending', 'processing', 'question', 'done', 'cancelled'] as const;
// Symbolic slots only; provider resource names and settings never enter this contract.
export const AI_NOTIFICATION_SPACE_KEYS = ['space_1', 'space_2', 'space_3', 'space_4', 'space_5', 'space_6', 'space_7'] as const;
export const AI_CREDENTIAL_SCOPES = ['ai-agent:requests:read', 'ai-agent:requests:claim', 'ai-agent:requests:update', 'chat:outbox:read', 'chat:send'] as const;
const uuid = z.uuid();
const content = (max: number) => z.string().refine(value => [...value].length <= max && value.trim().length > 0, '내용의 길이를 확인해 주세요');
const space = z.enum(AI_NOTIFICATION_SPACE_KEYS);
const pageSize = z.union([z.literal(10), z.literal(15), z.literal(20)]);
const version = z.string().regex(/^[1-9][0-9]*$/).refine(value => BigInt(value) <= 9223372036854775807n);
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
