"use client";

import { createContext, useContext } from "react";

// Whether the gated sponsor competition engine is on (lib/competition/local-gate.ts). Its env flag is server-only, so the
// (app) layout evaluates the gate and AppShell provides the answer to client pages, which hide links to pages that 404.
const SponsorEngineContext = createContext(false);
export const SponsorEngineProvider = SponsorEngineContext.Provider;
export const useSponsorEngine = () => useContext(SponsorEngineContext);
