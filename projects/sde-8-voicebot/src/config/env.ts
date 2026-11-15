import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(5000),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PREFIX: z.string().default('/api/v1'),
  CORS_ORIGIN: z.string().default('*'),
  SESSION_TIMEOUT_MINUTES: z.coerce.number().int().positive().default(30),
  MAX_CONCURRENT_SESSIONS: z.coerce.number().int().positive().default(100),
  MAX_PAYLOAD_LIMIT: z.string().default('100kb'),
  MOCK_MODE: z
    .string()
    .transform((val) => val === 'true' || val === '1')
    .default('true')
});

export type EnvConfig = z.infer<typeof envSchema>;

export const validateEnv = (rawEnv: Record<string, unknown> = process.env): EnvConfig => {
  const result = envSchema.safeParse(rawEnv);
  if (!result.success) {
    const errorDetails = result.error.format();
    throw new Error(`Invalid environment configuration: ${JSON.stringify(errorDetails)}`);
  }
  return result.data;
};

// Safe mock defaults out-of-the-box: starts without any secrets
export const env: EnvConfig = validateEnv();
