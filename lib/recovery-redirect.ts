// A password-recovery link must reach /auth/update-password. If Supabase cannot honour the requested redirect (for example the
// URL is missing from the Auth redirect allow-list) it falls back to the Site URL, which lands on the homepage. The one-time PKCE
// code would then be spent by whatever client initialises first. This script runs before hydration (see app/layout.tsx), recognises a
// recovery return, and forwards it, query and hash intact, to the recovery page before any Supabase client exists.
//
// A PKCE reset stores its code verifier in the browser that requested it with a recovery suffix, which is what distinguishes a recovery
// code from a sign-up or OAuth code. auth-js >= 2.1xx writes the JSON string "<verifier>/recovery" (older releases wrote an unquoted
// "<verifier>/PASSWORD_RECOVERY"); @supabase/ssr stores it base64url-encoded with a "base64-" prefix. The verifier lives in the per-flow
// slot "<key>-flow-<sb_flow_id>-code-verifier" when the return URL carries sb_flow_id, and in "<key>-code-verifier" otherwise.
// Implicit-style links carry type=recovery. It is a string because it runs inline before the app bundle; tests execute this same source.
export const RECOVERY_TARGET = "/auth/update-password";

export const RECOVERY_REDIRECT_SCRIPT = `(function(){try{
var l=location,p=l.pathname;
if(p.indexOf("/auth/update-password")===0||p.indexOf("/auth/reset-password")===0)return;
var s=l.search||"",h=l.hash||"";
var rec=/[#?&]type=recovery(&|$)/.test(s+h);
if(!rec&&/[?&]code=/.test(s)){
var f=s.match(/[?&]sb_flow_id=([A-Za-z0-9_-]+)/);
var k=f?"-auth-token-flow-"+f[1]+"-code-verifier":"-auth-token-code-verifier";
var c=document.cookie.split("; ");
for(var i=0;i<c.length&&!rec;i++){var e=c[i].indexOf("="),n=c[i].slice(0,e);
if(n.indexOf("sb-")!==0||n.slice(-k.length)!==k||n.slice(3,-k.length).indexOf("-")!==-1)continue;
var v=decodeURIComponent(c[i].slice(e+1));
if(v.indexOf("base64-")===0){v=atob(v.slice(7).replace(/-/g,"+").replace(/_/g,"/"));}
try{var j=JSON.parse(v);if(typeof j==="string")v=j;}catch(x){}
rec=/\\/(recovery|PASSWORD_RECOVERY)$/.test(v);}}
if(rec)l.replace("${RECOVERY_TARGET}"+s+h);
}catch(e){}})();`;
