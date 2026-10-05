// Fixture-backed authenticated visual QA. Usage:
//   npx tsx scripts/qa/visual-qa.ts --role school [--widths 390,768,1024,1440] [--routes /school,/school/classes] [--port 3100]
// Starts a fake Supabase on 127.0.0.1, runs `next dev` against it, drives headless Edge/Chrome over CDP and writes
// reports/qa/<role>/responsive.json plus one PNG per route and width. No hosted service is contacted: the browser
// blocks every non-loopback request, and the app's Supabase URL is overridden to the local fixture server.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FIXTURE_URL, sessionCookie, startFixtureServer, type QaFixture, type QaRoute, type QaStep } from "./fixture-server";

const arg = (name: string, fallback: string) => { const i = process.argv.indexOf(`--${name}`); return i > -1 ? process.argv[i + 1] : fallback; };
const role = arg("role", "school"), port = Number(arg("port", "3100")), debugPort = 9333;
const widths = arg("widths", "390,768,1024,1440").split(",").map(Number);
const ORIGIN = `http://localhost:${port}`;
const BROWSERS = [process.env.QA_BROWSER, "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Microsoft/Edge/Application/msedge.exe", "C:/Program Files/Google/Chrome/Application/chrome.exe"].filter(Boolean) as string[];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class Cdp {
  private id = 0; private pending = new Map<number, (v: any) => void>(); private listeners: Array<(m: any) => void> = [];
  constructor(private ws: WebSocket) { ws.onmessage = (e) => { const m = JSON.parse(String(e.data)); if (m.id && this.pending.has(m.id)) { this.pending.get(m.id)!(m); this.pending.delete(m.id); } else this.listeners.forEach((l) => l(m)); }; }
  static async connect(url: string) { const ws = new WebSocket(url); await new Promise<void>((res, rej) => { ws.onopen = () => res(); ws.onerror = () => rej(new Error("CDP connect failed")); }); return new Cdp(ws); }
  send(method: string, params: object = {}): Promise<any> { const id = ++this.id; this.ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => { const t = setTimeout(() => rej(new Error(`CDP timeout: ${method}`)), 60_000); this.pending.set(id, (m) => { clearTimeout(t); m.error ? rej(new Error(`${method}: ${m.error.message}`)) : res(m.result); }); }); }
  on(l: (m: any) => void) { this.listeners.push(l); }
  async eval<T>(expression: string): Promise<T> { const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + " " + (r.exceptionDetails.exception?.description ?? "")); return r.result.value as T; }
  close() { this.ws.close(); }
}

// Runs in the page: overflow offenders, squeezed tables, small touch targets, bottom-nav overlap.
// `vw` is the width we asked for: a mobile viewport silently widens when content overflows, so innerWidth cannot be trusted.
const measureScript = (vw: number) => `(() => {
  const vw = ${vw}, doc = document.documentElement;
  const desc = (el) => el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.') : '') + ' "' + (el.textContent || '').trim().slice(0, 30) + '"';
  const visible = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const scrollParent = (el) => { for (let p = el.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth) return p; } return null; };
  const offenders = [...document.querySelectorAll('body *')].filter((el) => visible(el) && getComputedStyle(el).position !== 'fixed' && el.getBoundingClientRect().right > vw + 1 && !scrollParent(el)).slice(0, 6).map(desc);
  const wraps = [...document.querySelectorAll('.qb-table-wrap')].filter(visible);
  const squeezedTables = vw <= 768 ? [...document.querySelectorAll('.qb-content table')].filter((t) => visible(t) && getComputedStyle(t.querySelector('thead') || t).display !== 'none' && t.querySelector('thead')).length : 0;
  const scrollingTables = wraps.filter((w) => w.scrollWidth > w.clientWidth + 1).length;
  const small = vw <= 768 ? [...document.querySelectorAll('.qb-content :is(button, a.qb-btn, select, input:not([type=checkbox]):not([type=radio]), summary)')].filter(visible).filter((el) => el.getBoundingClientRect().height < 32).slice(0, 6).map(desc) : [];
  const nav = document.querySelector('.qb-mobile-nav'); const navVisible = nav && visible(nav) && getComputedStyle(nav).position === 'fixed';
  window.scrollTo(0, document.body.scrollHeight);
  const last = document.querySelector('.qb-content')?.lastElementChild; const lastBottom = last ? last.getBoundingClientRect().bottom : 0;
  const navTop = navVisible ? nav.getBoundingClientRect().top : Infinity;
  const navRect = navVisible ? nav.getBoundingClientRect() : null;
  const stickyOverlaps = navRect ? [...document.querySelectorAll('.qb-content *')].filter((el) => visible(el) && ['sticky', 'fixed'].includes(getComputedStyle(el).position)).filter((el) => { const r = el.getBoundingClientRect(); return r.bottom > navRect.top + 1 && r.top < navRect.bottom; }).slice(0, 4).map(desc) : [];
  const result = { stickyOverlaps, innerWidth: window.innerWidth, scrollWidth: doc.scrollWidth, offenders, squeezedTables, scrollingTables, smallTargets: small, navObscuresContent: navVisible && lastBottom > navTop + 1, height: Math.max(doc.scrollHeight, document.body.scrollHeight), h1: document.querySelector('h1')?.textContent || null, errors: [...document.querySelectorAll('.qb-error')].map((e) => (e.textContent || '').slice(0, 80)) };
  window.scrollTo(0, 0); return result;
})()`;

