import assert from "node:assert/strict";
import test from "node:test";
import { createPublicClassesSupabaseClient, buildPublicClassesPayload } from "../src/server/public-classes-payload.js";
import { loadSuccessfulPublicClassSummary } from "../src/server/public-classes-cache.js";
import { createPublicClassesDiagnosticFetch } from "../src/server/public-classes-diagnostics.js";

const privateText = "PRIVATE_STUDENT https://example.invalid/?token=SECRET";
const env = { SUPABASE_URL: "https://fixture.invalid", SUPABASE_SERVICE_ROLE_KEY: "fixture-key" };
function client(fetch, events) {
  return createPublicClassesSupabaseClient(env, { fetch, onFailure: event => events.push(event) });
}
function assertBoundary(payload, events) {
  assert.equal(payload.source, "fallback-empty");
  assert.deepEqual(payload.classes, []);
  assert.doesNotMatch(JSON.stringify({ payload, events }), /PRIVATE_STUDENT|SECRET|fixture-key|https?:|<html>/);
  assert.equal(events.length, 1);
  assert.ok(Number.isFinite(events[0].durationMs) && events[0].durationMs >= 0);
}
test("summary failure retains safe SQLSTATE and HTTP status without private error details", async () => {
  const events = [];
  const payload = await buildPublicClassesPayload({env:{},mode:"summary",supabaseClient:client(async()=>new Response(JSON.stringify({code:"42501",message:privateText,details:privateText,hint:privateText}),{status:403,headers:{"content-type":"application/json"}}),events)});
  assertBoundary(payload, events);
  assert.deepEqual({...events[0],durationMs:0},{event:"public_classes_read_failed",phase:"query",table:"classes",status:403,code:"42501",kind:"upstream",durationMs:0});
});
for (const [name, fetch, expected] of [
  ["gateway HTML", async()=>new Response("<html>"+privateText+"</html>",{status:522}), {status:522,code:null,kind:"upstream"}],
  ["timeout", async()=>{throw new DOMException(privateText,"TimeoutError");}, {status:null,code:null,kind:"timeout"}],
  ["aborted transport", async()=>{throw new DOMException(privateText,"AbortError");}, {status:null,code:null,kind:"aborted"}],
  ["network failure", async()=>{throw new TypeError(privateText,{cause:{code:"ENOTFOUND",message:privateText}});}, {status:null,code:null,kind:"network"}],
  ["malicious error code", async()=>new Response(JSON.stringify({code:privateText,message:privateText}),{status:400,headers:{"content-type":"application/json"}}), {status:400,code:null,kind:"upstream"}],
]) {
  test(name+" is diagnosed before SDK normalization discards transport context",async()=>{
    const events=[];
    const payload=await buildPublicClassesPayload({env:{},mode:"summary",supabaseClient:client(fetch,events)});
    assertBoundary(payload,events);
    assert.deepEqual({status:events[0].status,code:events[0].code,kind:events[0].kind},expected);
  });
}
test("successful empty read is unchanged, is not logged, and retains timeout and authorization",async()=>{
  const events=[];
  const payload=await buildPublicClassesPayload({env:{},mode:"summary",supabaseClient:client(async(input,init)=>{
    assert.equal(new URL(input).pathname,"/rest/v1/classes");
    assert.equal(init.method,"GET");
    assert.ok(init.signal instanceof AbortSignal);
    assert.equal(new Headers(init.headers).get("apikey"),"fixture-key");
    assert.equal(new Headers(init.headers).get("authorization"),"Bearer fixture-key");
    return new Response("[]",{status:200});
  },events)});
  assert.equal(payload.source,"supabase");
  assert.deepEqual(payload.classes,[]);
  assert.deepEqual(events,[]);
});
test("cached summary still rejects failures after safe diagnosis",async()=>{
  const events=[];
  await assert.rejects(loadSuccessfulPublicClassSummary({env:{},supabaseClient:client(async()=>new Response(JSON.stringify({code:"PGRST205",message:privateText}),{status:404,headers:{"content-type":"application/json"}}),events)}),/public_classes_summary_unavailable/);
  assert.equal(events.length,1);
  assert.equal(events[0].code,"PGRST205");
});
test("full compatibility reads identify the failed supporting table",async()=>{
  const events=[];
  const payload=await buildPublicClassesPayload({env:{},mode:"full",supabaseClient:client(async input=>new URL(input).pathname.endsWith("/textbooks")?new Response(JSON.stringify({code:"42703",message:privateText}),{status:400,headers:{"content-type":"application/json"}}):new Response("[]",{status:200}),events)});
  assertBoundary(payload,events);
  assert.equal(events[0].table,"textbooks");
  assert.equal(events[0].code,"42703");
});
test("diagnostic sink failure cannot replace the SDK fallback",async()=>{
  const supabaseClient=createPublicClassesSupabaseClient(env,{fetch:async()=>new Response("unavailable",{status:503}),onFailure:()=>{throw new Error(privateText);}});
  const payload=await buildPublicClassesPayload({env:{},mode:"summary",supabaseClient});
  assert.equal(payload.source,"fallback-empty");
  assert.doesNotMatch(JSON.stringify(payload),/PRIVATE_STUDENT|SECRET/);
});
test("invalid configuration uses the safe default console sink", t=>{
  const events=[];
  t.mock.method(console,"error",(...args)=>events.push(args));
  assert.equal(createPublicClassesSupabaseClient({SUPABASE_URL:privateText,SUPABASE_SERVICE_ROLE_KEY:"fixture-key"}),null);
  assert.equal(events.length,1);
  assert.equal(events[0][1].phase,"config");
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_STUDENT|SECRET|fixture-key|https?:/);
});

test("diagnostics cannot consume the SDK response or buffer an oversized error",async()=>{
  const events=[];
  const body=JSON.stringify({code:"42501",message:privateText.repeat(500)});
  const original=new Response(body,{status:403,headers:{"content-type":"application/json"}});
  const diagnostic=createPublicClassesDiagnosticFetch(async()=>original,event=>events.push(event));
  const response=await diagnostic.fetch("https://fixture.invalid/rest/v1/classes?private=SECRET",{method:"GET"});
  assert.equal(response,original);
  assert.equal(await response.text(),body);
  assert.equal(events[0].code,null);
  assert.doesNotMatch(JSON.stringify(events),/PRIVATE_STUDENT|SECRET/);
});

test("a stalled error-body copy cannot hang response delivery",{timeout:3000},async()=>{
  const events=[];
  let controller;
  const original=new Response(new ReadableStream({start(value){controller=value;}}),{status:503,headers:{"content-type":"application/json"}});
  try {
    const diagnostic=createPublicClassesDiagnosticFetch(async()=>original,event=>events.push(event));
    assert.equal(await diagnostic.fetch("https://fixture.invalid/rest/v1/classes",{method:"GET"}),original);
    assert.equal(events[0].status,503);
    assert.equal(events[0].code,null);
  } finally {
    controller.close();
    await original.body.cancel();
  }
});

test("the original transport exception is rethrown unchanged",async()=>{
  const original=new TypeError(privateText);
  const events=[];
  const diagnostic=createPublicClassesDiagnosticFetch(async()=>{throw original;},event=>events.push(event));
  await assert.rejects(diagnostic.fetch("https://fixture.invalid/rest/v1/classes",{method:"GET"}),error=>error===original);
  assert.equal(events[0].kind,"network");
});
