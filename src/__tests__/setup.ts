// Test setup file
import { config } from '../config';

// Mock console methods to reduce noise during tests
const originalConsole = { ...console };

beforeAll(() => {
  // Suppress console output during tests unless explicitly needed
  console.log = jest.fn();
  console.warn = jest.fn();
  console.error = jest.fn();
});

afterAll(() => {
  // Restore console methods
  Object.assign(console, originalConsole);
});

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.MOCK_MODE = 'true';
process.env.MOCK_RUN_NAME = 'test_run';
process.env.MOCK_WALLET_BALANCES = '{"GALA|Unit|none|none": 10000, "GUSDC|Unit|none|none": 5000}';
