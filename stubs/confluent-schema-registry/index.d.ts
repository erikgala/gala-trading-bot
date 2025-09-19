export declare class SchemaRegistry {
  constructor(options?: unknown);
  getLatestSchemaId(subject: string): Promise<number>;
  getSchema(id: number): Promise<{ id: number; schema: string }>;
  encode(subject: string, payload: unknown): Promise<Buffer>;
  decode(buffer: Buffer): Promise<unknown>;
}
