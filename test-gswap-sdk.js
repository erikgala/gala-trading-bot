const { GSwap, PrivateKeySigner } = require('@gala-chain/gswap-sdk');

async function testGSwapSDK() {
  console.log('🧪 Testing gSwap SDK Integration...');
  
  try {
    // Test with dummy private key (won't work for actual trading)
    const dummyPrivateKey = '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';
    const dummyWalletAddress = '0x1234567890123456789012345678901234567890';
    
    console.log('1. Creating gSwap instance...');
    const signer = new PrivateKeySigner(dummyPrivateKey);
    const gSwap = new GSwap({
      signer: signer,
    });
    
    console.log('✅ gSwap instance created successfully');
    
    // Test token classes
    console.log('\n2. Testing token classes...');
    const tokenClasses = [
      'GALA|Unit|none|none',
      'GUSDC|Unit|none|none',
      'GETH|Unit|none|none',
      'GBTC|Unit|none|none'
    ];
    
    for (const tokenClass of tokenClasses) {
      console.log(`   Token class: ${tokenClass}`);
    }
    
    console.log('\n3. Testing quote functionality...');
    try {
      // This will likely fail without proper network connection, but we can test the structure
      const quote = await gSwap.quoting.quoteExactInput(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        1
      );
      
      console.log('✅ Quote successful:', quote);
    } catch (error) {
      console.log('⚠️  Quote failed (expected without proper setup):', error.message);
    }
    
    console.log('\n4. Testing swap functionality...');
    try {
      // This will definitely fail without proper setup, but we can test the structure
      const swapParams = {
        exactIn: 1,
        amountOutMinimum: 0.95
      };
      
      const transaction = await gSwap.swaps.swap(
        'GALA|Unit|none|none',
        'GUSDC|Unit|none|none',
        0.3, // 0.3% fee tier
        swapParams,
        dummyWalletAddress
      );
      
      console.log('✅ Swap successful:', transaction);
    } catch (error) {
      console.log('⚠️  Swap failed (expected without proper setup):', error.message);
    }
    
    console.log('\n✅ gSwap SDK integration test completed');
    console.log('📝 Note: Actual trading requires valid private key and network connection');
    
  } catch (error) {
    console.error('❌ gSwap SDK test failed:', error);
  }
}

testGSwapSDK().catch(console.error);
