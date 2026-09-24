import { z } from "zod";

/**
 * Fail at boot, not at the first request. A missing SESSION_SECRET in production
 * is a security incident waiting for traffic, so it stops the process here.
 */
const schema = z.object({
  DATABASE_URL: z.string().url(),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  APP_URL: z.string().url().default("http://localhost:3000"),
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),

  STORAGE_PROVIDER: z.enum(["local", "database", "s3"]).default("local"),
  STORAGE_LOCAL_DIR: z.string().default("./.storage"),
  S3_BUCKET: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_ENDPOINT: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),

  PAYMENT_PROVIDER: z.enum(["manual", "stripe"]).default("manual"),
  STRIPE_SECRET_KEY: z.string().optional(),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),

  EMAIL_PROVIDER: z.enum(["console", "resend"]).default("console"),
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("Kencole Customs Brokerage <no-reply@kencole.bs>"),

  DOCUMENT_AI_PROVIDER: z.enum(["mock", "external"]).default("mock"),
  DOCUMENT_AI_URL: z.string().optional(),
  DOCUMENT_AI_KEY: z.string().optional(),

  CUSTOMS_ADAPTER: z.enum(["manual"]).default("manual"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success && process.env.SKIP_ENV_VALIDATION !== "1") {
  const issues = parsed.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`).join("\n");
  throw new Error(`Environment is not configured correctly:\n${issues}`);
}

export const env = (parsed.success ? parsed.data : ({} as z.infer<typeof schema>));