const STEP_SCRIPTS = {
  clickText: (text: string) => `(() => { const t = ${JSON.stringify(text)}; const vis = (e) => e.getBoundingClientRect().width > 0 && !e.disabled; const pick = (sel) => [...document.querySelectorAll(sel)].filter(vis).find((e) => (e.textContent || '').trim().includes(t)); const el = pick('.qb-node') || pick('button, a, summary'); if (!el) return false; el.click(); return true; })()`,
  click: (selector: string) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; el.click(); return true; })()`,
  select: (selector: string, value: string) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('change', { bubbles: true })); return el.value === ${JSON.stringify(value)}; })()`,
  fill: (selector: string, value: string) => `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return false; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`,
};
async function runStep(cdp: Cdp, step: QaStep) {
  if ("wait" in step) { await sleep(step.wait); return; }
  const script = "clickText" in step ? STEP_SCRIPTS.clickText(step.clickText) : "click" in step ? STEP_SCRIPTS.click(step.click) : "select" in step ? STEP_SCRIPTS.select(step.select, step.value) : STEP_SCRIPTS.fill(step.fill, step.value);
  // The target may still be loading (curriculum tree, stepper step): retry for up to 10s before failing.
  let done = false;
  for (let i = 0; i < 40 && !done; i++) { done = await cdp.eval<boolean>(script); if (!done) await sleep(250); }
  if (!done) throw new Error(`step target not found: ${JSON.stringify(step)}`);
  for (let i = 0; i < 20; i++) { await sleep(250); if (!(await cdp.eval<boolean>(`!!document.querySelector('.qb-skeleton, [aria-busy="true"]')`))) break; }
}
const slug = (value: string) => value.replace(/\W+/g, "_").replace(/^_|_$/g, "") || "home";

