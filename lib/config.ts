import { z } from "zod"
import packageJson from "../package.json"

const envSchema = z.object({
  BASE_URL: z.string().url().default("http://localhost:7331"),
  PORT: z.string().default("7331"),
  SELF_HOSTED_MODE: z.enum(["true", "false"]).default("true"),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL_NAME: z.string().default("gpt-4o-mini"),
  GOOGLE_API_KEY: z.string().optional(),
  GOOGLE_MODEL_NAME: z.string().default("gemini-2.5-flash"),
  MISTRAL_API_KEY: z.string().optional(),
  MISTRAL_MODEL_NAME: z.string().default("mistral-medium-latest"),
  BETTER_AUTH_SECRET: z
    .string()
    .min(32, "Auth secret must be at least 32 characters")
    .refine(
      (v) => v !== "please-set-your-key-here" && !/^please[-_]?set/.test(v),
      { message: "BETTER_AUTH_SECRET must be set to a strong value; the default placeholder is not allowed" }
    ),
  DISABLE_SIGNUP: z.enum(["true", "false"]).default("false"),
  RESEND_API_KEY: z.string().refine(
    (v) => v !== "please-set-your-resend-api-key-here" && !/^please[-_]?set/.test(v),
    { message: "RESEND_API_KEY must be set to a real key; the default placeholder is not allowed" }
  ),
  RESEND_FROM_EMAIL: z.string().default("TaxHacker <user@localhost>"),
  RESEND_AUDIENCE_ID: z.string().default(""),
  STRIPE_SECRET_KEY: z.string().default(""),
  STRIPE_WEBHOOK_SECRET: z.string().default(""),
})

const env = envSchema.parse(Object.fromEntries(Object.entries(process.env).filter(([, value]) => value !== "")))

if (env.SELF_HOSTED_MODE === "true" && !process.env.BETTER_AUTH_SECRET) {
  // In self-hosted mode, generate a stable per-install secret so the default
  // placeholder is never used to sign sessions or derive encryption keys.
  // Operators who want to share sessions across replicas should still set
  // BETTER_AUTH_SECRET explicitly in the environment.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const crypto = require("crypto") as typeof import("crypto")
  const fs = require("fs") as typeof import("fs")
  const path = require("path") as typeof import("path")
  const secretFile = path.join(process.cwd(), "data", ".better-auth-secret")
  let stored = ""
  try {
    stored = fs.readFileSync(secretFile, "utf8").trim()
  } catch {
    stored = crypto.randomBytes(48).toString("base64")
    try {
      fs.mkdirSync(path.dirname(secretFile), { recursive: true })
      fs.writeFileSync(secretFile, stored, { mode: 0o600 })
    } catch {
      // If we cannot persist, fall back to an in-process secret. Sessions
      // will not survive restarts but the service will still start.
      stored = crypto.randomBytes(48).toString("base64")
    }
  }
  ;(env as Record<string, unknown>).BETTER_AUTH_SECRET = stored
}

const config = {
  app: {
    title: "TaxHacker",
    description: "Your personal AI accountant",
    version: packageJson.version || "0.0.1",
    baseURL: env.BASE_URL || `http://localhost:${env.PORT || "7331"}`,
    supportEmail: "me@vas3k.com",
  },
  upload: {
    acceptedMimeTypes: "image/*,.pdf,.doc,.docx,.xls,.xlsx",
    images: {
      maxWidth: 1800,
      maxHeight: 1800,
      quality: 90,
    },
    pdfs: {
      maxPages: 10,
      dpi: 150,
      quality: 90,
      maxWidth: 1500,
      maxHeight: 1500,
    },
  },
  selfHosted: {
    isEnabled: env.SELF_HOSTED_MODE === "true",
    redirectUrl: "/self-hosted/redirect",
    welcomeUrl: "/self-hosted",
  },
  ai: {
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModelName: env.OPENAI_MODEL_NAME,
    googleApiKey: env.GOOGLE_API_KEY,
    googleModelName: env.GOOGLE_MODEL_NAME,
    mistralApiKey: env.MISTRAL_API_KEY,
    mistralModelName: env.MISTRAL_MODEL_NAME,
  },
  auth: {
    secret: env.BETTER_AUTH_SECRET,
    loginUrl: "/enter",
    disableSignup: env.DISABLE_SIGNUP === "true" || env.SELF_HOSTED_MODE === "true",
  },
  stripe: {
    secretKey: env.STRIPE_SECRET_KEY,
    webhookSecret: env.STRIPE_WEBHOOK_SECRET,
    paymentSuccessUrl: `${env.BASE_URL}/cloud/payment/success?session_id={CHECKOUT_SESSION_ID}`,
    paymentCancelUrl: `${env.BASE_URL}/cloud`,
  },
  email: {
    apiKey: env.RESEND_API_KEY,
    from: env.RESEND_FROM_EMAIL,
    audienceId: env.RESEND_AUDIENCE_ID,
  },
} as const

export default config
