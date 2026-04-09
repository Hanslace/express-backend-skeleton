function required(name: string): string {
  const val = process.env[name];
  if (!val) throw new Error(`Missing required env var: ${name}`);
  return val;
}

function optional(name: string, fallback = ''): string {
  return process.env[name] ?? fallback;
}

export const ENV_SECRETS = {
  NODE_ENV:              required('NODE_ENV'),
  PORT:                  optional('PORT', '3000'),
  POSTGRES_URL:          required('POSTGRES_URL'),
  MONGO_URL:             required('MONGO_URL'),
  REDIS_URL:             required('REDIS_URL'),
  JWT_SECRET:            required('JWT_SECRET'),
  MAIL_URL:              required('MAIL_URL'),
  MAIL_FROM:             required('MAIL_FROM'),
  STRIPE_SECRET_KEY:     required('STRIPE_SECRET_KEY'),
  STRIPE_WEBHOOK_SECRET: required('STRIPE_WEBHOOK_SECRET'),
};
