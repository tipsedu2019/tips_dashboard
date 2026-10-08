import { z } from 'zod';
import { aiSpaceCatalogSchema, aiSpacePermissionSchema, aiPolicyRevisionSchema, aiPolicySpaceKeysSchema } from '../ai-agent-request-contract.ts';
import { AiHttpError, authenticateAiAgent, type AiDependencies } from './ai-agent-auth.ts';
import { throwAiRpcError } from './ai-agent-repository.ts';
import { aiErrorResponse, aiJsonBody, aiQuery, aiResponse, aiWriteKey } from './ai-agent-routes.ts';
import { createAgentResponseContract } from '../../agent-api/server/response-contract.ts';
const uuid=z.uuid();
const revision=aiPolicyRevisionSchema;
const spaces=aiPolicySpaceKeysSchema;
export type AiSpacePolicyRoute={kind:'spaces'}|{kind:'space-permissions';userId:string};
export function createAiAgentSpacePolicyHandler(dependencies:AiDependencies) {
 return async(request:Request,route:AiSpacePolicyRoute):Promise<Response>=>{
  const contract=createAgentResponseContract(request);
  try {
   const principal=await authenticateAiAgent(request,dependencies);
   if(principal.kind!=='user'||route.kind==='space-permissions'&&principal.role!=='admin')throw new AiHttpError(403,'ai_agent_forbidden');
   z.strictObject({}).parse(aiQuery(request));
   if(request.headers.has('x-claim-token')||request.headers.has('x-claim-generation'))throw new AiHttpError(400,'invalid_request');
   let operation:'catalog'|'get'|'set';let input:Record<string,unknown>;
   if(request.method==='GET'){operation=route.kind==='spaces'?'catalog':'get';input=route.kind==='spaces'?{}:{userId:uuid.parse(route.userId)};}
   else if(request.method==='PATCH'&&route.kind==='space-permissions'){
    const idempotencyKey=aiWriteKey(request);const header=request.headers.get('if-match');if(header===null)throw new AiHttpError(428,'ai_agent_precondition_required');
    const expected=revision.parse(/^"r(0|[1-9][0-9]*)"$/.exec(header)?.[1]);
    operation='set';input={userId:uuid.parse(route.userId),revision:expected,idempotencyKey,...z.strictObject({spaceKeys:spaces}).parse(await aiJsonBody(request))};
   }else throw new AiHttpError(405,'method_not_allowed');
   const result=await principal.rpc('ai_agent_space_policy_api_v1',{p_action:operation,p_input:input});if(result.error)throwAiRpcError(result.error);
   const parsed=(operation==='catalog'?aiSpaceCatalogSchema:aiSpacePermissionSchema).safeParse(result.data);if(!parsed.success)throw new AiHttpError(503,'ai_agent_api_unavailable');
   contract.accepted('employee_session');
   return contract.finish(aiResponse(parsed.data));
  }catch(error){return contract.finish(aiErrorResponse(error));}
 };
}
