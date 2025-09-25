import { MongoClient, Db } from 'mongodb';
import { config } from '../config';

let clientPromise: Promise<MongoClient> | null = null;
let hasLoggedSuccessfulConnection = false;

export function isMongoConfigured(): boolean {
  const isTestEnv = process.env.NODE_ENV === 'test' && process.env.USE_REAL_MONGO_IN_TESTS !== 'true';

  if (isTestEnv) {
    return false;
  }

  return Boolean(config.mongoUri && config.mongoDbName);
}

export async function getMongoClient(): Promise<MongoClient> {
  if (!isMongoConfigured()) {
    throw new Error('MongoDB is not configured. Set MONGO_URI and MONGO_DB_NAME.');
  }

  if (!clientPromise) {
    clientPromise = new MongoClient(config.mongoUri)
      .connect()
      .catch(error => {
        clientPromise = null;
        throw error;
      });
  }

  return clientPromise;
}

export async function getMongoDatabase(): Promise<Db> {
  const client = await getMongoClient();
  return client.db(config.mongoDbName);
}

export async function closeMongoClient(): Promise<void> {
  if (!clientPromise) {
    return;
  }

  try {
    const client = await clientPromise;
    await client.close();
  } finally {
    clientPromise = null;
  }
}

export async function ensureMongoConnection(): Promise<boolean> {
  if (!isMongoConfigured()) {
    return false;
  }

  const client = await getMongoClient();

  if (!hasLoggedSuccessfulConnection) {
    console.log(`✅ Connected to MongoDB: ${client.db().databaseName}`);
    hasLoggedSuccessfulConnection = true;
  }

  return client !== undefined;
}
