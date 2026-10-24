// Playwright MCP sweep (run with browser_run_code_unsafe, filename = this file).
// Visits each route at each width, saves a full-page screenshot, and records objective facts:
// status, console errors, failed requests, horizontal overflow, LCP/CLS, target sizes, missing alt/labels, axe-core violations.
// Public, read-only pages only. Edit BASE / ROUTES / WIDTHS / AXE_WIDTHS before a run.
async (page) => {
  const BASE = "https://www.quizbox.io";
  const OUT = "C:/Users/USER/OneDrive/Documents/QuizBox/Codes/QuizBox_Batch1_Student_Teacher_Assessment/docs/ux-audit/evidence/public/screenshots";
  const ROUTES = ["/terms", "/privacy", "/refunds", "/cookies", "/join/sme", "/join/country", "/auth/forgot-password", "/help/getting-started-learner"];
  const WIDTHS = [360, 390, 768, 1440];
  const AXE_WIDTHS = [390, 1440];
  const AXE_URL = "https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.0/axe.min.js";
  const slug = (r) => (r === "/" ? "home" : r.replace(/^\//, "").replace(/[^a-z0-9]+/gi, "-"));

  await page.addInitScript(() => {
    window.__qb = { lcp: 0, cls: 0 };
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__qb.lcp = e.startTime; }).observe({ type: "largest-contentful-paint", buffered: true }); } catch {}
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__qb.cls += e.value; }).observe({ type: "layout-shift", buffered: true }); } catch {}
  });

  const results = [];
  for (const route of ROUTES) {
    for (const w of WIDTHS) {
      const rec = { route, width: w };
      const errors = [], failed = [];
      const onConsole = (m) => { if (m.type() === "error") errors.push(m.text().slice(0, 200)); };
      const onFail = (r) => failed.push(r.url().slice(0, 120) + " " + (r.failure() && r.failure().errorText));
      const onResp = (r) => { if (r.status() >= 400) failed.push(r.status() + " " + r.url().slice(0, 120)); };
      page.on("console", onConsole); page.on("requestfailed", onFail); page.on("response", onResp);
      try {
        await page.setViewportSize({ width: w, height: w >= 768 ? 900 : 800 });
        const t0 = Date.now();
        const resp = await page.goto(BASE + route, { waitUntil: "load", timeout: 45000 });
        rec.status = resp && resp.status();
        rec.finalUrl = page.url().replace(BASE, "");
        rec.loadMs = Date.now() - t0;
        await page.waitForTimeout(1500);
        const facts = await page.evaluate(() => {
          const vis = (el) => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && s.display !== "none"; };
          const targets = [...document.querySelectorAll("a[href],button,input:not([type=hidden]),select,textarea,[role=button],[role=tab]")].filter(vis);
          const small = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 24 || r.height < 24; });
          const under44 = targets.filter((el) => { const r = el.getBoundingClientRect(); return r.width < 44 || r.height < 44; });
          const noAlt = [...document.querySelectorAll("img")].filter((i) => !i.hasAttribute("alt")).length;
          const unlabeled = [...document.querySelectorAll("input:not([type=hidden]):not([type=submit]):not([type=button]),select,textarea")].filter((el) => {
            if (el.getAttribute("aria-label") || el.getAttribute("aria-labelledby")) return false;
            if (el.id && document.querySelector('label[for="' + el.id + '"]')) return false;
            return !el.closest("label");
          }).length;
          const px = parseFloat(getComputedStyle(document.body).fontSize);
          return {
            title: document.title, lang: document.documentElement.lang, h1: document.querySelectorAll("h1").length,
            h1Text: (document.querySelector("h1") || {}).innerText && document.querySelector("h1").innerText.slice(0, 80),
            overflowX: document.documentElement.scrollWidth > window.innerWidth + 1,
            scrollW: document.documentElement.scrollWidth, innerW: window.innerWidth,
            lcpMs: Math.round(window.__qb.lcp), cls: +window.__qb.cls.toFixed(4),
            interactive: targets.length, smallUnder24: small.length, under44: under44.length,
            smallSamples: small.slice(0, 4).map((e) => (e.innerText || e.getAttribute("aria-label") || e.tagName).trim().slice(0, 30)),
            imgsNoAlt: noAlt, unlabeledFields: unlabeled, bodyFontPx: px,
            hasSkipLink: !!document.querySelector('a[href^="#main"],a[href="#content"],a.skip-link'),
            hasMain: !!document.querySelector("main,[role=main]"), viewportMeta: !!document.querySelector('meta[name=viewport]'),
            textLen: document.body.innerText.length,
          };
        });
        Object.assign(rec, facts);
        if (AXE_WIDTHS.includes(w)) {
          try {
            await page.addScriptTag({ url: AXE_URL });
            rec.axe = await page.evaluate(async () => {
              const r = await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] } });
              return r.violations.map((v) => ({ id: v.id, impact: v.impact, nodes: v.nodes.length, help: v.help, sample: v.nodes[0] && v.nodes[0].target.join(" ").slice(0, 80) }));
            });
          } catch (e) { rec.axe = "axe failed: " + String(e).slice(0, 80); }
        }
        await page.screenshot({ path: OUT + "/" + slug(route) + "-" + w + ".png", fullPage: true, timeout: 30000 });
      } catch (e) { rec.error = String(e).slice(0, 160); }
      rec.consoleErrors = errors.slice(0, 5); rec.failedRequests = failed.slice(0, 5);
      page.off("console", onConsole); page.off("requestfailed", onFail); page.off("response", onResp);
      results.push(rec);
    }
  }
  return results;
}
