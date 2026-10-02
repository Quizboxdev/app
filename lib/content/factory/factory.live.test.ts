import { beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { pilotBatch, PILOT_CODES } from "./pilot";
import type { CurriculumNode } from "./contract";
import { acceptanceAccount } from "../../operations/acceptance";

describe.skipIf(process.env.QB_LIVE_ACCEPTANCE!=="1")("authenticated editorial and security acceptance", () => {
  let admin:SupabaseClient,student:SupabaseClient,teacher:SupabaseClient,other:SupabaseClient;
  let batch:any, question:any, original:any;
  let mediaAsset:string|undefined;
  const detail = async () => { const result=await admin.rpc("qb_content_detail",{p_id:question.id}); expect(result.error).toBeNull(); return result.data; };
  const review = async (action:string, human=false, patch={}) => admin.rpc("qb_content_review",{p_id:question.id,p_action:action,p_version:question.version,p_expected_state:question.validation_status,p_patch:patch,p_note:"Controlled DEV_FACTORY_PILOT workflow acceptance only; not production academic approval.",p_human_reviewed:human});
  beforeAll(async () => {
    process.loadEnvFile(".env.local");
    const make=()=>createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
    admin=make(); student=make(); teacher=make(); other=make();
    for(const [client,role] of [[admin,"admin"],[student,"student"],[teacher,"teacher"],[other,"student2"]] as const) {
      const login=await client.auth.signInWithPassword(acceptanceAccount(role)); if(login.error) throw new Error("ACCEPTANCE_LOGIN_FAILED");
    }
    const result=await admin.from("curriculum_nodes").select("*").in("code",PILOT_CODES);
    expect(result.error).toBeNull();
    const selected=(result.data as CurriculumNode[]).filter((n)=>n.code===({Computing:PILOT_CODES[0],Mathematics:PILOT_CODES[1],Science:PILOT_CODES[2]} as Record<string,string>)[n.subject_code!]);
    expect(selected).toHaveLength(3);
    for(const node of selected) {
      const input=pilotBatch(node);
      const response=await admin.rpc("qb_content_ingest",{p_spec:input.spec,p_candidates:input.candidates,p_source_file:"dev-factory-pilot-"+node.subject_code+".json",p_provider:"local-sample",p_model:"controlled-v1"});
      if(response.error) throw new Error(response.error.message);
      if(node.subject_code==="Computing") batch=response.data;
    }
    const queue=await admin.rpc("qb_content_queue",{p_filters:{batch:batch.batch_id},p_page:1,p_limit:25});
    expect(queue.error).toBeNull(); question=queue.data.rows.find((q:any)=>q.answer_type==="SINGLE_CHOICE");
    original=await detail();
    // Repeatable reset is scoped to the labeled pilot; real editorial records are never touched.
    await review("review"); question=(await detail()).question;
  },30000);
  it("ingests mapped local pilot samples without auto-approval", async () => {
    const {data,error}=await admin.from("content_import_batches").select("valid_records,rejected_records,report").eq("id",batch.batch_id).single();
    expect(error).toBeNull(); expect(data?.valid_records).toBe(3); expect(data?.rejected_records).toBe(1); expect(data?.report.auto_approved).toBe(0);
  });
  it("preserves rejected candidates only in staging", async () => { const r=await admin.from("question_import_staging").select("issues,imported_question_id").eq("import_batch_id",batch.batch_id).eq("classification","rejected"); expect(r.error).toBeNull(); expect(r.data).toHaveLength(1); expect(r.data?.[0].imported_question_id).toBeNull(); });
  it("replays ingestion without duplicate writes", async () => { const n=original.mapping; const input=pilotBatch(n); const r=await admin.rpc("qb_content_ingest",{p_spec:input.spec,p_candidates:input.candidates,p_source_file:"dev-factory-pilot-Computing.json",p_provider:"local-sample",p_model:"controlled-v1"}); expect(r.error).toBeNull(); expect(r.data.replayed).toBe(true); expect(r.data.batch_id).toBe(batch.batch_id); });
  it("flags exact duplicates in the live queue", async () => { const r=await admin.rpc("qb_content_queue",{p_filters:{batch:batch.batch_id},p_page:1,p_limit:25}); expect(r.data.rows.some((q:any)=>q.duplicate_group_id)).toBe(true); });
  it("denies student editorial queue and details", async () => { for(const name of ["qb_content_queue","qb_content_detail"]) expect((await student.rpc(name,name.endsWith("detail")?{p_id:question.id}:{})).error).not.toBeNull(); });
  it("denies teacher approval of platform content", async () => expect((await teacher.rpc("qb_content_review",{p_id:question.id,p_action:"approve",p_version:question.version,p_expected_state:"review",p_patch:{},p_note:"Unauthorized approval probe",p_human_reviewed:true})).error?.message).toBe("QB_CONTENT_ACCESS_DENIED"));
  it("blocks raw student answer columns and editorial versions", async () => { expect((await student.from("questions").select("correct_answer,answer_spec").limit(1)).error).not.toBeNull(); const versions=await student.from("question_versions").select("id").limit(1); expect(versions.error).toBeNull(); expect(versions.data).toEqual([]); });
  it("returns no raw questions to students under RLS", async () => { const r=await student.from("questions").select("id").limit(10); expect(r.error).toBeNull(); expect(r.data).toEqual([]); });
  it("blocks raw answer-bearing assessment snapshots", async () => { const r=await student.from("assessment_questions").select("correct_answer_snapshot,answer_spec_snapshot").limit(1); expect(r.data ?? []).toEqual([]); });
  it("rejects hidden answer keys in rich-content metadata on the server", async () => {
    const candidate=pilotBatch(original.mapping).candidates[0];
    const r=await admin.rpc("qb_content_validation_errors",{p:{...candidate,question_content:{blocks:[{type:"text",text:"Question",answer_spec:{correct:"A"}}]}}});
    expect(r.error).toBeNull(); expect(r.data).toContain("UNSAFE_CONTENT");
  });
  it.each([
    {answer_type:"NUMERIC",answer_spec:{value:2,tolerance:-1}},
    {answer_type:"SHORT_TEXT",answer_spec:{accepted:[]}},
    {answer_type:"EXPRESSION",answer_spec:{value:"x+1"}},
    {answer_type:"MULTIPLE_CHOICE",answer_spec:{correct_options:["A","A"]}},
  ])("rejects answer specifications incompatible with grading %j", async (patch) => {
    const candidate=pilotBatch(original.mapping).candidates[0];
    const r=await admin.rpc("qb_content_validation_errors",{p:{...candidate,...patch}});
    expect(r.error).toBeNull(); expect(r.data).toContain("INVALID_ANSWER_SPEC");
  });
  it("rejects unsafe LaTeX commands on the server", async () => {
    const candidate=pilotBatch(original.mapping).candidates[0];
    const r=await admin.rpc("qb_content_validation_errors",{p:{...candidate,question_content:{blocks:[{type:"math",latex:String.fromCharCode(92)+"href{https://example.test}{link}"}]}}});
    expect(r.error).toBeNull(); expect(r.data).toContain("UNSAFE_CONTENT");
  });
  it("prevents self-promotion to ADMIN", async () => { const uid=(await student.auth.getUser()).data.user!.id; expect((await student.from("profiles").update({role:"ADMIN"}).eq("id",uid)).error).not.toBeNull(); });
  it("denies direct attempt/result mutation", async () => { for(const table of ["attempts","assessment_results"]) expect((await student.from(table).update({status:"submitted"}).eq("id",crypto.randomUUID())).error).not.toBeNull(); });
  it("rejects approval without human attestation", async () => expect((await review("approve")).error?.message).toBe("QB_HUMAN_REVIEW_REQUIRED"));
  it("rejects publication before approval", async () => expect((await review("publish")).error?.message).toBe("QB_CONTENT_NOT_APPROVED"));
  it("exercises approval/publication only on isolated pilot fixtures", async () => {
    expect(question.source_type).toBe("DEV_FACTORY_PILOT");
    expect((await review("approve",true)).error).toBeNull(); question=(await detail()).question; expect(question.status).toBe("inactive");
    expect((await review("publish")).error).toBeNull(); question=(await detail()).question; expect(question.status).toBe("active");
  });
  it("increments meaningful versions and resets approval on edit", async () => {
    const before=question.version, text=question.question_text.endsWith(" (revised)")?question.question_text.replace(/ \(revised\)$/,""):question.question_text+" (revised)";
    expect((await review("edit",false,{question_text:text})).error).toBeNull(); const d=await detail(); question=d.question;
    expect(question.version).toBe(before+1); expect(question.validation_status).toBe("review"); expect(question.status).toBe("inactive"); expect(question.reviewed_by).toBeNull();
    expect(d.versions.some((v:any)=>v.version===before)).toBe(true); expect(d.versions.some((v:any)=>v.version===before+1)).toBe(true);
  });
  it("rejects stale concurrent review versions", async () => expect((await admin.rpc("qb_content_review",{p_id:question.id,p_action:"reject",p_version:question.version-1,p_expected_state:"review",p_patch:{},p_note:"Stale update probe",p_human_reviewed:false})).error?.message).toBe("QB_CONTENT_CONFLICT"));
  it("keeps fixture approvals out of production coverage", async () => { const r=await admin.rpc("qb_content_coverage",{}); expect(r.error).toBeNull(); expect(r.data.summary.productionApproved).toBe(0); expect(r.data.summary.totalIndicators).toBe(1357); expect(r.data.summary.fixtureQuestions).toBeGreaterThanOrEqual(39); });
  it("enforces server-side queue limits", async () => expect((await admin.rpc("qb_content_queue",{p_limit:1000})).error).not.toBeNull());
  it.each(["qb_content_queue","qb_content_coverage","qb_content_batches"])("rejects null pagination for %s", async (name) => expect((await admin.rpc(name,{p_limit:null})).error?.message).toBe("QB_INVALID_PAGE"));
  it("counts authorized approved availability consistently", async () => {
    const r=await teacher.rpc("qb_question_availability",{p_curriculum_node_ids:[original.mapping.id],p_grade:"SHS1",p_subject_code:"Computing"});
    expect(r.error).toBeNull(); expect(Number(r.data[0].approved_count)).toBeGreaterThanOrEqual(10);
    expect(Number(r.data[0].easy_count)+Number(r.data[0].medium_count)+Number(r.data[0].hard_count)).toBe(Number(r.data[0].approved_count));
  });
  it("never delivers unapproved questions through legacy catalogue RPC", async () => {
    const r=await student.rpc("qb_get_questions",{p_subject_code:"Computing",p_limit:100});
    expect(r.error).toBeNull(); expect(r.data.some((q:any)=>q.id===question.id)).toBe(false);
  });
  it("hides uncertified legacy standalone snapshots from new delivery", async () => {
    const result=await student.rpc("qb_list_available_assessments"); expect(result.error).toBeNull();
    expect(result.data.some((a:any)=>a.subject_code==="QBTEST")).toBe(false);
  });
  it("allows answer-free teacher bank metadata and difficulty filters", async () => {
    const r=await teacher.from("questions").select("id,question_text,difficulty_label").eq("subject_code","Computing").or("difficulty_code.eq.easy,difficulty_label.eq.easy").range(0,24);
    expect(r.error).toBeNull(); expect(r.data!.length).toBeGreaterThan(0);
    expect(r.data?.[0]).not.toHaveProperty("correct_answer");
  });
  it("creates, joins idempotently and archives a labeled acceptance class", async () => {
    const teacherId=(await teacher.rpc("qb_current_teacher_id")).data;
    const teacherUser=(await teacher.auth.getUser()).data.user!.id;
    const name="[DEV_ACCEPTANCE_FIXTURE] Class lifecycle regression";
    const existing=await teacher.from("classes").select("id,join_code").eq("class_name",name).eq("teacher_user_id",teacherUser).maybeSingle();
    expect(existing.error).toBeNull();
    let classroom=existing.data;
    if(!classroom) {
      const baseline=await teacher.from("classes").select("tenant_id").eq("class_name","QuizBox Developer Acceptance Class").single();
      const created=await teacher.from("classes").insert({class_name:name,grade:"SHS1",grade_label:"SHS1",teacher_id:teacherId,primary_teacher_id:teacherId,teacher_user_id:teacherUser,tenant_id:baseline.data?.tenant_id,curriculum_id:original.mapping.curriculum_id,education_level:"SHS",status:"active",join_code:"QBFACT-"+crypto.randomUUID().slice(0,8).toUpperCase()}).select("id,join_code").single();
      expect(created.error).toBeNull(); classroom=created.data;
    } else expect((await teacher.from("classes").update({status:"active"}).eq("id",classroom.id)).error).toBeNull();
    expect(classroom).not.toBeNull();
    try {
      const first=await student.rpc("qb_join_class",{p_join_code:classroom!.join_code});
      const retry=await student.rpc("qb_join_class",{p_join_code:classroom!.join_code});
      expect(first.error).toBeNull(); expect(retry.error).toBeNull(); expect(retry.data.membership_id).toBe(first.data.membership_id);
    } finally { expect((await teacher.from("classes").update({status:"archived"}).eq("id",classroom!.id)).error).toBeNull(); }
  });
  it("rejects invalid generation specifications before queueing", async () => { const spec=pilotBatch(original.mapping).spec; expect((await admin.rpc("qb_content_request_generation",{p_spec:{...spec,subject:"invented"}})).error).not.toBeNull(); });
  it("queues valid requests without pretending a provider executed", async () => { const spec=pilotBatch(original.mapping).spec; const r=await admin.rpc("qb_content_request_generation",{p_spec:spec}); expect(r.error).toBeNull(); const batch=await admin.from("content_import_batches").select("provider,report").eq("id",r.data.batch_id).single(); expect(batch.data?.provider).toBe("not-configured"); expect(batch.data?.report.state).toBe("awaiting_provider"); });
  it("denies other-student attempt and result access", async () => {
    const report=JSON.parse(await (await import("node:fs/promises")).readFile("reports/practice-acceptance.json","utf8"));
    for(const client of [other,teacher]) for(const rpc of ["qb_get_attempt","qb_get_result","qb_get_attempt_review"]) expect((await client.rpc(rpc,{p_attempt_id:report.attemptId})).error).not.toBeNull();
  });
  it("denies teacher-owned class creation in an unrelated tenant", async () => {
    const tenant=await admin.from("tenants").select("id").eq("code","QB_TEST_B").single();
    expect(tenant.error).toBeNull();
    const tid=await teacher.rpc("qb_current_teacher_id"); expect(tid.error).toBeNull();
    const uid=(await teacher.auth.getUser()).data.user!.id;
    const result=await teacher.from("classes").insert({class_name:"[DEV_ACCEPTANCE_FIXTURE] forbidden tenant probe",grade:"SHS1",grade_label:"SHS1",teacher_id:tid.data,primary_teacher_id:tid.data,teacher_user_id:uid,tenant_id:tenant.data!.id,status:"active",join_code:"QBDENY-"+crypto.randomUUID().slice(0,8)});
    expect(result.error?.code).toBe("42501");
  });
  it.skipIf(!process.env.QB_MEDIA_ACCEPTANCE_URL)("uploads a validated private diagram to a fixture question",async()=>{
    expect(question.source_type).toBe("DEV_FACTORY_PILOT");
    const image=await (await import("sharp")).default({create:{width:32,height:24,channels:3,background:"#22aa77"}}).png().toBuffer();
    const form=new FormData();form.set("file",new Blob([new Uint8Array(image)],{type:"image/png"}),"fixture-diagram.png");form.set("alt","Controlled acceptance diagram");form.set("question_id",question.id);form.set("version",String(question.version));form.set("note","DEV_FACTORY_PILOT private image acceptance only");
    const session=await admin.auth.getSession();
    const response=await fetch(new URL("/api/content/media",process.env.QB_MEDIA_ACCEPTANCE_URL),{method:"POST",headers:{Authorization:"Bearer "+session.data.session!.access_token},body:form});
    const result=await response.json();expect(result.error??response.status).toBe(200);mediaAsset=result.asset_id;expect(typeof mediaAsset).toBe("string");question=(await detail()).question;
  });
  it("keeps published snapshots unchanged after a governed pilot edit", async () => {
    expect(question.source_type).toBe("DEV_FACTORY_PILOT");
    expect((await review("approve",true)).error).toBeNull(); question=(await detail()).question;
    expect((await review("publish")).error).toBeNull(); question=(await detail()).question;
    const text=question.question_text, version=question.version;
    const classroom=await teacher.from("classes").select("id").eq("class_name","QuizBox Developer Acceptance Class").single();
    const uid=(await student.auth.getUser()).data.user!.id;
    const published=await teacher.rpc("qb_publish_assignment",{p_class_id:classroom.data!.id,p_title:"DEV_FACTORY_PILOT snapshot regression "+new Date().toISOString(),p_description:"Isolated acceptance only",p_curriculum_node_ids:[original.mapping.id],p_question_count:1,p_difficulty:null,p_selection_mode:"MANUAL",p_question_ids:[question.id],p_mode:"PRACTICE",p_attempts_allowed:1,p_time_limit_minutes:30,p_start_at:new Date().toISOString(),p_due_at:null,p_target_student_ids:[uid],p_remediation_source_assignment_id:null,p_remediation_node_id:null});
    expect(published.error).toBeNull();
    const start=await student.rpc("qb_start_attempt",{p_assessment_id:published.data.assessment_id,p_assignment_id:published.data.assignment_id,p_class_id:classroom.data!.id,p_client_session_id:crypto.randomUUID()});
    expect(start.error).toBeNull();
    const changed=text.endsWith(" [snapshot revision]")?text.replace(" [snapshot revision]",""):text+" [snapshot revision]";
    expect((await review("edit",false,{question_text:changed})).error).toBeNull(); question=(await detail()).question;
    const payload=await student.rpc("qb_get_attempt",{p_attempt_id:start.data.attempt_id}); expect(payload.error).toBeNull();
    expect(payload.data.questions[0].question_text).toBe(text);
    expect(payload.data.questions[0]).not.toHaveProperty("correct_answer");
    if(mediaAsset){
      const media=payload.data.questions[0].media.find((m:any)=>m.media_asset_id===mediaAsset);expect(!!media).toBe(true);
      const allowed=await student.storage.from(media.storage_bucket).createSignedUrl(media.storage_path,60);expect(allowed.error).toBeNull();
      const bytes=await fetch(allowed.data!.signedUrl);expect(bytes.status).toBe(200);expect(bytes.headers.get("content-type")).toContain("image/png");
      expect((await other.storage.from(media.storage_bucket).createSignedUrl(media.storage_path,60)).error).not.toBeNull();
      const raw=await fetch(new URL(`/storage/v1/object/public/${media.storage_bucket}/${media.storage_path}`,process.env.NEXT_PUBLIC_SUPABASE_URL));expect(raw.ok).toBe(false);
      await (await import("node:fs/promises")).writeFile("reports/media-acceptance.json",JSON.stringify({attemptId:start.data.attempt_id,assetId:mediaAsset,authorizedUpload:true,privateAssociation:true,authorizedRetrieval:true,unauthorizedDenied:true,publicUrlDenied:true,playerDisplay:"BROWSER_VERIFICATION_REQUIRED"},null,2));
    }
    const history=await admin.from("question_versions").select("snapshot").eq("question_id",question.id).eq("version_no",version).single();
    expect(history.error).toBeNull(); expect(history.data?.snapshot.question_text).toBe(text);
  },30000);
});
