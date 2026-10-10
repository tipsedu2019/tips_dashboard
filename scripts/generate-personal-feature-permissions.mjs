import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const registrySource=readFileSync('src/features/agent-api/feature-registry.json','utf8');
const registry=JSON.parse(registrySource);
const policy=Object.fromEntries(registry.filter(f=>f.personal).map(f=>[f.personal.action,{id:f.id,...f.personal}]));
if(Object.keys(policy).length!==registry.filter(f=>f.personal).length) throw Error('duplicate_personal_action');
const source=readFileSync('docs/agents/proposals/personal-connection-lifecycle.sql','utf8');
let metadata=source.slice(source.indexOf('create function dashboard_private.agent_personal_connection_metadata_v1'),source.indexOf('-- Patch only the issuer branch.'));
metadata=metadata.replace('create function','create or replace function').replace("'classes',(select", "'featureIds',c.feature_ids,'featureRevision',c.feature_revision,\n 'classes',(select");
let lifecycle=source.slice(source.indexOf('create function public.agent_personal_connection_v1'),source.lastIndexOf('commit;'));
function replace(before,after){if(!lifecycle.includes(before))throw Error('generator_anchor_missing: '+before);lifecycle=lifecycle.replaceAll(before,()=>after);}
replace("'status','ready','ownerId'","'status','ready','permissionVersion',1,'ownerId'");
replace('create function public.agent_personal_connection_v1','create or replace function public.agent_personal_connection_v1');
replace('catalog_id uuid; row_count integer;','catalog_id uuid; row_count integer; feature_ids text[]; before_features text[]; feature text; policy jsonb:=dashboard_private.agent_personal_feature_policy_v1(); expected_revision integer;');
replace("('snapshot','targets','issue','revoke')","('snapshot','targets','issue','revoke','permissions')");
replace("array['requestId','label','expiresAt','classIds','schoolIds'] else", "array['requestId','label','expiresAt','classIds','schoolIds','featureIds'] when 'permissions' then array['requestId','credentialId','expectedRevision','featureIds'] else");
replace("not in('issue','revoke')","not in('issue','revoke','permissions')");
replace("operation:=jsonb_build_object('requestId',rid,'kind',kind,'state',op.state,'credential'", "operation:=jsonb_build_object('requestId',rid,'kind',kind,'state',op.state,'change',case when op.kind='permissions' and op.state='applied' then jsonb_build_object('beforeFeatures',op.before_features,'afterFeatures',op.after_features,'revision',op.applied_revision) else null end,'credential'");
// Mutation quotas and recovery tombstones use separate bounded budgets.
replace("where owner_id=actor_id and created_at>=clock_timestamp()-interval '1 day')>=100", "where owner_id=actor_id and state='failed' and created_at>=clock_timestamp()-interval '1 day')>=100");
const receipt="jsonb_build_object('change',jsonb_build_object('beforeFeatures',op.before_features,'afterFeatures',op.after_features,'revision',op.applied_revision))";
replace("else '{}'::jsonb end;\n end if;", "when kind='permissions' then "+receipt+" else '{}'::jsonb end;\n end if;");
const validate=` if p_action in('issue','permissions') then
  if jsonb_typeof(p_input->'featureIds') is distinct from 'array' or jsonb_array_length(p_input->'featureIds')>100
   or exists(select 1 from jsonb_array_elements(p_input->'featureIds') x where jsonb_typeof(x)<>'string') then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  select coalesce(array_agg(x order by x),'{}') into feature_ids from jsonb_array_elements_text(p_input->'featureIds') x;
  if cardinality(feature_ids)<>(select count(distinct x) from unnest(feature_ids) x) or exists(select 1 from unnest(feature_ids) x where not exists(select 1 from jsonb_each(policy) p where p.value->>'id'=x)) then raise exception using errcode='22023',message='personal_connection_invalid';end if;
 end if;
`;
replace(" if p_action='issue' then\n",validate+" if p_action='issue' then\n");
replace("  token:='tips_dashboard_personal_'", `  foreach feature in array feature_ids loop
   if (select value->>'target' from jsonb_each(policy) where value->>'id'=feature)='classes' and cardinality(class_ids)=0
    or (select value->>'target' from jsonb_each(policy) where value->>'id'=feature)='schools' and cardinality(school_ids)=0 then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
  end loop;
  before_features:='{}';
  token:='tips_dashboard_personal_'`);
