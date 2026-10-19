import { NextResponse, type NextRequest } from "next/server";
import { challengeHostRedirect } from "@/lib/challenges/host";

// Only the challenge.quizbox.io host is touched (see lib/challenges/host.ts). Every other request passes straight through.
export function middleware(request: NextRequest) {
  const target = challengeHostRedirect(request.headers.get("host"), request.nextUrl.pathname);
  return target ? NextResponse.redirect(target, 307) : NextResponse.next();
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
