# Real-Time Streaming Module

This module provides real-time block data consumption via Kafka for ultra-fast arbitrage detection.

## Overview

The streaming module consists of three main components:

1. **KafkaBlockConsumer** - Consumes block data from Kafka topics
2. **RealTimeEventProcessor** - Processes events for arbitrage opportunities
3. **Type Definitions** - Placeholder schemas for block data structures

## Architecture

```
Kafka Topics → KafkaBlockConsumer → RealTimeEventProcessor → Arbitrage Detection → Trade Execution
```

## Usage

### Basic Setup

```typescript
import { KafkaBlockConsumer, RealTimeEventProcessor, createKafkaConfig } from './streaming';

// Create configuration
const kafkaConfig = createKafkaConfig();

// Create event processor
const eventProcessor = new RealTimeEventProcessor(api, detector, executor);

// Create and start consumer
const consumer = new KafkaBlockConsumer(kafkaConfig, eventProcessor);
await consumer.start();
```

### Environment Configuration

Add these variables to your `.env` file:

```bash
# Kafka Configuration
KAFKA_BROKERS=localhost:9092
KAFKA_CLIENT_ID=gala-trading-bot
KAFKA_GROUP_ID=gala-trading-group
KAFKA_BLOCKS_TOPIC=blocks
KAFKA_SWAPS_TOPIC=swaps
KAFKA_SSL=false
KAFKA_USERNAME=
KAFKA_PASSWORD=
KAFKA_SASL_MECHANISM=plain
```

### Running the Streaming Bot

```bash
# Start the streaming bot
npm run streaming

# Development mode with auto-reload
npm run dev:streaming
```

## Data Structures (Placeholder)

The current type definitions are placeholders that will be updated once we receive the actual block data schema:

### BlockData
```typescript
interface BlockData {
  blockNumber: number;
  blockHash: string;
  timestamp: number;
  transactions: TransactionData[];
  // Additional fields will be added based on real data
}
```

### SwapEvent
```typescript
interface SwapEvent {
  blockNumber: number;
  transactionHash: string;
  timestamp: number;
  dex: string;
  tokenIn: string;
  tokenOut: string;
  amountIn: string;
  amountOut: string;
  priceImpact: number;
  fee: string;
  user: string;
  // Additional fields will be added based on real data
}
```

## Features

### Real-Time Processing
- **Sub-second detection**: Process events as soon as they're mined
- **Event deduplication**: Avoid processing the same event twice
- **Error handling**: Graceful error recovery and logging

### Arbitrage Detection
- **Cross-DEX opportunities**: Detect price differences between exchanges
- **MEV detection**: Identify front-running and sandwich attacks
- **Liquidity analysis**: React to large trades that create imbalances

### Monitoring
- **Processing statistics**: Track blocks and swaps processed
- **Performance metrics**: Monitor processing speed and errors
- **Trading statistics**: Track opportunities found and trades executed

## Next Steps

1. **Schema Update**: Replace placeholder types with real block data structure
2. **Arbitrage Logic**: Implement sophisticated real-time arbitrage detection
3. **Performance Optimization**: Optimize for high-frequency processing
4. **Cross-DEX Integration**: Add support for multiple DEXs
5. **MEV Detection**: Implement advanced MEV opportunity detection

## Benefits Over Polling

| Polling Bot | Streaming Bot |
|-------------|---------------|
| 5-second delays | Sub-second detection |
| Quote-based | Actual trade data |
| Limited pairs | All DEX activity |
| Reactive | Proactive |
| High latency | Ultra-low latency |

## Error Handling

The module includes comprehensive error handling:
- **Connection failures**: Automatic reconnection to Kafka
- **Message parsing**: Graceful handling of malformed messages
- **Processing errors**: Continue processing even if individual events fail
- **Resource cleanup**: Proper cleanup on shutdown

## Performance Considerations

- **High throughput**: Designed to handle thousands of events per second
- **Low latency**: Optimized for sub-100ms processing times
- **Memory management**: Efficient handling of large block data
- **Scalability**: Can be scaled horizontally across multiple instances
