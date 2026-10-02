import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBrowserClient } from "@supabase/ssr";
import { initializePasswordRecovery, INVALID_RESET_MESSAGE, RECOVERY_STORAGE_KEY, requestPasswordReset, RESET_SUCCESS_PATH, updateRecoveryPassword, validateResetPasswords } from "./auth-recovery";

const storage = () => {
  const values = new Map<string,string>();
  return { getItem: (key:string)=>values.get(key)??null, setItem: (key:string,value:string)=>{values.set(key,value);}, removeItem: (key:string)=>{values.delete(key);} };
};
function mockClient(event = true) {
  const session = { user: { id: "unit-user" }, expires_at: Math.floor(Date.now()/1000)+3600 };
  const auth = { onAuthStateChange: vi.fn((callback:any)=>{if(event)callback("PASSWORD_RECOVERY",session);return {data:{subscription:{unsubscribe:vi.fn()}}};}), initialize: vi.fn().mockResolvedValue({error:null}), getSession:vi.fn().mockResolvedValue({data:{session},error:null}), getUser:vi.fn().mockResolvedValue({data:{user:session.user},error:null}), updateUser:vi.fn().mockResolvedValue({error:null}), signOut:vi.fn().mockResolvedValue({error:null}), resetPasswordForEmail:vi.fn().mockResolvedValue({error:null}) };
  return {auth} as unknown as ReturnType<typeof createBrowserClient>;
}
describe("password recovery guards",()=>{
  it("requests the reset route on production and localhost origins",async()=>{
    const client=mockClient();for(const origin of ["https://quizbox-nine.vercel.app","http://localhost:3001"]) {
      await requestPasswordReset("unit@example.invalid",origin,client);
      expect(client.auth.resetPasswordForEmail).toHaveBeenLastCalledWith("unit@example.invalid",{redirectTo:origin+"/auth/reset-password"});
    }
  });
  it.each([["","","Both password fields are required."],["short","short","Password must contain at least 8 characters."],["unit-new-password","unit-other-password","Passwords do not match."]])("rejects invalid password fields",(password,confirmation,message)=>expect(validateResetPasswords(password,confirmation)).toBe(message));
  it("does not update a mismatched password",async()=>{const client=mockClient();await expect(updateRecoveryPassword("unit-new-password","unit-other-password","unit-user",storage(),client)).rejects.toThrow("Passwords do not match.");expect(client.auth.updateUser).not.toHaveBeenCalled();});
  it("does not mistake an ordinary signed-in session for recovery",async()=>{await expect(initializePasswordRecovery(new URL("https://unit.invalid/auth/reset-password"),storage(),()=>new URL("https://unit.invalid/auth/reset-password"),mockClient(false))).rejects.toThrow(INVALID_RESET_MESSAGE);});
  it("rejects expired links without falling back to an existing session",async()=>{const client=mockClient();await expect(initializePasswordRecovery(new URL("https://unit.invalid/auth/reset-password#error=access_denied&error_code=otp_expired"),storage(),()=>new URL("https://unit.invalid/auth/reset-password"),client)).rejects.toThrow(INVALID_RESET_MESSAGE);expect(client.auth.getUser).not.toHaveBeenCalled();});
  it("rejects an unexchanged code, even if a different session exists",async()=>{const url=new URL("https://unit.invalid/auth/reset-password?code=expired");await expect(initializePasswordRecovery(url,storage(),()=>url,mockClient())).rejects.toThrow(INVALID_RESET_MESSAGE);});
  it("rejects initialization errors",async()=>{const client=mockClient();vi.mocked(client.auth.initialize).mockResolvedValue({error:new Error("invalid code")} as any);await expect(initializePasswordRecovery(new URL("https://unit.invalid/auth/reset-password?code=expired"),storage(),()=>new URL("https://unit.invalid/auth/reset-password"),client)).rejects.toThrow(INVALID_RESET_MESSAGE);});
  it("resumes only the same verified recovery user after refresh",async()=>{const saved=storage(),url=new URL("https://unit.invalid/auth/reset-password");await initializePasswordRecovery(url,saved,()=>url,mockClient());expect(await initializePasswordRecovery(url,saved,()=>url,mockClient(false))).toBe("unit-user");saved.setItem(RECOVERY_STORAGE_KEY,JSON.stringify({userId:"other",expiresAt:Date.now()+10000}));await expect(initializePasswordRecovery(url,saved,()=>url,mockClient(false))).rejects.toThrow(INVALID_RESET_MESSAGE);});
  it("updates the password, clears recovery state and returns the success login route",async()=>{const client=mockClient(),saved=storage();saved.setItem(RECOVERY_STORAGE_KEY,"marker");expect(await updateRecoveryPassword("unit-new-password","unit-new-password","unit-user",saved,client)).toBe(RESET_SUCCESS_PATH);expect(client.auth.updateUser).toHaveBeenCalledWith({password:"unit-new-password"});expect(client.auth.signOut).toHaveBeenCalledWith({scope:"local"});expect(saved.getItem(RECOVERY_STORAGE_KEY)).toBeNull();});
  it("does not update another user's session",async()=>{const client=mockClient();await expect(updateRecoveryPassword("unit-new-password","unit-new-password","other",storage(),client)).rejects.toThrow(INVALID_RESET_MESSAGE);expect(client.auth.updateUser).not.toHaveBeenCalled();});
});

