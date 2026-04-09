import { PrismaClient } from '../../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { ENV } from '../config/index.js';

const pool = new pg.Pool({ connectionString: ENV.POSTGRES_URL });
const adapter = new PrismaPg(pool);
export const prisma = new PrismaClient({ adapter } as never);
