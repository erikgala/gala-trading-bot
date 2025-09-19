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
    brokers: process.env.KAFKA_BROKERS?.split(',') || ['localhost:9092'],
    clientId: process.env.KAFKA_CLIENT_ID || 'gala-trading-bot',
    groupId: process.env.KAFKA_GROUP_ID || 'gala-trading-group',
    topics: {
      blocks: process.env.KAFKA_BLOCKS_TOPIC || 'blocks',
      swaps: process.env.KAFKA_SWAPS_TOPIC || 'swaps',
    },
    ssl: process.env.KAFKA_SSL === 'true',
    sasl: process.env.KAFKA_USERNAME ? {
      mechanism: process.env.KAFKA_SASL_MECHANISM || 'plain',
      username: process.env.KAFKA_USERNAME,
      password: process.env.KAFKA_PASSWORD || '',
    } : undefined,
  };
}
