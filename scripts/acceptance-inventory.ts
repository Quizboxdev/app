import { createClient } from "@supabase/supabase-js";
import { acceptanceAccount } from "../lib/operations/acceptance";
import { writeFile } from "node:fs/promises";
async function main() {
 process.loadEnvFile(".env.local");
 acceptanceAccount("student");
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key)throw new Error("SERVER_ENV_REQUIRED");
 const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const accounts:string[]=[];
 for(let page=1;;page++){const result=await client.auth.admin.listUsers({page,perPage:100});if(result.error)throw new Error("AUTH_INVENTORY_DENIED");for(const user of result.data.users)if(/^(admin|student2?|teacher|sponsor|seller)\.test@quizbox\.local$/.test(user.email??""))accounts.push(user.id);if(result.data.users.length<100)break;}
 const read=async(table:string,columns:string)=>{const rows:any[]=[];for(let start=0;;start+=500){const r=await client.from(table).select(columns).order("id").range(start,start+499);if(r.error)throw new Error("INVENTORY_READ_DENIED");rows.push(...(r.data??[]));if((r.data?.length??0)<500)return rows;}};
 const classes=(await read("classes","id,class_name,teacher_user_id")).filter(r=>/acceptance|DEV_ACCEPTANCE_FIXTURE/i.test(r.class_name??"")||accounts.includes(r.teacher_user_id));
 const assignments=(await read("assignments","id,title,class_id,teacher_user_id")).filter(r=>classes.some(c=>c.id===r.class_id)||accounts.includes(r.teacher_user_id)||/acceptance|DEV_FACTORY_PILOT/i.test(r.title??""));
 const attempts=(await read("attempts","id,student_user_id,assignment_id")).filter(r=>accounts.includes(r.student_user_id));
 const questions=(await read("questions","id,source_type")).filter(r=>["DEV_ACCEPTANCE_FIXTURE","DEV_FACTORY_PILOT"].includes(r.source_type));
 await writeFile("reports/acceptance-data-inventory.json",JSON.stringify({checkedAt:new Date().toISOString(),accounts:accounts.map(id=>({id,classification:"acceptance identity by explicit email allowlist"})),classes:classes.map(r=>r.id),assignments:assignments.map(r=>r.id),attempts:attempts.map(r=>r.id),questions:questions.map(r=>({id:r.id,source:r.source_type})),physicallyIsolated:false,productionProjectClassification:"OPERATOR_VERIFICATION_REQUIRED",deletions:0,credentialRotationVerified:false},null,2));
 console.log(JSON.stringify({accounts:accounts.length,classes:classes.length,assignments:assignments.length,attempts:attempts.length,fixtureQuestions:questions.length,deletions:0}));
}
main().catch(()=>{console.error("ACCEPTANCE_INVENTORY_FAILED");process.exitCode=1;});