replace('expires_at,issuer_kind)','expires_at,issuer_kind,feature_ids,feature_revision)');
replace("expiry,'self_teacher')", "expiry,'self_teacher',feature_ids,1)");
replace(" else\n  if jsonb_typeof(p_input->'credentialId')", ` elsif p_action='permissions' then
  if jsonb_typeof(p_input->'credentialId') is distinct from 'string' or jsonb_typeof(p_input->'expectedRevision') is distinct from 'number' or coalesce(p_input->>'expectedRevision','')!~'^[0-9]+$' then raise exception using errcode='22023',message='personal_connection_invalid';end if;
  cid:=(p_input->>'credentialId')::uuid;expected_revision:=(p_input->>'expectedRevision')::integer;
  select * into cred from dashboard_private.agent_personal_dashboard_credentials where id=cid and owner_profile_id=actor_id for update;
  if not found then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
  if cred.revoked_at is not null or cred.expires_at<=clock_timestamp() then raise exception using errcode='55000',message='personal_connection_inactive';end if;
  if cred.feature_revision<>expected_revision then raise exception using errcode='55000',message='personal_connection_stale';end if;
  if (select count(*) from dashboard_private.agent_personal_connection_operations where owner_id=actor_id and created_at>=clock_timestamp()-interval '1 day')>=100 then raise exception using errcode='54000',message='personal_connection_change_limit';end if;
  foreach feature in array feature_ids loop
   if (select value->>'target' from jsonb_each(policy) where value->>'id'=feature)='classes' then
    if not 'class-details:read'=any(cred.scopes) or cardinality(cred.class_ids)=0 then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
    -- Retained grants may be temporarily unusable. Enabling a new grant must
    -- revalidate current ownership; every actual read always revalidates it.
    if not feature=any(cred.feature_ids) then
     foreach sid in array cred.class_ids loop
      if not dashboard_private.agent_personal_connection_class_allowed_v1(actor_id,sid) then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
     end loop;
    end if;
   else
    if not 'calendar:read'=any(cred.scopes) or cardinality(cred.school_ids)=0 then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
    if not feature=any(cred.feature_ids) and exists(select 1 from unnest(cred.school_ids) x where not exists(select 1 from public.academic_schools where id=x)) then raise exception using errcode='42501',message='personal_connection_target_forbidden';end if;
   end if;
  end loop;
  before_features:=cred.feature_ids;
  update dashboard_private.agent_personal_dashboard_credentials set feature_ids=feature_ids_placeholder,feature_revision=feature_revision+1 where id=cid returning * into cred;
 else
  if jsonb_typeof(p_input->'credentialId')`);
// Avoid PL/pgSQL variable/column ambiguity with a named block variable.
replace('feature_ids_placeholder',"(select coalesce(array_agg(x order by x),'{}') from jsonb_array_elements_text(p_input->'featureIds') x)");
replace('feature_revision=feature_revision+1','feature_revision=dashboard_private.agent_personal_dashboard_credentials.feature_revision+1');
replace("  update dashboard_private.agent_personal_dashboard_credentials set revoked_at", "  before_features:=cred.feature_ids;\n  update dashboard_private.agent_personal_dashboard_credentials set revoked_at");
replace("insert into dashboard_private.agent_personal_connection_operations(owner_id,request_id,kind,input_hash,state,credential_id) values(actor_id,rid,kind,fingerprint,'applied',cred.id);", "insert into dashboard_private.agent_personal_connection_operations(owner_id,request_id,kind,input_hash,state,credential_id,before_features,after_features,applied_revision) values(actor_id,rid,kind,fingerprint,'applied',cred.id,before_features,cred.feature_ids,cred.feature_revision) returning * into op;");
replace("else '{}'::jsonb end;\nexception", "when p_action='permissions' then "+receipt+" else '{}'::jsonb end;\nexception");
const template=readFileSync('scripts/fixtures/personal-feature-permissions.template.sql','utf8');
export const generated='-- Registry SHA256: '+createHash('sha256').update(registrySource).digest('hex')+'\n'+template.replace('@POLICY@',JSON.stringify(policy).replaceAll("'","''")).replace('@METADATA@',()=>metadata).replace('@LIFECYCLE@',()=>lifecycle);
const target='docs/agents/proposals/personal-feature-permissions.sql';
if(process.argv.includes('--check')){if(readFileSync(target,'utf8')!==generated)throw Error('generated_feature_policy_stale');}
else writeFileSync(target,generated);