describe("existing PKCE browser client recovery integration",()=>{
  const clients: ReturnType<typeof createBrowserClient>[]=[];
  beforeEach(()=>{
    vi.spyOn(console,"warn").mockImplementation(()=>{});
    const cookies=new Map<string,string>();
    const document:any={visibilityState:"hidden",addEventListener:vi.fn(),removeEventListener:vi.fn()};
    Object.defineProperty(document,"cookie",{get:()=>Array.from(cookies,([key,value])=>key+"="+value).join("; "),set:(value:string)=>{const pair=value.split(";")[0],index=pair.indexOf("="),key=pair.slice(0,index);if(/Max-Age=0/i.test(value))cookies.delete(key);else cookies.set(key,pair.slice(index+1));}});
    const window:any={document,location:new URL("https://quizbox-nine.vercel.app/auth/forgot-password"),localStorage:storage(),addEventListener:vi.fn(),removeEventListener:vi.fn(),history:{state:null,replaceState:(_state:any,_unused:string,url:string)=>{window.location=new URL(url);}}};
    vi.stubGlobal("document",document);vi.stubGlobal("window",window);vi.stubGlobal("BroadcastChannel",undefined);
  });
  afterEach(async()=>{for(const client of clients)await client.auth.stopAutoRefresh();clients.length=0;vi.unstubAllGlobals();vi.restoreAllMocks();});
  it("exchanges the recovery code once, persists cookies, updates and signs in with the new password",async()=>{
    const user={id:"00000000-0000-4000-8000-000000000001",email:"unit@example.invalid",aud:"authenticated",role:"authenticated",app_metadata:{provider:"email"},user_metadata:{},created_at:new Date().toISOString()};
    const encode=(value:object)=>Buffer.from(JSON.stringify(value)).toString("base64url");
    const token=encode({alg:"HS256",typ:"JWT"})+"."+encode({sub:user.id,exp:Math.floor(Date.now()/1000)+3600,iat:Math.floor(Date.now()/1000),aud:"authenticated",role:"authenticated"})+"."+Buffer.alloc(32).toString("base64url");
    const session={access_token:token,refresh_token:"unit-refresh-token",expires_in:3600,token_type:"bearer",user};
    let currentPassword="unit-old-password",exchanges=0;
    const fetcher=vi.fn(async(input:any,init:any)=>{
      const url=new URL(String(input)),body=init?.body?JSON.parse(init.body):{};
      if(url.pathname.endsWith("/recover"))return Response.json({});
      if(url.searchParams.get("grant_type")==="pkce"){exchanges++;expect(body.code_verifier).toBeTruthy();return Response.json(session);}
      if(url.pathname.endsWith("/user")){if(init?.method==="PUT")currentPassword=body.password;return Response.json(user);}
      if(url.pathname.endsWith("/logout"))return new Response(null,{status:204});
      if(url.searchParams.get("grant_type")==="password")return body.password===currentPassword?Response.json(session):Response.json({code:"invalid_credentials",msg:"Invalid login credentials"},{status:400});
      throw new Error("Unexpected mocked Auth request");
    });
    const makeClient=()=>{const client=createBrowserClient("https://unit.supabase.co","unit-public-key",{isSingleton:false,global:{fetch:fetcher}});clients.push(client);return client;};
    await requestPasswordReset(user.email,window.location.origin,makeClient());
    window.location.href="https://quizbox-nine.vercel.app/auth/reset-password?code=unit-recovery-code";
    const url=new URL(window.location.href),saved=storage(),client=makeClient();
    expect(await initializePasswordRecovery(url,saved,()=>new URL(window.location.href),client)).toBe(user.id);
    expect(window.location.pathname).toBe("/auth/reset-password");expect(window.location.search).toBe("");expect(document.cookie).toContain("auth-token=");expect(exchanges).toBe(1);
    expect(await updateRecoveryPassword("unit-new-password","unit-new-password",user.id,saved,client)).toBe("/login?password_reset=success");
    expect((await client.auth.signInWithPassword({email:user.email,password:"unit-old-password"})).error?.message).toBe("Invalid login credentials");
    expect((await client.auth.signInWithPassword({email:user.email,password:"unit-new-password"})).data.user?.id).toBe(user.id);
  });
});
