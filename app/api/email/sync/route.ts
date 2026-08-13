import { getCurrentUser } from "@/lib/auth"
import { runEmailSync } from "@/lib/email-sync/ingest"
import { NextRequest, NextResponse } from "next/server"

export async function POST(_request: NextRequest) {
  try {
    // Verify user is authenticated
    const user = await getCurrentUser()

    // Run the email sync ONLY for the calling user. Previously this called
    // fetchEmails() which synced every tenant on the instance, allowing any
    // authenticated user to trigger work for all users (DoS / data plane abuse).
    const results = await runEmailSync({ userId: user.id })

    const processed = results.reduce((acc, r) => acc + r.processed, 0)
    const errored = results.filter((r) => r.status === "error").length

    return NextResponse.json({
      success: true,
      message: "Email sync completed successfully",
      processed,
      errored,
      timestamp: new Date().toISOString(),
    })
  } catch (error) {
    console.error("Manual email sync failed", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Email sync failed" }, { status: 500 })
  }
}

export async function GET(_request: NextRequest) {
  try {
    // Verify user is authenticated
    const user = await getCurrentUser()

    return NextResponse.json({
      message: "Email sync API is ready",
      endpoint: "/api/email/sync",
      methods: ["POST"],
      description: "Trigger manual email synchronization",
    })
  } catch (_error) {
    return NextResponse.json({ error: "Failed to get sync status" }, { status: 500 })
  }
}
