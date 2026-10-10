import { featureForRoute } from "../feature-registry.ts";
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { getRoleCapabilities } from '../../../lib/auth-utils.ts';
import { editWindow } from './class-edit-contract.ts';
import { classWorkspace } from './class-edit-compiler.mjs';
import { calendarYear } from './calendar-contract.ts';
import { calendarWorkspace } from './calendar-compiler.mjs';
import { HttpError, errorStatus, knownCodes, record, response, type AgentRpc } from './http.ts';
import { createAgentResponseContract } from './response-contract.ts';

// A separate credential audience: an inbox key never becomes a business key.
export const PERSONAL_DASHBOARD_READ_KIND = 'personal_dashboard_read' as const;
const uuid = z.uuid();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const text = z.string().max(500);
const school = z.object({ id: uuid, name: text, category: text }).strict();
const nullableId = uuid.nullable();
const authorization = z.object({
  credentialId: uuid, credentialKind: z.literal(PERSONAL_DASHBOARD_READ_KIND),
  ownerProfileId: uuid, ownerRole: z.literal('teacher'),
  scope: z.enum(['class-details:read', 'calendar:read']),
}).strict();
const weeklySlot = z.object({
  id: uuid, weekday: z.number().int().min(0).max(6),
  startMinute: z.number().int().min(0).max(1439), endMinute: z.number().int().min(1).max(1440),
  teacherId: uuid, classroomId: nullableId, sortOrder: z.number().int().min(0),
}).strict().refine(value => value.endMinute > value.startMinute);
const session = z.object({
  id: uuid, session_date: z.iso.date(), schedule_state: z.enum(['active', 'exception', 'makeup', 'skipped', 'tbd']),
  start_time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).nullable(),
  end_time: z.string().regex(/^\d{2}:\d{2}(?::\d{2})?$/).nullable(),
  teacher_catalog_id: nullableId, classroom_catalog_id: nullableId,
  source_schedule_slot_id: nullableId, makeup_of_session_id: nullableId,
}).strict();
const classContext = z.object({
  id: uuid, version: digest,
  basic: z.object({ name: text, classType: text.nullable(), subject: text.nullable(), subjectAreaKey: text.nullable(), grade: text.nullable() }).strict(),
  storageMode: z.literal('normalized'), schedule: z.string().max(10000),
  weeklySlots: z.array(weeklySlot).max(50),
  plan: z.object({}).strict(), sessions: z.array(session).max(2500),
  catalogs: z.object({ teachers: z.array(z.never()).max(0), classrooms: z.array(z.never()).max(0) }).strict(),
  weeklyScheduleComplete: z.boolean(),
}).strict();
const calendarContext = z.object({
  school, schoolYear: calendarYear, version: digest,
  events: z.array(z.object({ id: uuid, title: text, type: text, date: z.iso.date(), grade: text.nullable() }).strict()).max(2500),
  scienceAreas: z.array(z.string().max(100)).max(100),
}).strict();
const schoolsContext = z.object({ items: z.array(school).max(20), total: z.number().int().min(0), page: z.number().int().min(1), pageSize: z.literal(20) }).strict()
  .refine(value => new Set(value.items.map(item => item.id)).size === value.items.length && value.items.length <= Math.max(0, value.total - (value.page - 1) * 20));
export const personalDashboardReadProducerSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('class'), authorization, resource: z.object({ kind: z.literal('class'), id: uuid }).strict(), context: classContext }).strict(),
  z.object({ kind: z.literal('calendar'), authorization, resource: z.object({ kind: z.literal('calendar'), id: uuid, schoolYear: calendarYear }).strict(), context: calendarContext }).strict(),
  z.object({ kind: z.literal('schools'), authorization, resource: z.object({ kind: z.literal('schools') }).strict(), context: schoolsContext }).strict(),
]);

// Recognize even a malformed personal-family header, so it cannot fall back to
// a central issuer's gateway. No existing token is converted or reclassified.
export function isPersonalDashboardReadAuthorization(request: Request): boolean {
  return /^Bearer tips_dashboard_personal_/u.test(request.headers.get('authorization') ?? '');
}

