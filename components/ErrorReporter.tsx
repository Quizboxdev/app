"use client";

import { useEffect } from "react";
import { reportClientError } from "@/lib/monitoring/report";

// Reports errors nobody caught (script errors and rejected promises) from any page. Renders nothing.
export default function ErrorReporter() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => reportClientError("UNHANDLED", e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => reportClientError("UNHANDLED", e.reason);
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => { window.removeEventListener("error", onError); window.removeEventListener("unhandledrejection", onRejection); };
  }, []);
  return null;
}
