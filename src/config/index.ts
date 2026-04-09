import { ENV_SECRETS } from './env.js';
import { APP_CONFIG } from './app.js';

export const ENV = { ...ENV_SECRETS, ...APP_CONFIG };
