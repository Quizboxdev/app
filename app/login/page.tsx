import { parseRegistrationParams } from "@/lib/public/registration-params";
import LoginForm from "./LoginForm";

// Supports public deep links such as /login?mode=register&role=student&country=GH.
// Query values are untrusted and validated before they reach the form.
export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <LoginForm initial={parseRegistrationParams(await searchParams)} />;
}
