import { beforeAll,describe,it,expect } from "vitest";
import { createClient,type SupabaseClient } from "@supabase/supabase-js";
import { acceptanceAccount } from "./acceptance";
describe.skipIf(process.env.QB_LIVE_ACCEPTANCE!=="1")("production closure authenticated security",()=>{
  let admin:SupabaseClient,student:SupabaseClient,teacher:SupabaseClient,other:SupabaseClient,anon:SupabaseClient,audit:any;
  beforeAll(async()=>{
    process.loadEnvFile(".env.local");
    const make=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    admin=make();student=make();teacher=make();other=make();anon=make();
    for(const [client,role] of [[admin,"admin"],[student,"student"],[teacher,"teacher"],[other,"student2"]] as const){const login=await client.auth.signInWithPassword(acceptanceAccount(role));if(login.error)throw new Error("ACCEPTANCE_LOGIN_FAILED");}
    const result=await admin.rpc("qb_production_security_audit");expect(result.error).toBeNull();audit=result.data;
  });
  it("inventories every public definer and admits only the public catalogue anonymously",()=>expect(audit.functions.filter((f:any)=>f.anon).map((f:any)=>f.name)).toEqual(["qb_marketplace_catalog"]));
  it("all public tables have RLS",()=>expect(audit.tables.filter((t:any)=>!t.rls)).toEqual([]));
  it("failed attempt starts retain their throttle across HTTP errors",async()=>{const failures=[];for(let i=0;i<21;i++){const result=await other.rpc("qb_start_attempt",{p_assessment_id:"00000000-0000-0000-0000-000000000001",p_assignment_id:null,p_class_id:null,p_client_session_id:"failed-budget-test"});expect(result.error).not.toBeNull();failures.push(result.error?.message);}expect(failures).toContain("QB_RATE_LIMITED");});
  it("signup provisioning trigger is installed",()=>expect(audit.signup_trigger).toBe(true));
  it.each(["qb_admin_platform_overview","qb_admin_content_health","qb_production_security_audit"])("anonymous cannot execute %s",async(name)=>expect((await anon.rpc(name)).error).not.toBeNull());
  it.each(["qb_admin_platform_overview","qb_admin_marketplace_metrics","qb_admin_competition_metrics","qb_admin_operations_health","qb_production_security_audit"])("student cannot execute admin data function %s",async(name)=>expect((await student.rpc(name)).error).not.toBeNull());
  it.each(["qb_get_question_options","qb_get_question_media"])("raw legacy question detail %s is not a browser API",async(name)=>{const id="00000000-0000-0000-0000-000000000001";expect((await anon.rpc(name,{p_question_id:id})).error).not.toBeNull();expect((await student.rpc(name,{p_question_id:id})).error).not.toBeNull();});
  it("existing student provisioning retries preserve identity and role",async()=>{const before=await student.from("student_profiles").select("id,grade").single();expect(before.error).toBeNull();const result=await student.rpc("qb_provision_my_profile",{p_grade:"B9"});expect(result.error).toBeNull();expect(result.data.role).toBe("STUDENT");const after=await student.from("student_profiles").select("id,grade").single();expect(after.data).toEqual(before.data);});
  it("invalid provisioning grade fails",async()=>expect((await student.rpc("qb_provision_my_profile",{p_grade:"ADMIN"})).error).not.toBeNull());
  it("browser cannot choose a privileged provisioning role",async()=>expect((await student.rpc("qb_provision_my_profile",{p_grade:"B7",p_role:"ADMIN"})).error).not.toBeNull());
  it("student cannot save coverage overrides",async()=>expect((await student.rpc("qb_save_coverage_target",{p_curriculum_id:"4af793c2-dffe-4571-93ac-2f130bdacdcc",p_grade:"",p_subject:"",p_minimum:10,p_easy:3,p_medium:4,p_hard:3,p_type_mix:{SINGLE_CHOICE:8,TRUE_FALSE:2}})).error).not.toBeNull());
  it("teacher cannot inspect operational logs",async()=>expect((await teacher.rpc("qb_recent_operations")).error).not.toBeNull());
  it("telemetry drops credential-shaped error messages",async()=>{const r=await student.rpc("qb_operation_failure",{p_operation:"IMPORT",p_code:"password=DO_NOT_STORE"});expect(r.error).toBeNull();const logs=await admin.rpc("qb_recent_operations");expect(logs.error).toBeNull();expect(JSON.stringify(logs.data)).not.toContain("DO_NOT_STORE");});
  it.each([null,0,-1,10001])("rejects results page %s",async(p_page)=>expect((await student.rpc("qb_my_results_page",{p_page,p_limit:25})).error).not.toBeNull());
  it("results history is bounded and learner-owned",async()=>{const result=await student.rpc("qb_my_results_page",{p_page:1,p_limit:25});expect(result.error).toBeNull();expect(result.data.rows.length).toBeLessThanOrEqual(25);const user=await student.auth.getUser();expect(result.data.rows.every((r:any)=>r.student_user_id===user.data.user?.id)).toBe(true);});
  it("attempt history is bounded and contains no answer snapshots",async()=>{const result=await student.rpc("qb_my_attempts_page",{p_page:1,p_limit:25});expect(result.error).toBeNull();expect(result.data.rows.length).toBeLessThanOrEqual(25);expect(JSON.stringify(result.data)).not.toMatch(/correct_answer|answer_spec/);});
  it("student cannot read a teacher roster",async()=>expect((await student.rpc("qb_class_roster_page",{p_class_id:"8ef5da7d-887b-4972-b708-fe698df7336e"})).error).not.toBeNull());
  it("teacher's authorized roster is bounded",async()=>{const result=await teacher.rpc("qb_class_roster_page",{p_class_id:"8ef5da7d-887b-4972-b708-fe698df7336e",p_page:1,p_limit:25});expect(result.error).toBeNull();expect(result.data.rows.length).toBeLessThanOrEqual(25);});
  it("unknown private media remains unreadable",async()=>{expect((await student.rpc("qb_can_read_question_media",{p_path:"validated/private/not-authorized.png"})).data).toBe(false);expect((await student.storage.from("question-media").createSignedUrl("validated/private/not-authorized.png",60)).error).not.toBeNull();});
  it("student cannot attach question media",async()=>expect((await student.rpc("qb_attach_question_media",{p_question_id:"00000000-0000-0000-0000-000000000001",p_asset_id:"00000000-0000-0000-0000-000000000002",p_version:1,p_note:"Denied student attachment"})).error).not.toBeNull());
  it("invalid class-code requests persist a per-user throttle",async()=>{const results=[];const started=Date.now();for(let i=0;i<21;i++)results.push((await other.rpc("qb_join_class",{p_join_code:"DEV_INVALID_CODE"})).data);expect(Date.now()-started).toBeLessThan(60000);expect(results.some((r:any)=>r?.error==="QB_RATE_LIMITED")).toBe(true);expect(results.every((r:any)=>["QB_RATE_LIMITED","INVALID_CLASS_CODE"].includes(r?.error))).toBe(true);});
});
