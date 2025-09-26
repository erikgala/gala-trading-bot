describe('validateConfig', () => {
  const originalEnv = process.env;

  const withIsolatedConfig = (assertion: (mod: typeof import('../index')) => void): void => {
    jest.isolateModules(() => {
      jest.doMock('dotenv', () => ({ config: jest.fn() }));
      const mod = require('../index') as typeof import('../index');
      assertion(mod);
    });
  };

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv } as NodeJS.ProcessEnv;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('throws when MongoDB environment variables are missing', () => {
    process.env.PRIVATE_KEY = 'test-private-key';
    process.env.WALLET_ADDRESS = 'test-wallet-address';
    process.env.MONGO_DB_NAME = 'gala';
    process.env.BOT_MODE = 'polling';
    delete process.env.MONGO_URI;

    withIsolatedConfig(({ validateConfig }) => {
      expect(() => validateConfig()).toThrow(/MONGO_URI/);
    });
  });

  it('throws when Kafka environment variables are missing in streaming mode', () => {
    process.env.PRIVATE_KEY = 'test-private-key';
    process.env.WALLET_ADDRESS = 'test-wallet-address';
    process.env.MONGO_DB_NAME = 'gala';
    process.env.MONGO_URI = 'mongodb://localhost:27017/gala';
    process.env.BOT_MODE = 'streaming';
    process.env.KAFKA_API_KEY = 'kafka-key';
    process.env.KAFKA_API_SECRET = 'kafka-secret';
    process.env.KAFKA_TOPIC = 'kafka-topic';
    delete process.env.KAFKA_API_URL;

    withIsolatedConfig(({ validateConfig }) => {
      expect(() => validateConfig()).toThrow(/KAFKA_API_URL/);
    });
  });

  it('does not throw when all required variables are set for polling mode', () => {
    process.env.PRIVATE_KEY = 'test-private-key';
    process.env.WALLET_ADDRESS = 'test-wallet-address';
    process.env.MONGO_DB_NAME = 'gala';
    process.env.MONGO_URI = 'mongodb://localhost:27017/gala';
    process.env.BOT_MODE = 'polling';

    withIsolatedConfig(({ validateConfig }) => {
      expect(() => validateConfig()).not.toThrow();
    });
  });
});
