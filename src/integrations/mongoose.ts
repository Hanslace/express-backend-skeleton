import mongoose from 'mongoose';
import { ENV } from '../config/index.js';

export async function connectMongo() {
  await mongoose.connect(ENV.MONGO_URL);
  console.log('MongoDB connected');
}