export function createPersonalDashboardReadHandler(dependencies: { enabled: () => boolean; rpc: AgentRpc }) {
  return async (request: Request, path: string[]): Promise<Response> => {
    const contract = createAgentResponseContract(request);
    const reply = (body: unknown, status = 200) => contract.finish(response(body, status), body);
    try {
      if (!dependencies.enabled()) throw new HttpError(503, 'agent_api_disabled');
      const token = /^Bearer (tips_dashboard_personal_[a-f0-9]{64})$/u.exec(request.headers.get('authorization') ?? '')?.[1];
      if (!token) throw new HttpError(401, 'agent_unauthorized');
      // Personal writes, catalogs, receipt replay and other APIs are unsupported.
      const feature = featureForRoute(2, request.method, path);
      if (!feature?.personal) throw new HttpError(403, 'agent_scope_forbidden');
      const query = new URL(request.url).searchParams;
      if (new Set(query.keys()).size !== [...query.keys()].length) throw new HttpError(400, 'invalid_request');
      const raw = Object.fromEntries(query);
      let action: 'class_context' | 'calendar_context' | 'schools';
      let input: Record<string, unknown>;
      let window: z.infer<typeof editWindow> | undefined;
      if (path.length === 2 && path[0] === 'classes') {
        window = editWindow.parse(raw);
        action = 'class_context'; input = { classId: uuid.parse(path[1]) };
      } else if (path.join('/') === 'calendar/schools') {
        action = 'schools'; input = z.object({ search: z.string().max(100).default(''), page: z.coerce.number().int().min(1).max(10000).default(1) }).strict().parse(raw);
      } else if (path.length === 3 && path[0] === 'calendar' && path[1] === 'schools') {
        action = 'calendar_context'; input = { ...z.object({ schoolYear: z.coerce.number().pipe(calendarYear) }).strict().parse(raw), schoolId: uuid.parse(path[2]) };
      } else throw new HttpError(403, 'agent_scope_forbidden');

      if (feature.personal.action !== action) throw new HttpError(403, 'agent_scope_forbidden');

      // Only the DB callback can resolve the stored owner and current row grant.
      // Never call agent_api_v2/agent_calendar_api_v1 using an issuing admin.
      const result = await dependencies.rpc('agent_personal_dashboard_read_v1', {
        p_token_hash: createHash('sha256').update(token).digest('hex'), p_action: action, p_input: input,
      });
      const rpcError = record(result.error), envelope = record(result.data), error = rpcError ?? record(envelope?.error);
      if (error) {
        const code = String(rpcError ? error.message : error.code);
        if (knownCodes.has(code)) throw new HttpError(errorStatus(code), code);
        if (['22023', '22P02', '22007', '22008'].includes(String(error.code))) throw new HttpError(422, 'agent_invalid');
        throw new HttpError(503, 'agent_api_unavailable');
      }
      const data = record(envelope?.data);
      // `kind` is derived from the requested route, never from caller input.
      const kind = action === 'class_context' ? 'class' : action === 'calendar_context' ? 'calendar' : 'schools';
      if (data && Object.prototype.hasOwnProperty.call(data, 'kind')) throw new HttpError(503, 'agent_api_unavailable');
      const parsed = personalDashboardReadProducerSchema.safeParse({ ...data, kind });
      if (!parsed.success) throw new HttpError(503, 'agent_api_unavailable');
      const proof = parsed.data;
      if (!getRoleCapabilities(proof.authorization.ownerRole).canAccessDashboard
        || proof.authorization.scope !== (kind === 'class' ? 'class-details:read' : 'calendar:read')) throw new HttpError(503, 'agent_api_unavailable');
      let outgoing: unknown;
      if (proof.kind === 'class') {
        if (!window || proof.resource.id !== input.classId || proof.context.id !== input.classId) throw new HttpError(503, 'agent_api_unavailable');
        const projected = classWorkspace(proof.context, window);
        outgoing = { ...projected, capabilities: { ...projected.capabilities, basic: false, existingWeeklySlots: false, datedLessons: false, readOnly: true } };
      } else if (proof.kind === 'calendar') {
        if (proof.resource.id !== input.schoolId || proof.context.school.id !== input.schoolId
          || proof.resource.schoolYear !== input.schoolYear || proof.context.schoolYear !== input.schoolYear) throw new HttpError(503, 'agent_api_unavailable');
        outgoing = { ...calendarWorkspace(proof.context), capabilities: { readOnly: true, preview: false, commit: false } };
      } else {
        if (proof.context.page !== input.page) throw new HttpError(503, 'agent_api_unavailable');
        outgoing = proof.context;
      }
      // Authenticated private output is uncached; every retry reruns the callback.
      contract.accepted('personal_dashboard_read');
      return reply({ data: outgoing, error: null });
    } catch (error) {
      if (error instanceof z.ZodError) return reply({ data: null, error: { code: 'invalid_request' } }, 400);
      if (error instanceof HttpError) return reply({ data: null, error: { code: error.message } }, error.status);
      return reply({ data: null, error: { code: 'agent_api_unavailable' } }, 503);
    }
  };
}
