"use server"

import config from "@/lib/config"
import { resend, sendNewsletterWelcomeEmail } from "@/lib/email"

// Loose in-process rate limit: at most N subscriptions per IP per M minutes.
// Suitable for a landing page; for production this should be backed by
// durable storage (e.g. Upstash) to survive restarts and span replicas.
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000
const rateLimitMap = new Map<string, number[]>()

function isRateLimited(ip: string): boolean {
  const now = Date.now()
  const arr = (rateLimitMap.get(ip) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS)
  arr.push(now)
  rateLimitMap.set(ip, arr)
  return arr.length > RATE_LIMIT_MAX
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export async function subscribeToNewsletterAction(email: string, meta?: { ip?: string }) {
  try {
    if (typeof email !== "string") {
      return { success: false, error: "Invalid email address" }
    }
    const normalized = email.trim().toLowerCase().slice(0, 320)
    if (!EMAIL_RE.test(normalized)) {
      return { success: false, error: "Invalid email address" }
    }

    if (isRateLimited(meta?.ip || "unknown")) {
      return { success: false, error: "Too many requests. Please try again later." }
    }

    // Don't pull the full audience list just to check for duplicates — that
    // both leaks existing emails via timing and is unbounded. Resend will
    // handle dedup on the create call.
    try {
      await resend.contacts.create({
        email: normalized,
        audienceId: config.email.audienceId,
        unsubscribed: false,
      })
    } catch (error: unknown) {
      // Treat "already exists" as success.
      const message = error instanceof Error ? error.message : String(error)
      if (!/exists|already/i.test(message)) {
        throw error
      }
    }

    try {
      await sendNewsletterWelcomeEmail(normalized)
    } catch (error) {
      console.error("Welcome email failed", error instanceof Error ? error.message : "unknown")
    }

    return { success: true }
  } catch (error) {
    console.error("Newsletter subscription error", error instanceof Error ? error.message : "unknown")
    return { error: "Failed to subscribe. Please try again later." }
  }
}
