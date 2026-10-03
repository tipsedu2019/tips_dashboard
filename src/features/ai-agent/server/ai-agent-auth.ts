import { createHash } from 'node:crypto';
export type AiRpcResult = {data:unknown;error:unknown};
export type AiRpc = (name:string,input?:Record<string,unknown>) => PromiseLike<AiRpcResult>;
export type AiEmployeeClient = {auth:{getUser:(token:string)=>PromiseLike<{data:{user:{id:string}|null};error:unknown}>};rpc:AiRpc};
export type AiDependencies = {employeeClient:(token:string)=>AiEmployeeClient;botRpc:AiRpc};
export type AiPrincipal = {kind:'user';id:string;role:'admin'|'staff'|'teacher'|'assistant';rpc:AiRpc}|{kind:'bot';tokenHash:string;rpc:AiRpc};
export class AiHttpError extends Error {
  status:number;
  constructor(status:number,code:string){super(code);this.status=status;}
}
export async function authenticateAiAgent(request:Request,dependencies:AiDependencies):Promise<AiPrincipal> {
  const token=/^Bearer ([^\s]+)$/.exec(request.headers.get('authorization') ?? '')?.[1];
  if(!token) throw new AiHttpError(401,'ai_agent_unauthorized');
  if(token.startsWith('tips_agent_')) {
    if(!/^tips_agent_[a-f0-9]{64}$/.test(token)) throw new AiHttpError(401,'ai_agent_unauthorized');
    return {kind:'bot',tokenHash:createHash('sha256').update(token).digest('hex'),rpc:dependencies.botRpc};
  }
  const client=dependencies.employeeClient(token);
  const result=await client.auth.getUser(token);
  if(result.error || !result.data.user?.id) throw new AiHttpError(401,'ai_agent_unauthorized');
  const role=await client.rpc('current_dashboard_role');
  if(role.error || !['admin','staff','teacher','assistant'].includes(String(role.data))) throw new AiHttpError(403,'ai_agent_forbidden');
  return {kind:'user',id:result.data.user.id,role:role.data as Extract<AiPrincipal,{kind:'user'}>['role'],rpc:(name,input)=>client.rpc(name,input)};
}
