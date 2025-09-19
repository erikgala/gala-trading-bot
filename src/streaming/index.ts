/**
 * Real-time streaming module for Kafka block data consumption
 * 
 * This module provides:
 * - Kafka consumer for block data
 * - Event processor for real-time arbitrage detection
 * - Type definitions for block data structures
 */

export { KafkaBlockConsumer } from './kafkaConsumer';
export { RealTimeEventProcessor } from './eventProcessor';
export * from './types';

// Configuration factory
export function createKafkaConfig(): any {
  return {
    apiUrl: process.env.KAFKA_API_URL || '',
    apiKey: process.env.KAFKA_API_KEY || '',
    apiSecret: process.env.KAFKA_API_SECRET || '',
    schemaHost: process.env.KAFKA_SCHEMA_HOST || '',
    schemaUsername: process.env.KAFKA_SCHEMA_USERNAME || '',
    schemaPassword: process.env.KAFKA_SCHEMA_PASSWORD || '',
    topic: process.env.KAFKA_TOPIC || '',
    clientId: 'gala-trading-bot',
    groupId: 'gala-trading-group',
  };
}
