import { getSession } from "@/lib/auth"
import { getOrCreateProgress, getProgressById } from "@/models/progress"
import { NextRequest, NextResponse } from "next/server"

const POLL_INTERVAL_MS = 2000 // 2 seconds
const ALLOWED_PROGRESS_TYPES = new Set([
  "transactions.import",
  "transactions.export",
  "files.upload",
  "email.sync",
  "unknown",
])

export async function GET(req: NextRequest, { params }: { params: Promise<{ progressId: string }> }) {
  const session = await getSession()
  if (!session || !session.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const userId = session.user.id
  const { progressId } = await params
  const url = new URL(req.url)
  const rawType = url.searchParams.get("type") || "unknown"
  // Whitelist the `type` parameter so it can't be used to pollute the
  // Progress table with arbitrary, attacker-controlled strings.
  const type = ALLOWED_PROGRESS_TYPES.has(rawType) ? rawType : "unknown"

  await getOrCreateProgress(userId, progressId, type)

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      let lastSent: unknown = null
      let stopped = false

      req.signal.addEventListener("abort", () => {
        stopped = true
        controller.close()
      })

      while (!stopped) {
        const progress = await getProgressById(userId, progressId)
        if (!progress) {
          controller.enqueue(encoder.encode(`event: error\ndata: {"error":"Not found"}\n\n`))
          controller.close()
          break
        }

        // Only send if progress has changed
        if (JSON.stringify(progress) !== JSON.stringify(lastSent)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(progress)}\n\n`))
          lastSent = progress

          // If progress is complete, close the connection
          if (progress.current === progress.total && progress.total > 0) {
            controller.close()
            break
          }
        }

        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS))
      }
    },
  })

  // Echo the request Origin back instead of the wildcard "*" so that
  // cross-site pages cannot subscribe to event streams.
  const origin = req.headers.get("origin")
  const allowOrigin = origin && /^https?:\/\//.test(origin) ? origin : "null"

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "Access-Control-Allow-Origin": allowOrigin,
      "Access-Control-Allow-Credentials": "true",
    },
  })
}
