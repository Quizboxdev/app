import { readFile,writeFile } from "node:fs/promises";
import path from "node:path";
import { verifyBackupEntry,type BackupEntry } from "../lib/operations/backup";
async function main(){
 const root=path.resolve(".local-backups"),directory=path.resolve(process.argv[2]??"");if(!directory.toLowerCase().startsWith(root.toLowerCase()+path.sep))throw new Error("PRIVATE_BACKUP_PATH_REQUIRED");
 const manifest=JSON.parse(await readFile(path.join(directory,"manifest.json"),"utf8"));if(!Array.isArray(manifest.files)||manifest.files.length<29)throw new Error("INCOMPLETE_BACKUP_PACKAGE");
 const seen=new Set<string>();let rows=0;
 for(const entry of manifest.files as BackupEntry[]){if(seen.has(entry.table)||entry.file!==entry.table+".json"||!/^[a-z_]+$/.test(entry.table))throw new Error("INVALID_BACKUP_MANIFEST");seen.add(entry.table);rows+=verifyBackupEntry(await readFile(path.join(directory,entry.file),"utf8"),entry);}
 const report={checkedAt:new Date().toISOString(),privatePackageTables:seen.size,rows,checksumsVerified:true,schemaArchiveVerified:false,storageBinariesVerified:false,transactionConsistentSnapshot:false,restoreRehearsal:"MANUAL VERIFICATION REQUIRED"};
 await writeFile("reports/backup-package-status.json",JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}
main().catch(()=>{console.error("PRIVATE_BACKUP_VERIFICATION_FAILED");process.exitCode=1;});
