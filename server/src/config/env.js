import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const envLocalPath = resolve(projectRoot, ".env.local");
const envPath = existsSync(envLocalPath) ? envLocalPath : resolve(projectRoot, ".env");

if (existsSync(envPath)) {
  dotenv.config({ path: envPath });
}

const requiredVariables = [
  "DATABASE_URL",
  "AWS_ENDPOINT_URL_S3",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_REGION",
];
const missingVariables = requiredVariables.filter((name) => !process.env[name]);

if (missingVariables.length > 0) {
  throw new Error(`Missing required environment variables: ${missingVariables.join(", ")}`);
}

const nodeEnv = process.env.NODE_ENV ?? "development";

export const env = {
  nodeEnv,
  isProduction: nodeEnv === "production",
  port: Number(process.env.PORT ?? 3000),
  /**
   * How many proxies sit in front of the API, so `request.ip` is the visitor (sign-in limits are
   * per person, not per proxy). 0 locally; 2 on Render behind the Vercel rewrite (Vercel → Render).
   */
  trustProxy: Number(process.env.TRUST_PROXY ?? 0),
  /** Browser origins allowed to call the API with cookies (CSRF + CORS allow-list). */
  clientOrigins: (process.env.CLIENT_ORIGINS ?? "http://localhost:5173,http://127.0.0.1:5173")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
  sessionDays: Number(process.env.SESSION_DAYS ?? 7),
  /** bcrypt work factor. Lowered only by the test suite for speed. */
  bcryptCost: Number(process.env.BCRYPT_COST ?? 12),
  /** Public address of the website, used for links inside emails (HashRouter: appUrl + "#/path"). */
  appUrl: (process.env.APP_URL ?? "http://127.0.0.1:5173/Doctor-platform/").replace(/\/?$/, "/"),
  /** Outgoing email. Without SMTP_HOST the server prints emails to the console instead. */
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT ?? 465),
    user: process.env.SMTP_USER,
    password: process.env.SMTP_PASSWORD,
    from: process.env.MAIL_FROM ?? process.env.SMTP_USER ?? "Carewell <no-reply@carewell.local>",
  },
  /** Where help-page messages are emailed (default: the mailbox the API sends from). */
  supportEmail: process.env.SUPPORT_EMAIL ?? process.env.SMTP_USER ?? "",
  databaseUrl: process.env.DATABASE_URL,
  storageEndpoint: process.env.AWS_ENDPOINT_URL_S3,
  storageAccessKeyId: process.env.AWS_ACCESS_KEY_ID,
  storageSecretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  storageRegion: process.env.AWS_REGION,
  storageBucket: process.env.S3_BUCKET ?? "assets",
};

if (!Number.isInteger(env.port) || env.port < 1 || env.port > 65535) {
  throw new Error("PORT must be an integer between 1 and 65535");
}
