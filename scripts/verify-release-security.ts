import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { randomBytes } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { acceptanceAccount, ACCEPTANCE_ROLES } from "../lib/operations/acceptance";
import { credentialDigest, credentialEvidenceValid } from "../lib/operations/release-evidence";
import { authConfigMeetsPolicy } from "../lib/password-policy";

export async function verifyReleaseSecurity() {
 try { process.loadEnvFile(".env.local"); } catch { /* CI can supply environment. */ }
 const project = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(".")[0];
 const checkedAt = new Date().toISOString();
 const passwordProtection: any = { project, checkedAt, status: "MANUAL VERIFICATION REQUIRED", enabled: false, source: "Management API GET /config/auth" };
 const token = process.env.QB_SUPABASE_MANAGEMENT_TOKEN;
 if (token) {
  try {
   const response = await fetch(`https://api.supabase.com/v1/projects/${project}/config/auth`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
   if (!response.ok) throw new Error("AUTH_CONFIG_READ_DENIED");
   const config = await response.json();
   const policy = authConfigMeetsPolicy(config);
   passwordProtection.enabled = policy.met; passwordProtection.mode = policy.mode;
   passwordProtection.minLength = config.password_min_length; passwordProtection.hibp = config.password_hibp_enabled === true;
   passwordProtection.status = policy.met ? "PASS" : "FAIL";
  } catch { passwordProtection.reason = "AUTH_CONFIG_READ_UNAVAILABLE"; }
 } else passwordProtection.reason = "MANAGEMENT_TOKEN_REQUIRED_FOR_POSITIVE_CONFIG_VERIFICATION";
 await writeFile("reports/password-protection-verification.json", JSON.stringify(passwordProtection,null,2));
 const credentials: any = { project, checkedAt, status: "FAIL", category: "CONFIGURATION", accounts: [] };
 try {
  const accounts = ACCEPTANCE_ROLES.map(role=>acceptanceAccount(role));
  const rotation = await readFile("reports/acceptance-credential-rotation.json","utf8").then(text=>JSON.parse(text)).catch(()=>{throw new Error("SIX_ACCOUNT_ROTATION_RECEIPT_REQUIRED");});
  const old = parseEnv(await readFile(".env.acceptance.local","utf8"));
  if (rotation.project !== project || rotation.accounts?.length !== 6 || new Set(accounts.map(a=>a.password)).size !== 6) throw new Error("ROTATION_RECEIPT_OR_DISTINCT_CREDENTIALS_REQUIRED");
  for (let i=0;i<accounts.length;i++) {
   const account=accounts[i], role=ACCEPTANCE_ROLES[i], previous=old[`QB_ACCEPTANCE_${role.toUpperCase()}_PASSWORD`] ?? old[`QUIZBOX_${role.toUpperCase()}_PASSWORD`] ?? old.QB_ACCEPTANCE_PASSWORD;
   const record=rotation.accounts.find((r:any)=>r.email===account.email);
   if (!previous || previous===account.password || !record?.oldPasswordRejected || !record.oldRefreshRejected) throw new Error("PRE_ROTATION_REJECTION_EVIDENCE_REQUIRED");
   const client=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false}});
   const denied=await client.auth.signInWithPassword({email:account.email,password:previous});
   if (denied.error?.code !== "invalid_credentials") throw new Error("OLD_PASSWORD_REJECTION_NOT_VERIFIED");
   const login=await client.auth.signInWithPassword(account);
   if (login.error || login.data.user?.id !== record.userId) throw new Error("REPLACEMENT_IDENTITY_LOGIN_FAILED");
   await client.auth.signOut();
   const salt=randomBytes(16).toString("hex");
   credentials.accounts.push({email:account.email,userId:record.userId,oldPasswordRejected:true,oldRefreshRejected:true,replacementLoginVerified:true,salt,credentialDigest:credentialDigest(account.password,salt),oldAccessTokensExpireAfter:new Date((record.oldAccessTokenExpiresAt+60)*1000).toISOString()});
  }
  credentials.status=credentialEvidenceValid(credentials,project,accounts)?"PASS":"FAIL";
  credentials.reason=credentials.status==="PASS"?"CURRENT_DISTINCT_CREDENTIALS_VERIFIED":"WAIT_FOR_PRE_ROTATION_ACCESS_JWT_EXPIRY";
 } catch (error) { credentials.reason=error instanceof Error && /^[A-Z_]+$/.test(error.message)?error.message:"ACCEPTANCE_CONFIGURATION_OR_AUTH_UNAVAILABLE"; }
 await writeFile("reports/acceptance-credential-verification.json",JSON.stringify(credentials,null,2));
 console.log(JSON.stringify({passwordProtection:passwordProtection.status,credentials:credentials.status,reason:credentials.reason}));
 return {passwordProtection,credentials};
}
if (process.argv[1]?.endsWith("verify-release-security.ts")) verifyReleaseSecurity().then(r=>{if(r.credentials.status!=="PASS"||r.passwordProtection.status!=="PASS")process.exitCode=1;}).catch(()=>{console.error("RELEASE_SECURITY_VERIFICATION_UNAVAILABLE");process.exitCode=1;});
