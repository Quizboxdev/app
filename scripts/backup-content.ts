import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
async function main() {
  process.loadEnvFile(".env.local");
  if(!process.argv.includes("--confirm-private-backup"))throw new Error("PRIVATE_BACKUP_CONFIRMATION_REQUIRED");
  const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!url||!key)throw new Error("SERVER_OPERATOR_ENVIRONMENT_REQUIRED");
  const directory=path.resolve(".local-backups",new Date().toISOString().replace(/[:.]/g,"-"));
  await mkdir(directory,{recursive:true});
  const client=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}}),manifest:any={createdAt:new Date().toISOString(),project:new URL(url).hostname.split(".")[0],files:[]};
  for(const table of ["curricula","curriculum_nodes","questions","question_versions","content_import_batches","question_import_staging","media_assets","question_media","content_coverage_targets"]) {
    const rows:any[]=[];for(let from=0;;from+=500){const r=await client.from(table).select("*").order("id").range(from,from+499);if(r.error)throw new Error("BACKUP_READ_FAILED");rows.push(...(r.data??[]));if((r.data?.length??0)<500)break;}
    const text=JSON.stringify(rows),file=table+".json";await writeFile(path.join(directory,file),text,{mode:0o600});
    const reopened=await readFile(path.join(directory,file),"utf8");if(JSON.parse(reopened).length!==rows.length)throw new Error("BACKUP_VERIFICATION_FAILED");
    manifest.files.push({table,file,rows:rows.length,sha256:createHash("sha256").update(reopened).digest("hex")});
  }
  await writeFile(path.join(directory,"manifest.json"),JSON.stringify(manifest,null,2),{mode:0o600});
  console.log(JSON.stringify({privateContentExportVerified:true,tables:manifest.files.length,infrastructureBackupVerified:false,restoreDrillVerified:false}));
}
main().catch(()=>{console.error("PRIVATE_BACKUP_FAILED");process.exitCode=1;});
