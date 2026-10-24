// Signs in through the real login form on the LOCAL app (http://localhost:3100, wired to the Preview database) as one test role.
// Credentials are fetched by the browser tool from a localhost-only helper, so no password appears in this file, the command or the output.
// Edit ROLE and INDEX, then run with browser_run_code_unsafe (filename = this file).
async (page) => {
  const ROLE = "STUDENT", INDEX = 0, BASE = "http://localhost:3100";
  const ctx = page.context();
  await ctx.clearCookies();
  await page.goto(BASE + "/login", { waitUntil: "load" });
  await page.evaluate(() => { try { localStorage.clear(); sessionStorage.clear(); } catch {} });
  await page.setViewportSize({ width: 390, height: 844 });
  const res = await (await page.request.get("http://127.0.0.1:3199/acct/" + ROLE + "/" + INDEX)).json();
  if (res.error) return { error: "no such account", ROLE, INDEX };
  const out = { role: ROLE, index: INDEX, accountsOfRole: res.count, attempts: [] };
  for (const pw of res.passwords) {
    await page.goto(BASE + "/login", { waitUntil: "load" });
    await page.getByLabel("Email or username").fill(res.email);
    await page.getByLabel("Password", { exact: true }).fill(pw);
    const t0 = Date.now();
    await page.getByRole("button", { name: "Sign in", exact: true }).last().click();
    let landed = null;
    try { await page.waitForURL((u) => !/\/login/.test(u.pathname), { timeout: 20000 }); landed = new URL(page.url()).pathname; } catch {}
    const msg = landed ? "" : (await page.locator("[role=alert], .qb-error, .qb-auth-error").allInnerTexts().catch(() => [])).join(" | ").slice(0, 160);
    out.attempts.push({ ok: !!landed, landed, msToLand: landed ? Date.now() - t0 : null, message: msg });
    if (landed) break;
  }
  await page.waitForTimeout(2500);
  out.finalPath = new URL(page.url()).pathname; out.title = await page.title();
  out.bodyStart = (await page.evaluate(() => document.body.innerText)).slice(0, 220).replace(/\s+/g, " ");
  return out;
}