async function main() {
  if (!/^[a-z]+$/.test(role)) throw new Error("INVALID_ROLE");
  const fixture: QaFixture = (await import(`./fixtures/${role}`))[`build${role[0].toUpperCase()}${role.slice(1)}Fixture`]();
  const all: QaRoute[] = fixture.routes.map((r) => typeof r === "string" ? { path: r, label: slug(r) } : r);
  const only = arg("routes", "").split(",").filter(Boolean);
  const routes = only.length ? all.filter((r) => only.includes(r.path) || only.includes(r.label)) : all;
  const outDir = join("reports", "qa", role); mkdirSync(outDir, { recursive: true });
  const browserPath = BROWSERS.find((p) => existsSync(p)); if (!browserPath) throw new Error("No Edge/Chrome found; set QA_BROWSER.");

  const api = await startFixtureServer(fixture, ORIGIN);
  let dev: ChildProcess | null = null, browser: ChildProcess | null = null, cdp: Cdp | null = null;
  const profileDir = mkdtempSync(join(tmpdir(), "qb-qa-"));
  const blocked: string[] = [];
  try {
    dev = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], { env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: FIXTURE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY: "qa-fixture-anon-key", NEXT_TELEMETRY_DISABLED: "1" }, stdio: "ignore" });
    for (let i = 0; i < 120; i++) { try { if ((await fetch(`${ORIGIN}/login`)).status < 500) break; } catch { /* starting */ } await sleep(1000); }
    browser = spawn(browserPath, [`--headless=new`, `--remote-debugging-port=${debugPort}`, `--user-data-dir=${profileDir}`, "--no-first-run", "--disable-gpu", "--hide-scrollbars", "--force-prefers-reduced-motion", "about:blank"], { stdio: "ignore" });
    let ws = ""; for (let i = 0; i < 40 && !ws; i++) { await sleep(500); try { const list = await (await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json() as Array<{ type: string; webSocketDebuggerUrl: string }>; ws = list.find((t) => t.type === "page")?.webSocketDebuggerUrl ?? ""; } catch { /* starting */ } }
    cdp = await Cdp.connect(ws);
    await cdp.send("Page.enable"); await cdp.send("Network.enable");
    // Safety net: nothing leaves loopback.
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*" }] });
    cdp.on((m) => { if (m.method !== "Fetch.requestPaused") return; const url = String(m.params.request.url); const local = /^(http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/|data:|blob:|about:)/.test(url); if (!local) blocked.push(url); void cdp!.send(local ? "Fetch.continueRequest" : "Fetch.failRequest", local ? { requestId: m.params.requestId } : { requestId: m.params.requestId, errorReason: "BlockedByClient" }).catch(() => {}); });
    const cookie = sessionCookie(fixture);
    await cdp.send("Network.setCookie", { name: cookie.name, value: cookie.value, url: ORIGIN, path: "/" });

    const rows: any[] = []; let failed = 0;
    for (const route of routes) for (const width of widths) {
      const label = route.label;
      const height = width < 600 ? 844 : 900;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 600 });
      await cdp.send("Page.navigate", { url: ORIGIN + route.path });
      let ready = false;
      for (let i = 0; i < 90 && !ready; i++) { await sleep(500); try { ready = await cdp.eval<boolean>(`!!document.querySelector('.qb-content h1, .qb-content h2, .qb-content .qb-player') && !document.querySelector('.qb-skeleton, [aria-busy="true"]')`); } catch { /* navigating */ } }
      let stepError = ""; try { for (const step of route.steps ?? []) await runStep(cdp, step); } catch (e) { stepError = (e as Error).message; }
      await cdp.eval(`(() => { const s = document.createElement('style'); s.textContent = '*,*::before,*::after{animation:none!important;transition:none!important;caret-color:transparent!important}'; document.head.appendChild(s); })()`);
      await sleep(400);
      const m = await cdp.eval<any>(measureScript(width));
      const shot = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: true, clip: { x: 0, y: 0, width, height: Math.min(m.height, 6000), scale: 1 } });
      const file = join(outDir, `${label}-${width}.png`);
      writeFileSync(file, Buffer.from(shot.data, "base64"));
      const problems = [stepError ? `step failed: ${stepError}` : null, m.stickyOverlaps.length ? `sticky element overlaps bottom nav: ${m.stickyOverlaps.join(" | ")}` : null, ready ? null : "page never finished loading", m.innerWidth !== width ? `viewport ${m.innerWidth}px, wanted ${width}` : null, m.scrollWidth > width ? `horizontal scroll (${m.scrollWidth} > ${width})` : null, m.offenders.length ? `overflowing: ${m.offenders.join(" | ")}` : null, m.squeezedTables ? `${m.squeezedTables} table(s) not converted to cards` : null, m.navObscuresContent ? "bottom nav covers content" : null, m.errors.length ? `error banner: ${m.errors.join(" | ")}` : null].filter(Boolean);
      if (problems.length) failed++;
      rows.push({ route: label, path: route.path, width, ok: !problems.length, problems, info: { scrollingTables: m.scrollingTables, smallTargets: m.smallTargets, h1: m.h1 }, screenshot: file });
      console.log(`${problems.length ? "FAIL" : "ok  "} ${label} @${width}${problems.length ? " - " + problems.join("; ") : ""}${m.smallTargets.length ? `  [small targets: ${m.smallTargets.length}]` : ""}`);
    }
    const report = { role, widths, routes: routes.map((r) => r.label), blockedExternalRequests: blocked, unhandledFixtureRequests: api.unhandled, mutationsAttempted: api.mutations, results: rows };
    writeFileSync(join(outDir, "responsive.json"), JSON.stringify(report, null, 2));
    console.log(`blocked external requests: ${blocked.length}; unhandled fixture requests: ${[...new Set(api.unhandled)].join(", ") || "none"}`);
    if (failed) process.exitCode = 1;
  } finally {
    cdp?.close(); browser?.kill(); dev?.kill(); if (process.platform === "win32" && dev?.pid) spawn("taskkill", ["/pid", String(dev.pid), "/T", "/F"], { stdio: "ignore" });
    await api.close(); await sleep(500); try { rmSync(profileDir, { recursive: true, force: true }); } catch { /* browser still releasing */ }
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
