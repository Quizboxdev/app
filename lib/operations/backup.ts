import { createHash } from "node:crypto";
export interface BackupEntry {table:string;file:string;rows:number;sha256:string;}
export function verifyBackupEntry(text:string,entry:BackupEntry) {
 if(!/^[a-z_]+$/.test(entry.table)||entry.file!==entry.table+".json"||!Number.isSafeInteger(entry.rows)||entry.rows<0||!/^[0-9a-f]{64}$/.test(entry.sha256))throw new Error("INVALID_BACKUP_ENTRY");
 if(createHash("sha256").update(text).digest("hex")!==entry.sha256)throw new Error("BACKUP_CHECKSUM_MISMATCH");
 const rows=JSON.parse(text);if(!Array.isArray(rows)||rows.length!==entry.rows)throw new Error("BACKUP_COUNT_MISMATCH");
 return rows.length;
}
