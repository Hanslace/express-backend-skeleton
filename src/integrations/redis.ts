import Redis from 'ioredis';
import { ENV } from '../config/index.js';

export const redis = new Redis(ENV.REDIS_URL);
