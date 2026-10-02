import { scryptSync, timingSafeEqual } from "node:crypto";
import { ACCEPTANCE_ROLES } from "./acceptance";
export const credentialDigest = (password: string, salt: string) => scryptSync(password, salt, 32).toString("hex");
export function freshEvidence(receipt: any, project: string, now = Date.now()) {
  const age = now - Date.parse(receipt?.checkedAt);
  return receipt?.project === project && age >= 0 && age <= 24 * 60 * 60 * 1000;
}
export function credentialEvidenceValid(receipt: any, project: string, accounts: Array<{ email: string; password: string }>, now = Date.now()) {
  if (!freshEvidence(receipt, project, now) || !Array.isArray(receipt.accounts) || receipt.accounts.length !== ACCEPTANCE_ROLES.length || accounts.length !== ACCEPTANCE_ROLES.length) return false;
  if (new Set(accounts.map(a=>a.password)).size !== accounts.length) return false;
  return accounts.every(account => {
    const row = receipt.accounts.find((r:any)=>r.email === account.email);
    if (!row?.replacementLoginVerified || !row.oldPasswordRejected || !row.oldRefreshRejected || !row.salt || !/^[a-f0-9]{64}$/.test(row.credentialDigest ?? "") || !Number.isFinite(Date.parse(row.oldAccessTokensExpireAfter)) || now < Date.parse(row.oldAccessTokensExpireAfter)) return false;
    return timingSafeEqual(Buffer.from(credentialDigest(account.password,row.salt),"hex"),Buffer.from(row.credentialDigest,"hex"));
  });
}
export function restoreEvidenceValid(receipt: any, project: string, now=Date.now()) {
  return receipt?.status === "PASS" && receipt.sourceProject === project && receipt.targetProject && receipt.targetProject !== project
    && /^[a-f0-9]{64}$/i.test(receipt.archiveSha256 ?? "") && receipt.schemaMatched === true && receipt.dataMatched === true
    && receipt.foreignKeysVerified === true && receipt.criticalTablesVerified === true && receipt.storageBinariesVerified === true
    && receipt.tablesVerified > 0 && now-Date.parse(receipt.checkedAt)>=0 && now-Date.parse(receipt.checkedAt)<=7*24*60*60*1000;
}
