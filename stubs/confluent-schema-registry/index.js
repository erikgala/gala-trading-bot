class SchemaRegistry {
  constructor() {}
  async getLatestSchemaId() {
    return 1;
  }
  async getSchema() {
    return { id: 1, schema: '{}' };
  }
  async encode() {
    return Buffer.from([]);
  }
  async decode(buffer) {
    return buffer;
  }
}

module.exports = { SchemaRegistry };
