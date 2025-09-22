export const parsedBlockSchema = {
  type: 'record',
  name: 'ParsedBlockPayload',
  namespace: 'games.gala.avro.chain.schema',
  fields: [
    {
      name: 'blockNumber',
      type: 'string',
    },
    {
      name: 'channelName',
      type: 'string',
    },
    {
      name: 'createdAt',
      type: 'string',
    },
    {
      name: 'isConfigurationBlock',
      type: 'boolean',
    },
    {
      name: 'header',
      type: {
        fields: [
          {
            name: 'number',
            type: 'string',
          },
          {
            name: 'previous_hash',
            type: 'string',
          },
          {
            name: 'data_hash',
            type: 'string',
          },
        ],
        name: 'headerRecord',
        type: 'record',
      },
    },
    {
      name: 'transactions',
      type: {
        default: [],
        items: {
          fields: [
            {
              name: 'id',
              type: 'string',
            },
            {
              name: 'creator',
              type: {
                fields: [
                  {
                    name: 'mspId',
                    type: 'string',
                  },
                  {
                    name: 'name',
                    type: 'string',
                  },
                ],
                name: 'creatorRecord',
                type: 'record',
              },
            },
            {
              name: 'type',
              type: 'string',
            },
            {
              name: 'validationCode',
              type: {
                fields: [
                  {
                    name: 'transactionId',
                    type: 'string',
                  },
                  {
                    name: 'validationCode',
                    type: 'int',
                  },
                  {
                    name: 'validationEnum',
                    type: 'string',
                  },
                ],
                name: 'validationCodeRecord',
                type: 'record',
              },
            },
            {
              name: 'actions',
              type: {
                default: [],
                items: {
                  fields: [
                    {
                      name: 'chaincodeResponse',
                      type: {
                        fields: [
                          {
                            name: 'status',
                            type: 'int',
                          },
                          {
                            name: 'message',
                            type: 'string',
                          },
                          {
                            name: 'payload',
                            type: 'string',
                          },
                        ],
                        name: 'chaincodeResponseRecord',
                        type: 'record',
                      },
                    },
                    {
                      name: 'reads',
                      type: {
                        default: [],
                        items: {
                          fields: [
                            {
                              name: 'key',
                              type: 'string',
                            },
                          ],
                          name: 'readRecordType',
                          type: 'record',
                        },
                        type: 'array',
                      },
                    },
                    {
                      name: 'writes',
                      type: {
                        default: [],
                        items: {
                          fields: [
                            {
                              name: 'key',
                              type: 'string',
                            },
                            {
                              name: 'isDelete',
                              type: 'boolean',
                            },
                            {
                              name: 'value',
                              type: 'string',
                            },
                          ],
                          name: 'writeRecordType',
                          type: 'record',
                        },
                        type: 'array',
                      },
                    },
                    {
                      name: 'endorserMsps',
                      type: {
                        default: [],
                        items: 'string',
                        type: 'array',
                      },
                    },
                    {
                      name: 'args',
                      type: {
                        default: [],
                        items: 'string',
                        type: 'array',
                      },
                    },
                    {
                      name: 'chaincode',
                      type: {
                        fields: [
                          {
                            name: 'name',
                            type: 'string',
                          },
                          {
                            name: 'version',
                            type: 'string',
                          },
                        ],
                        name: 'chaincodeRecord',
                        type: 'record',
                      },
                    },
                  ],
                  name: 'transactionActionRecord',
                  type: 'record',
                },
                type: 'array',
              },
            },
          ],
          name: 'transactionRecord',
          type: 'record',
        },
        type: 'array',
      },
    },
    {
      name: 'configtxs',
      type: {
        default: [],
        items: {
          fields: [
            {
              name: 'sequence',
              type: 'string',
            },
            {
              name: 'type',
              type: 'string',
            },
            {
              name: 'channelGroup',
              type: {
                fields: [
                  {
                    name: 'version',
                    type: 'int',
                  },
                  {
                    name: 'groups',
                    type: 'string',
                  },
                  {
                    name: 'values',
                    type: 'string',
                  },
                  {
                    name: 'policies',
                    type: 'string',
                  },
                ],
                name: 'channelGroupRecord',
                type: 'record',
              },
            },
            {
              name: 'lastUpdatePayload',
              type: {
                fields: [
                  {
                    name: 'channelHeader',
                    type: {
                      fields: [
                        {
                          name: 'type',
                          type: 'int',
                        },
                        {
                          name: 'version',
                          type: 'int',
                        },
                        {
                          name: 'timestamp',
                          type: 'string',
                        },
                        {
                          name: 'channelId',
                          type: 'string',
                        },
                        {
                          name: 'txId',
                          type: 'string',
                        },
                        {
                          name: 'epoch',
                          type: 'string',
                        },
                      ],
                      name: 'channelHeaderRecord',
                      type: 'record',
                    },
                  },
                  {
                    name: 'creatorMspid',
                    type: 'string',
                  },
                ],
                name: 'lastUpdatePayloadRecord',
                type: 'record',
              },
            },
          ],
          name: 'configtxRecord',
          type: 'record',
        },
        type: 'array',
      },
    },
  ],
};
