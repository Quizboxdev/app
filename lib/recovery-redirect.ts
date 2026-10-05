// A password-recovery link must reach /auth/update-password. If Supabase cannot honour the requested redirect (for example the
// URL is missing from the Auth redirect allow-list) it falls back to the Site URL, which lands on the homepage. The one-time PKCE
// code would then be spent by whatever client initialises first. This script runs before hydration (see app/layout.tsx), recognises a
// recovery return, and forwards it, query and hash intact, to the recovery page before any Supabase client exists.
//
// A PKCE reset stores its code verifier in the browser that requested it as "<verifier>/PASSWORD_RECOVERY" (cookie value base64url,
// prefixed "base64-"), which is what distinguishes a recovery code from a sign-up or OAuth code. Implicit-style links carry type=recovery.
// It is a string because it runs inline before the app bundle; tests execute this same source.
export const RECOVERY_TARGET = "/auth/update-password";

export const RECOVERY_REDIRECT_SCRIPT = `(function(){try{
var l=location,p=l.pathname;
if(p.indexOf("/auth/update-password")===0||p.indexOf("/auth/reset-password")===0)return;
var s=l.search||"",h=l.hash||"";
var rec=/[#?&]type=recovery(&|$)/.test(s+h);
if(!rec&&/[?&]code=/.test(s)){
var m=document.cookie.match(/(?:^|; )sb-[^=;]*-auth-token-code-verifier=([^;]*)/);
if(m){var v=decodeURIComponent(m[1]);
if(v.indexOf("base64-")===0){v=atob(v.slice(7).replace(/-/g,"+").replace(/_/g,"/"));}
rec=/\\/PASSWORD_RECOVERY$/.test(v);}}
if(rec)l.replace("${RECOVERY_TARGET}"+s+h);
}catch(e){}})();`;
