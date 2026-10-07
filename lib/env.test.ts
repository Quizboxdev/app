import { describe, expect, it } from "vitest";
import { validatePublicEnvironment } from "./env";
import { userFacingError } from "./errors";
const base={NEXT_PUBLIC_SUPABASE_URL:"https://example.supabase.co",NEXT_PUBLIC_SUPABASE_ANON_KEY:"sb_publishable_example"};
describe("public environment and error boundaries", () => {
  it("accepts a base project URL", () => expect(validatePublicEnvironment(base).url).toBe(base.NEXT_PUBLIC_SUPABASE_URL));
  it("fails missing configuration without printing values", () => expect(()=>validatePublicEnvironment({})).toThrow("requires"));
  it.each(["/rest/v1","/?secret=example","/#secret","/other"])("rejects unsafe URL suffix %s", (suffix)=>expect(()=>validatePublicEnvironment({...base,NEXT_PUBLIC_SUPABASE_URL:base.NEXT_PUBLIC_SUPABASE_URL+suffix})).toThrow());
  it("rejects public secret keys", () => expect(()=>validatePublicEnvironment({...base,NEXT_PUBLIC_SUPABASE_ANON_KEY:"sb_secret_example"})).toThrow("secret key"));
  it("rejects public service-role JWTs", () => expect(()=>validatePublicEnvironment({...base,NEXT_PUBLIC_SUPABASE_ANON_KEY:"x."+Buffer.from(JSON.stringify({role:"service_role"})).toString("base64url")+".x"})).toThrow("service-role"));
  it("rejects an anon key from a different project than the URL", () => expect(()=>validatePublicEnvironment({NEXT_PUBLIC_SUPABASE_URL:"https://prodref.supabase.co",NEXT_PUBLIC_SUPABASE_ANON_KEY:"x."+Buffer.from(JSON.stringify({role:"anon",ref:"previewref"})).toString("base64url")+".x"})).toThrow("belongs to project previewref"));
  it("accepts an anon key of the same project", () => expect(validatePublicEnvironment({NEXT_PUBLIC_SUPABASE_URL:"https://prodref.supabase.co",NEXT_PUBLIC_SUPABASE_ANON_KEY:"x."+Buffer.from(JSON.stringify({role:"anon",ref:"prodref"})).toString("base64url")+".x"}).url).toContain("prodref"));
  it("rejects URL credentials", () => expect(()=>validatePublicEnvironment({...base,NEXT_PUBLIC_SUPABASE_URL:"https://private:example@example.supabase.co"})).toThrow());
  it("permits loopback development", () => expect(validatePublicEnvironment({...base,NEXT_PUBLIC_SUPABASE_URL:"http://127.0.0.1:54321"}).url).toContain("127.0.0.1"));
  it("does not leak unknown SQL errors", () => expect(userFacingError({message:"secret_schema.answer_table permission denied"})).not.toContain("answer_table"));
  it("maps conflict errors to an actionable message", () => expect(userFacingError({message:"QB_CONTENT_CONFLICT"})).toContain("Reload"));
});
