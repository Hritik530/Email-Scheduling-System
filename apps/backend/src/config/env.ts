import dotenv from 'dotenv';
import path from 'path';
import { z } from 'zod';

// Load root .env when running in workspace or local dev
dotenv.config({ path: path.resolve(__dirname, '../../../../.env') });
dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_URL: z.string().url().default('http://localhost:4000'),

  DATABASE_URL: z
    .string()
    .min(1)
    .default('postgresql://reachinbox:reachinbox_password@localhost:5432/reachinbox_db?schema=public'),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  ELASTICSEARCH_URL: z.string().url().default('http://localhost:9200'),
  ELASTICSEARCH_INDEX: z.string().min(1).default('reachinbox_emails'),

  GOOGLE_CLIENT_ID: z.string().default(''),
  GOOGLE_CLIENT_SECRET: z.string().default(''),
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default('http://localhost:4000/api/auth/google/callback'),

  SLACK_CLIENT_ID: z.string().default(''),
  SLACK_CLIENT_SECRET: z.string().default(''),
  SLACK_REDIRECT_URI: z
    .string()
    .url()
    .default('http://localhost:4000/api/slack/callback'),

  SESSION_SECRET: z
    .string()
    .min(16)
    .default('dev-session-secret-change-in-production-32chars'),
  ENCRYPTION_KEY: z
    .string()
    .min(16)
    .default('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'),

  ETHEREAL_HOST: z.string().default('smtp.ethereal.email'),
  ETHEREAL_PORT: z.coerce.number().int().positive().default(587),
  ETHEREAL_USER: z.string().default(''),
  ETHEREAL_PASS: z.string().default(''),

  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(100).default(5),
  MAX_RETRY_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(3),
  RETRY_DELAY: z.coerce.number().int().min(100).default(5000),
  DEFAULT_EMAIL_DELAY: z.coerce.number().int().min(0).default(2000),
  MIN_EMAIL_DELAY_MS: z.coerce.number().int().min(0).default(2000),
  MAX_EMAILS_PER_HOUR_PER_SENDER: z.coerce.number().int().min(1).default(100),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  throw new Error('Environment validation failed');
}

export const env = parsed.data;
export type EnvConfig = typeof env;
