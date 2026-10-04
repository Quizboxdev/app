import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";

// Next preserves JSX; compile just these render fixtures without changing its compiler configuration.
function component<Props>(name: string): React.ComponentType<Props> {
  const source = readFileSync(`components/${name}.tsx`, "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS } });
  const compiledModule = { exports: {} as { default: React.ComponentType<Props> } };
  runInNewContext(compiled.outputText, { module: compiledModule, exports: compiledModule.exports, require: createRequire(import.meta.url) });
  return compiledModule.exports.default;
}
const DashboardHero = component<{ eyebrow: string; title: string; description: string; primary: { label: string; href: string }; secondary?: { label: string; href: string } }>("DashboardHero");
const StatCard = component<{ label: string; value: number | string | null; hint?: string }>("StatCard");

describe("UI reference dashboard presentation", () => {
  it("links the hero to existing actions without prototype navigation", () => {
    const html = renderToStaticMarkup(React.createElement(DashboardHero, {
      eyebrow: "Teacher workspace", title: "Your classes at a glance.", description: "Monitor learner progress.",
      primary: { label: "Manage assignments", href: "/teacher/assignments" },
      secondary: { label: "View classes", href: "/teacher/classes" },
    }));
    expect(html).toContain('href="/teacher/assignments"');
    expect(html).toContain('href="/teacher/classes"');
    expect(html).toContain("qb-dashboard-hero");
    expect(html).not.toMatch(/data-route|Primary action|Reference screen/);
  });

  it("keeps zero a real metric", () => {
    const html = renderToStaticMarkup(React.createElement(StatCard, { label: "Assignments", value: 0 }));
    expect(html).toContain('qb-stat-value">0<');
    expect(html).not.toContain("No data yet");
    expect(html).toContain('aria-hidden="true"');
  });

  it("shows a missing metric without inventing values", () => {
    const html = renderToStaticMarkup(React.createElement(StatCard, { label: "Competition rank", value: null, hint: "Join a ranked competition" }));
    expect(html).toContain("No data yet");
    expect(html).toContain("Join a ranked competition");
    expect(html).not.toContain("342");
  });

  it("does not expose prototype copy in the six dashboards", () => {
    for (const route of ["student", "teacher", "sponsor", "review", "school", "admin"]) {
      const source = readFileSync(`app/(app)/${route}/page.tsx`, "utf8");
      expect(source).not.toMatch(/Static design reference|Illustrative|Reference screen|data-route=/);
      expect(source).toMatch(/DashboardHero|qb-welcome/);
    }
  });

  it("retains role enforcement and the full mobile navigation", () => {
    const shell = readFileSync("components/AppShell.tsx", "utf8");
    expect(shell).toContain("allowedPrefixes.some");
    expect(shell).toContain("router.replace(getHomeRouteForRole(role))");
    expect(shell).toContain('aria-label="All sections"');
    expect(shell).toContain('aria-current={href === activeHref ? "page" : undefined}');
  });

  it("uses the kit palette, compact geometry and responsive grids", () => {
    const css = readFileSync("app/globals.css", "utf8");
    for (const value of ["#f6f8fc", "#1769e8", "#10203b", "--sidebar-w: 224px", "--topbar-h: 64px"]) expect(css).toContain(value);
    expect(css).toContain("grid-template-columns: repeat(2,minmax(0,1fr))");
    expect(css).toContain("prefers-reduced-motion: reduce");
    expect(css).toContain(".qb-dashboard-hero");
  });
});
