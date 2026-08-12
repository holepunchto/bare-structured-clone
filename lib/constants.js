module.exports = {
  VERSION: 1,

  type: {
    // Primitive types
    UNDEFINED: 0,
    NULL: 1,
    TRUE: 2,
    FALSE: 3,
    NUMBER: 4,
    INTEGER: 5,

    BIGINT: 6,
    STRING: 7,

    // Builtin objects
    DATE: 8,
    REGEXP: 9,
    ERROR: 10,

    // Builtin binary data objects
    ARRAYBUFFER: 11,
    RESIZABLEARRAYBUFFER: 12,
    SHAREDARRAYBUFFER: 13,
    GROWABLESHAREDARRAYBUFFER: 14,
    TYPEDARRAY: 15,
    DATAVIEW: 16,

    // Builtin composite objects
    MAP: 17,
    SET: 18,
    ARRAY: 19,
    OBJECT: 20,

    // Object references
    REFERENCE: 21,

    // Object transfers
    TRANSFER: 22,

    // Platform objects
    URL: 23,
    BUFFER: 24,
    EXTERNAL: 25,
    SERIALIZABLE: 26,
    TRANSFERABLE: 27,

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
      FLOAT16ARRAY: 12,
      FLOAT32ARRAY: 10,
      FLOAT64ARRAY: 11
    },

    error: {
      AGGREGATE: 1,
      EVAL: 2,
      RANGE: 3,
      REFERENCE: 4,
      SYNTAX: 5,
      TYPE: 6,
      URI: 7
    },

    // Property key kinds
    key: {
      INDEX: 1,
      NAME: 2,
      NAME_REFERENCE: 3
    },

    // Array layouts
    array: {
      DENSE: 1,
      SPARSE: 2
    }
  }
}
