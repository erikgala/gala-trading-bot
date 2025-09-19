class PrivateKeySigner {
  constructor(privateKey) {
    this.privateKey = privateKey;
  }
}

class TokenAmount {
  constructor(value = 0) {
    this.value = value;
  }

  toNumber() {
    return Number(this.value) || 0;
  }
}

class GSwap {
  constructor({ signer } = {}) {
    this.signer = signer;
    this.assets = {
      async getUserAssets() {
        return { tokens: [] };
      }
    };
    this.quoting = {
      async quoteExactInput() {
        return {
          outTokenAmount: new TokenAmount(0),
          priceImpact: new TokenAmount(0),
          feeTier: 0
        };
      }
    };
    this.swaps = {
      async swap() {
        return {};
      }
    };
  }
}

function stringifyTokenClassKey({ collection = '', category = '', type = '', additionalKey = '' }) {
  return `${collection}|${category}|${type}|${additionalKey}`;
}

module.exports = {
  GSwap,
  PrivateKeySigner,
  stringifyTokenClassKey
};
