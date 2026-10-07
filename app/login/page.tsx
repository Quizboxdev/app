import { redirect } from "next/navigation";
import { parseRegistrationParams } from "@/lib/public/registration-params";
import { authCallbackHref, hasAuthLinkParams } from "@/lib/auth-links";
import LoginForm from "./LoginForm";

// Supports public deep links such as /login?mode=register&role=student&country=GH.
// Query values are untrusted and validated before they reach the form. Email-link results (?code=, ?error_code=) that land here
// because the Supabase redirect URL fell back to this page are completed by the auth callback instead.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  if (hasAuthLinkParams(params)) redirect(authCallbackHref(params));
  return <LoginForm initial={parseRegistrationParams(params)} />;
}
