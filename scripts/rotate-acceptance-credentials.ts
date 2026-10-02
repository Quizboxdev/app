import { randomBytes } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";
import { acceptanceAccount, ACCEPTANCE_ROLES } from "../lib/operations/acceptance";
async function main(){
 process.loadEnvFile(".env.local");
 if(!process.argv.includes("--apply")||!process.argv.includes("--confirm-test-rotation"))throw new Error("EXPLICIT_TEST_ROTATION_REQUIRED");
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL!,anon=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
 if(!key)throw new Error("SERVER_ADMIN_KEY_REQUIRED");
 const options={auth:{persistSession:false,autoRefreshToken:false}},admin=createClient(url,key,options);
 const roles=ACCEPTANCE_ROLES,sessions=[];
 // Validate every identity before any credential is changed.
 for(const role of roles){const account=acceptanceAccount(role),client=createClient(url,anon,options);const r=await client.auth.signInWithPassword(account);if(r.error||!r.data.session||r.data.user?.email!==account.email)throw new Error("TEST_IDENTITY_PREFLIGHT_FAILED");sessions.push({role,email:account.email,oldPassword:account.password,userId:r.data.user.id,session:r.data.session,password:"Qb1!"+randomBytes(32).toString("base64url")});}
 const values={QB_ENVIRONMENT:"acceptance",QB_ACCEPTANCE_PROJECT_REF:process.env.QB_ACCEPTANCE_PROJECT_REF!,QB_ACCEPTANCE_PASSWORD:sessions.find(s=>s.role==="student")!.password,QB_CONTENT_OPERATOR_EMAIL:sessions.find(s=>s.role==="admin")!.email,QB_CONTENT_OPERATOR_PASSWORD:sessions.find(s=>s.role==="admin")!.password,...Object.fromEntries(sessions.flatMap(s=>[["QB_ACCEPTANCE_"+s.role.toUpperCase()+"_EMAIL",s.email],["QB_ACCEPTANCE_"+s.role.toUpperCase()+"_PASSWORD",s.password]]))};
 // Persist a recoverable private receipt before beginning non-atomic Auth updates.
 await writeFile(".env.acceptance.rotated.local",Object.entries(values).map(([k,v])=>k+"="+v).join("\n")+"\n",{mode:0o600,flag:"wx"});
 const results:any[]=[];
 for(const s of sessions){
  const changed=await admin.auth.admin.updateUserById(s.userId,{password:s.password});if(changed.error||changed.data.user?.id!==s.userId)throw new Error("TEST_ROTATION_FAILED");
  const revoked=await admin.auth.admin.signOut(s.session.access_token,"global");if(revoked.error)throw new Error("REFRESH_REVOCATION_FAILED");
  const probe=createClient(url,anon,options),old=await probe.auth.signInWithPassword({email:s.email,password:s.oldPassword}),refresh=await probe.auth.refreshSession({refresh_token:s.session.refresh_token});
  if(!old.error||!refresh.error)throw new Error("OLD_CREDENTIALS_STILL_USABLE");
  const fresh=await probe.auth.signInWithPassword({email:s.email,password:s.password});if(fresh.error)throw new Error("REPLACEMENT_LOGIN_FAILED");await probe.auth.signOut();
  results.push({email:s.email,userId:s.userId,passwordRotated:true,oldPasswordRejected:true,oldRefreshRejected:true,replacementLoginVerified:true,oldAccessTokenExpiresAt:s.session.expires_at});
  await writeFile("reports/acceptance-credential-rotation.json",JSON.stringify({project:new URL(url).hostname.split('.')[0],checkedAt:new Date().toISOString(),accounts:results,physicallyIsolated:false,accessTokenCaveat:"Previously issued access JWTs may remain valid until expiry; refresh sessions are revoked",credentialFile:".env.acceptance.rotated.local",secretsPrinted:false},null,2));
 }
 console.log(JSON.stringify({accountsRotated:results.length,oldPasswordsRejected:results.length,refreshSessionsRevoked:results.length,physicalIsolationVerified:false,secretsPrinted:false}));
}
main().catch(()=>{console.error("ACCEPTANCE_ROTATION_INCOMPLETE: inspect the sanitized receipt and private replacement file; no production identities are targeted");process.exitCode=1;});
