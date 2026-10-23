import { afterEach, describe, expect, it, vi } from "vitest";
import { SITE_URL } from "@/lib/site";

// The public contact form with attachments: origin, bots, validation, file checks by content, limits, and that nothing is created for a bad request.
const rpc = vi.fn(), upload = vi.fn(), remove = vi.fn();
vi.mock("@/lib/supabase/server-admin", () => ({ getSupabaseAdminClient: () => ({ rpc, storage: { from: () => ({ upload, remove }) }, from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null }) }) }) }) }) }));
import { POST } from "./route";

const ORIGIN = new URL(SITE_URL).origin;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3, 4]);
const EXE = new Uint8Array([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
const base = { name: "Kofi Mensah", email: "Kofi@Example.com", enquiry_type: "Payment or refund", message: "I was charged twice on 22 October for one plan.", consent: "on", website: "", elapsed_ms: "8000" };
function req(fields: Record<string, string> = {}, files: [string, Uint8Array, string][] = [], headers: Record<string, string> = { origin: ORIGIN, host: new URL(SITE_URL).host }) {
  const f = new FormData();
  for (const [k, v] of Object.entries({ ...base, ...fields })) f.append(k, v);
  for (const [name, bytes, type] of files) f.append("files", new File([bytes as unknown as BlobPart], name, { type }));
  return new Request(`${ORIGIN}/api/support/contact`, { method: "POST", headers, body: f });
}
afterEach(() => { vi.restoreAllMocks(); rpc.mockReset(); upload.mockReset(); remove.mockReset(); });

describe("POST /api/support/contact", () => {
  it("only accepts the site's own form posts", async () => {
    expect((await POST(req({}, [], { origin: "https://evil.example", host: new URL(SITE_URL).host }))).status).toBe(403);
    expect((await POST(new Request(`${ORIGIN}/api/support/contact`, { method: "POST", headers: { origin: ORIGIN, host: new URL(SITE_URL).host, "content-type": "application/json" }, body: "{}" }))).status).toBe(415);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("quietly drops a bot (hidden field filled, or submitted instantly) without creating anything", async () => {
    expect((await POST(req({ website: "http://spam.example" }))).status).toBe(202);
    expect((await POST(req({ elapsed_ms: "500" }))).status).toBe(202);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses bad details before creating anything", async () => {
    for (const bad of <Record<string, string>[]>[{ message: "short" }, { email: "not-an-email" }, { name: "" }, { enquiry_type: "Something else" }, { consent: "" }]) {
      const res = await POST(req(bad)); expect(res.status).toBe(400);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
  it("refuses a file that is not an image or PDF, even if it is called .png, and creates nothing", async () => {
    const res = await POST(req({}, [["receipt.png", EXE, "image/png"]]));
    expect(res.status).toBe(400); expect((await res.json()).error).toMatch(/Only images/);
    expect(rpc).not.toHaveBeenCalled(); expect(upload).not.toHaveBeenCalled();
  });
  it("refuses more than 3 files", async () => {
    const res = await POST(req({}, [1, 2, 3, 4].map((i) => [`a${i}.png`, PNG, "image/png"] as [string, Uint8Array, string])));
    expect(res.status).toBe(400); expect(rpc).not.toHaveBeenCalled();
  });
  it("creates the request with the right category, stores the file privately under a random name, and answers with the reference only", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    rpc.mockImplementation(async (fn: string) => fn === "qb_support_create_public" ? { data: { id: "11111111-1111-4111-8111-111111111111", reference: "QB-T-ABCDEF1234" }, error: null } : { data: "file-id", error: null });
    upload.mockResolvedValue({ error: null });
    const res = await POST(req({}, [["Receipt 1.png", PNG, "image/png"]]));
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ ok: true, reference: "QB-T-ABCDEF1234", filesFailed: false });
    const create = rpc.mock.calls.find((c) => c[0] === "qb_support_create_public")![1];
    expect(create).toMatchObject({ p_name: "Kofi Mensah", p_email: "kofi@example.com", p_category: "payment" });
    expect(create.p_subject.startsWith("Payment or refund: I was charged twice")).toBe(true);
    expect(create.p_client_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(upload).toHaveBeenCalledTimes(1);
    const [path, , opts] = upload.mock.calls[0];
    expect(path).toMatch(/^11111111-1111-4111-8111-111111111111\/[0-9a-f-]{36}\.png$/); expect(opts).toMatchObject({ contentType: "image/png", upsert: false });
    expect(rpc.mock.calls.find((c) => c[0] === "qb_support_file_add")![1]).toMatchObject({ p_name: "Receipt 1.png", p_mime: "image/png", p_kind: "requester" });
    vi.unstubAllEnvs();
  });
  it("tells the person when too many messages were sent", async () => {
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-service-key");
    rpc.mockResolvedValue({ data: null, error: { message: "QB_RATE_LIMITED" } });
    expect((await POST(req())).status).toBe(429);
    vi.unstubAllEnvs();
  });
});
