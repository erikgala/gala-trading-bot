import { MongoClient, Db } from 'mongodb';
import { config } from '../config';

let clientPromise: Promise<MongoClient> | null = null;
let hasLoggedSuccessfulConnection = false;
let connectionAttempts = 0;
const MAX_CONNECTION_ATTEMPTS = 3;

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

  if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
    throw new Error(`MongoDB connection failed after ${MAX_CONNECTION_ATTEMPTS} attempts. Giving up.`);
  }

  if (!clientPromise) {
    connectionAttempts++;
    console.log(`🔄 Attempting MongoDB connection (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS})...`);
    
    const client = new MongoClient(config.mongoUri);

    clientPromise = client
      .connect()
      .then(connectedClient => {
        console.log('✅ MongoDB connected successfully');
        connectionAttempts = 0; // Reset on success
        return connectedClient;
      })
      .catch(error => {
        clientPromise = null;
        console.error(`❌ MongoDB connection failed (attempt ${connectionAttempts}/${MAX_CONNECTION_ATTEMPTS}):`, error.message);
        
        if (connectionAttempts >= MAX_CONNECTION_ATTEMPTS) {
          console.error('🚫 MongoDB connection permanently failed. Bot will continue without database logging.');
        }
        
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
    console.log('ℹ️  MongoDB not configured - skipping database connection');
    return false;
  }

  try {
    const client = await getMongoClient();

    if (!hasLoggedSuccessfulConnection) {
      console.log(`✅ Connected to MongoDB: ${client.db().databaseName}`);
      hasLoggedSuccessfulConnection = true;
    }

    return client !== undefined;
  } catch (error) {
    console.error('❌ Failed to connect to MongoDB:', error instanceof Error ? error.message : 'Unknown error');
    return false;
  }
}
