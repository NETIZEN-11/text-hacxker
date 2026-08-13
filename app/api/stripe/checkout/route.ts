import { getCurrentUser } from "@/lib/auth"
import config from "@/lib/config"
import { PLANS, stripeClient } from "@/lib/stripe"
import { NextRequest, NextResponse } from "next/server"

export async function POST(request: NextRequest) {
  // Checkout must be tied to a logged-in user so the webhook can map
  // the resulting Stripe customer to the right account.
  const user = await getCurrentUser()

  const { searchParams } = new URL(request.url)
  const code = searchParams.get("code")

  if (!code) {
    return NextResponse.json({ error: "Missing plan code" }, { status: 400 })
  }

  if (!stripeClient) {
    return NextResponse.json({ error: "Stripe is not enabled" }, { status: 500 })
  }

  const plan = PLANS[code]
  if (!plan || !plan.isAvailable) {
    return NextResponse.json({ error: "Invalid or inactive plan" }, { status: 400 })
  }

  try {
    const session = await stripeClient.checkout.sessions.create({
      billing_address_collection: "auto",
      customer_email: user.email,
      client_reference_id: user.id,
      line_items: [
        {
          price: plan.stripePriceId,
          quantity: 1,
        },
      ],
      mode: "subscription",
      automatic_tax: {
        enabled: true,
      },
      allow_promotion_codes: true,
      success_url: config.stripe.paymentSuccessUrl,
      cancel_url: config.stripe.paymentCancelUrl,
    })

    if (!session.url) {
      return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
    }

    return NextResponse.json({ session })
  } catch (error) {
    console.error("Stripe checkout error", error instanceof Error ? error.message : "unknown")
    return NextResponse.json({ error: "Failed to create checkout session" }, { status: 500 })
  }
}
