// Explicit action-time support operation; importing this module has no side effects.
import {fileURLToPath} from 'node:url';
import {createClient} from '@supabase/supabase-js';
import {readChatRuntimeEnvironment,chatConfigurationSchema} from '../src/features/chat/server/chat-runtime-configuration.ts';
export function parseChatSyncArguments(args){
 const values={};for(let i=0;i<args.length;i+=2){const name=args[i];if(!['--revision','--idempotency-key','--issuance-enabled'].includes(name)||name in values||!args[i+1])throw new Error('chat_sync_arguments_invalid');values[name]=args[i+1];}
 if(!/^[1-9][0-9]*$/.test(values['--revision']??'')||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(values['--idempotency-key']??'')||!['true','false'].includes(values['--issuance-enabled']))throw new Error('chat_sync_arguments_invalid');
 return {revision:values['--revision'],idempotencyKey:values['--idempotency-key'],issuanceEnabled:values['--issuance-enabled']==='true'};
}
export async function syncChatConfiguration({args,env,rpc}){
 const requested=parseChatSyncArguments(args),runtime=readChatRuntimeEnvironment(env.TIPS_AI_CHAT_ENABLED==='true'?env:{TIPS_AI_CHAT_ENABLED:'false'});
 const desired={issuanceEnabled:requested.issuanceEnabled,publicOrigin:runtime.origin,spaces:Array.from({length:7},(_,i)=>({spaceKey:`space_${i+1}`,resourceName:runtime.slots[i]?.resourceName??null}))};
 const applied=await rpc('ai_agent_chat_configuration_api_v1',{p_action:'sync',p_input:{...requested,...desired}});if(applied.error)throw new Error('chat_sync_failed');chatConfigurationSchema.parse(applied.data);
 const current=await rpc('ai_agent_chat_configuration_api_v1',{p_action:'get',p_input:{}});if(current.error)throw new Error('chat_sync_verification_failed');const snapshot=chatConfigurationSchema.parse(current.data);
 if(snapshot.issuanceEnabled!==desired.issuanceEnabled||snapshot.publicOrigin!==desired.publicOrigin||desired.spaces.some(row=>snapshot.spaces.find(s=>s.spaceKey===row.spaceKey)?.resourceName!==row.resourceName))throw new Error('chat_sync_current_snapshot_mismatch');
 return {revision:snapshot.revision,issuanceEnabled:snapshot.issuanceEnabled,configuredSpaces:snapshot.spaces.filter(s=>s.resourceName!==null).length};
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 const env=process.env;if(!env.NEXT_PUBLIC_SUPABASE_URL||!env.SUPABASE_SERVICE_ROLE_KEY)throw new Error('chat_sync_configuration_missing');
 const client=createClient(env.NEXT_PUBLIC_SUPABASE_URL,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false}});
 syncChatConfiguration({args:process.argv.slice(2),env,rpc:(name,args)=>client.rpc(name,args).abortSignal(AbortSignal.timeout(8000)).retry(false)}).then(result=>process.stdout.write(JSON.stringify(result)+'\n')).catch(()=>{process.stderr.write('chat_sync_failed; inspect current safe configuration before reusing the exact operation key\n');process.exitCode=1;});
}
