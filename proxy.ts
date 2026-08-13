import { default as globalConfig } from "@/lib/config"
import { getSessionCookie } from "better-auth/cookies"
import { NextRequest, NextResponse } from "next/server"

const SELF_HOSTED_PASSWORD_COOKIE = "taxhacker-sh-pass"

export async function proxy(request: NextRequest) {
  if (globalConfig.selfHosted.isEnabled) {
    // When SELF_HOSTED_PASSWORD is set, require a matching cookie. This
    // means a fresh deploy on a public network is no longer wide open.
    const required = process.env.SELF_HOSTED_PASSWORD
    if (required) {
      const provided = request.cookies.get(SELF_HOSTED_PASSWORD_COOKIE)?.value
      if (provided !== required) {
        const url = new URL("/self-hosted/login", request.url)
        url.searchParams.set("next", request.nextUrl.pathname + request.nextUrl.search)
        return NextResponse.redirect(url)
      }
    }
    return NextResponse.next()
  }

  const sessionCookie = getSessionCookie(request, { cookiePrefix: "taxhacker" })
  if (!sessionCookie) {
    return NextResponse.redirect(new URL(globalConfig.auth.loginUrl, request.url))
  }
  return NextResponse.next()
}

export const config = {
  matcher: [
    "/transactions/:path*",
    "/settings/:path*",
    "/export/:path*",
    "/import/:path*",
    "/unsorted/:path*",
    "/files/:path*",
    "/dashboard/:path*",
    "/agents/:path*",
  ],
}
