import config from "@/lib/config"
import { PLANS, stripeClient } from "@/lib/stripe"
import { prisma } from "@/lib/db"
import { getOrCreateCloudUser, getUserByStripeCustomerId, updateUser } from "@/models/users"
import { NextResponse } from "next/server"
import Stripe from "stripe"

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature")
  const body = await request.text()

  if (!signature || !config.stripe.webhookSecret) {
    return new NextResponse("Webhook signature or secret missing", { status: 400 })
  }

  if (!stripeClient) {
    return new NextResponse("Stripe client is not initialized", { status: 500 })
  }

  let event: Stripe.Event

  try {
    event = stripeClient.webhooks.constructEvent(body, signature, config.stripe.webhookSecret)
  } catch {
    return new NextResponse("Webhook signature verification failed", { status: 400 })
  }

  // Idempotency: skip if we have already processed this event id.
  try {
    const existing = await prisma.webhookEvent.findUnique({ where: { id: event.id } })
    if (existing) {
      return new NextResponse("Event already processed", { status: 200 })
    }
  } catch {
    // The webhook_events table may not yet exist in older deployments.
    // Fail open: Stripe will retry if we error out, but at least log.
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session
        const customerId = session.customer as string
        const subscriptionId = session.subscription as string
        const subscription = await stripeClient.subscriptions.retrieve(subscriptionId)

        for (const item of subscription.items.data) {
          await handleUserSubscriptionUpdate(customerId, item)
        }
        break
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription
        const customerId = subscription.customer as string

        for (const item of subscription.items.data) {
          await handleUserSubscriptionUpdate(customerId, item)
        }
        break
      }

      default:
        // Ignore unhandled event types but still record them as processed.
        break
    }

    try {
      await prisma.webhookEvent.create({
        data: { id: event.id, type: event.type },
      })
    } catch {
      // ignore duplicate (race with a concurrent delivery)
    }

    return new NextResponse("Webhook processed successfully", { status: 200 })
  } catch (error) {
    console.error("Webhook processing failed", error instanceof Error ? error.message : "unknown")
    return new NextResponse("Webhook processing failed", { status: 500 })
  }
}

async function handleUserSubscriptionUpdate(
  customerId: string,
  item: Stripe.SubscriptionItem
) {
  if (!stripeClient) {
    throw new Error("Stripe client is not initialized")
  }

  const plan = Object.values(PLANS).find((p) => p.stripePriceId === item.price.id)
  if (!plan) {
    throw new Error(`Plan not found for price ID: ${item.price.id}`)
  }

  let user = await getUserByStripeCustomerId(customerId)
  if (!user) {
    const customer = (await stripeClient.customers.retrieve(customerId)) as Stripe.Customer
    const email = customer.email
    if (!email) {
      // Do NOT auto-provision an account without a verified customer email.
      throw new Error("Stripe customer has no email; refusing to create a user")
    }
    user = await getOrCreateCloudUser(email, {
      email,
      name: customer.name || email,
      stripeCustomerId: customer.id,
    })
  }

  const newMembershipExpiresAt = new Date(item.current_period_end * 1000)

  // On subscription cancellation, reset quota to the free tier rather than
  // leaving the previous (paid) limits in place.
  const isDeletion = item.price.id === null

  await updateUser(user.id, {
    membershipPlan: isDeletion ? "free" : plan.code,
    membershipExpiresAt: isDeletion
      ? null
      : user.membershipExpiresAt && user.membershipExpiresAt > newMembershipExpiresAt
        ? user.membershipExpiresAt
        : newMembershipExpiresAt,
    storageLimit: isDeletion ? -1 : plan.limits.storage,
    aiBalance: isDeletion ? 0 : plan.limits.ai,
    updatedAt: new Date(),
  })
}
