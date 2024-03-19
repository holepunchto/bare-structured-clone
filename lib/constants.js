module.exports = {
  VERSION: 0,

  type: {
    UNDEFINED: 0,
    NULL: 1,
    TRUE: 2,
    FALSE: 3,
    NUMBER: 4,
    BIGINT: 5,
    STRING: 6,
    DATE: 7,
    REGEXP: 8,
    URL: 9,
    BUFFER: 10,
    ARRAYBUFFER: 11,
    RESIZABLEARRAYBUFFER: 12,
    SHAREDARRAYBUFFER: 13,
    GROWABLESHAREDARRAYBUFFER: 14,
    TYPEDARRAY: 15,
    DATAVIEW: 16,
    MAP: 17,
    SET: 18,
    ERROR: 19,
    ARRAY: 20,
    OBJECT: 21,
    EXTERNAL: 22,
    REFERENCE: 23,
    TRANSFER: 24,

    typedarray: {
      UINT8ARRAY: 1,
      UINT8CLAMPEDARRAY: 2,
      INT8ARRAY: 3,
      UINT16ARRAY: 4,
      INT16ARRAY: 5,
      UINT32ARRAY: 6,
      INT32ARRAY: 7,
      BIGUINT64ARRAY: 8,
      BIGINT64ARRAY: 9,
      FLOAT32ARRAY: 10,
      FLOAT64ARRAY: 11
    },

    error: {
      EVAL: 1,
      RANGE: 2,
      REFERENCE: 3,
      SYNTAX: 4,
      TYPE: 5
    }
  }
}
