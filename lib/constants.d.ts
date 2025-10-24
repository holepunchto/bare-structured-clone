declare const constants: {
  VERSION: number

  type: {
    // Primitive types
    UNDEFINED: 0
    NULL: 1
    TRUE: 2
    FALSE: 3
    NUMBER: 4
    BIGINT: 5
    STRING: 6

    // Builtin objects
    DATE: 7
    REGEXP: 8
    ERROR: 9

    // Builtin binary data objects
    ARRAYBUFFER: 10
    RESIZABLEARRAYBUFFER: 11
    SHAREDARRAYBUFFER: 12
    GROWABLESHAREDARRAYBUFFER: 13
    TYPEDARRAY: 14
    DATAVIEW: 15

    // Builtin composite objects
    MAP: 16
    SET: 17
    ARRAY: 18
    OBJECT: 19

    // Object references
    REFERENCE: 20

    // Object transfers
    TRANSFER: 21

    // Platform objects
    URL: 22
    BUFFER: 23
    EXTERNAL: 24
    SERIALIZABLE: 25
    TRANSFERABLE: 26

    typedarray: {
      UINT8ARRAY: 1
      UINT8CLAMPEDARRAY: 2
      INT8ARRAY: 3
      UINT16ARRAY: 4
      INT16ARRAY: 5
      UINT32ARRAY: 6
      INT32ARRAY: 7
      BIGUINT64ARRAY: 8
      BIGINT64ARRAY: 9
      FLOAT16ARRAY: 12
      FLOAT32ARRAY: 10
      FLOAT64ARRAY: 11
    }

    error: {
      AGGREGATE: 1
      EVAL: 2
      RANGE: 3
      REFERENCE: 4
      SYNTAX: 5
      TYPE: 6
      URI: 7
    }
  }
}

export = constants
