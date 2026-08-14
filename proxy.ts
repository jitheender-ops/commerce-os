/**
 * Shared-password gate for a publicly reachable deployment.
 *
 * This console has no user accounts, and its buttons approve money and reset the
 * business. On a public URL that is a problem: anyone with the link can approve
 * a ₹2,00,000 purchase order or wipe the demo mid-presentation. One shared
 * password is the smallest thing that prevents it.
 *
 * Set `DEMO_PASSWORD` and the gate turns on. Leave it unset — as on a laptop —
 * and every request passes untouched, so local development is unaffected.
 *
 * HTTP Basic is deliberate: the browser draws the prompt, so there is no login
 * page, no session store and no password field to get wrong. A cookie is set on
 * success because `EventSource` cannot carry an Authorization header of its own,
 * and the live event stream has to keep working once you are through the door.
 *
 * That cookie holds the password itself rather than a signed token — httpOnly,
 * and `secure` over HTTPS, so it is not readable from script, but it is the
 * password and not a session. This is a demo gate, not an authentication
 * system: it keeps a passer-by from approving a purchase order, and it is not
 * built to survive an attacker who already has the browser.
 *
 * Next 16 renamed this file convention from `middleware` to `proxy`.
 */
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const COOKIE = "commerce_os_access";

export function proxy(request: NextRequest) {
  const password = process.env.DEMO_PASSWORD?.trim();
  if (!password) return NextResponse.next();

  if (equals(request.cookies.get(COOKIE)?.value ?? "", password)) {
    return NextResponse.next();
  }

  const header = request.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const decoded = safeDecode(encoded);
    const supplied = decoded.slice(decoded.indexOf(":") + 1);
    if (equals(supplied, password)) {
      const response = NextResponse.next();
      response.cookies.set(COOKIE, password, {
        httpOnly: true,
        sameSite: "lax",
        secure: request.nextUrl.protocol === "https:",
        path: "/",
        maxAge: 60 * 60 * 12,
      });
      return response;
    }
  }

  return new NextResponse("Authentication required.", {
    status: 401,
    headers: { "www-authenticate": `Basic realm="Commerce OS", charset="UTF-8"` },
  });
}

/**
 * Constant-time comparison. A plain `===` leaks the length of the matching
 * prefix through timing, which is exactly how a shared password gets guessed
 * character by character.
 */
function equals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeDecode(encoded: string): string {
  try {
    return atob(encoded);
  } catch {
    return "";
  }
}

export const config = {
  /**
   * Everything except Next's own assets and the health endpoint. A platform
   * health check that gets a 401 reads the deployment as failed and rolls it
   * back, so /api/health stays open and says nothing about the business.
   */
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health).*)"],
};
