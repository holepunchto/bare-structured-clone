declare global {
  interface SymbolConstructor {
    readonly bare: {
      readonly serialize: unique symbol
      readonly deserialize: unique symbol

      readonly detach: unique symbol
      readonly attach: unique symbol
    }
  }
}

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

declare function structuredClone<T extends unknown>(
  value: T,
  opts?: { transfer: T[]; interfaces: unknown }
): T

interface SerializedType<T extends undefined | null | true | false> {
  type: T extends undefined
    ? typeof constants.type.UNDEFINED
    : T extends null
      ? typeof constants.type.NULL
      : typeof constants.type.TRUE | typeof constants.type.FALSE
}

interface SerializedValue<T extends number | bigint | string> {
  type: T extends number
    ? typeof constants.type.NUMBER
    : T extends bigint
      ? typeof constants.type.BIGINT
      : typeof constants.type.STRING
  value: T
}

interface SerializedDate {
  type: typeof constants.type.DATE
  id: number
  value: number
}

interface SerializedRegExp {
  type: typeof constants.type.REGEXP
  id: number
  source: string
  flags: string
}

interface SerializedError {
  type: typeof constants.type.ERROR
  id: number
  name: number
  message: string
  stack: { type: number; value: string }
  cause?: { type: number; value: unknown }
  errors?: SerializedError[]
}

interface SerializedArrayBuffer {
  type: typeof constants.type.ARRAYBUFFER
  id: number
  owned: boolean
  data: ArrayBuffer
  maxByteLength?: number
}

interface SerializedSharedArrayBuffer {
  type: typeof constants.type.SHAREDARRAYBUFFER
  id: number
  backingStore: ArrayBuffer
  maxByteLength?: number
}

interface SerializedTypedArray {
  type: typeof constants.type.TYPEDARRAY
  id: number
  view: number
  buffer: SerializedArrayBuffer
  byteOffset: number
  byteLength: number
  length: number
}

interface SerializedArray<T extends unknown> {
  type: typeof constants.type.ARRAY
  id: number
  length: number
  properties: { key: string; value: T }[]
}

interface SerializedObject<T extends unknown> {
  type: typeof constants.type.OBJECT
  id: number
  properties: { key: string | number | symbol; value: Serialized<T> }[]
}

interface SerializedReference {
  type: typeof constants.type.REFERENCE
  id: number
}

interface SerializedMap<K extends unknown, V extends unknown> {
  type: typeof constants.type.MAP
  id: number
  data: { key: Serialized<K>; value: Serialized<V> }[]
}

interface SerializedSet<T extends unknown> {
  type: typeof constants.type.SET
  id: number
  data: Serialized<T>[]
}

interface SerializedURL {
  type: typeof constants.type.URL
  id: number
  href: string
}

interface SerializedTransferable<K extends unknown> {
  type: typeof constants.type.TRANSFERABLE
  id: number
  interface: number
  value: Serialized<K>
}

type Unwrap<T> = T extends (infer V)[] ? V : never
type UnwrapMapKeys<M> = M extends Map<infer K, any> ? K : never
type UnwrapMapValues<M> = M extends Map<any, infer V> ? V : never
type UnwrapSet<S> = S extends Set<infer V> ? V : never
type UnwrapObject<O> = O extends { [key: string | number | symbol]: infer V }
  ? V
  : never

type Serialized<T extends unknown> = T extends undefined | null | boolean
  ? SerializedType<T>
  : T extends number | bigint | string
    ? SerializedValue<T>
    : T extends Date
      ? SerializedDate
      : T extends RegExp
        ? SerializedRegExp
        : T extends URL
          ? SerializedURL
          : T extends Error
            ? SerializedError
            : T extends ArrayBufferView
              ? SerializedTypedArray
              : T extends SharedArrayBuffer
                ? SerializedSharedArrayBuffer
                : T extends ArrayBuffer
                  ? SerializedArrayBuffer
                  : T extends Array<unknown>
                    ? SerializedArray<Unwrap<T>>
                    : T extends Map<unknown, unknown>
                      ? SerializedMap<UnwrapMapKeys<T>, UnwrapMapValues<T>>
                      : T extends { [key: string | number | symbol]: unknown }
                        ? SerializedObject<UnwrapObject<T>>
                        : T extends Set<unknown>
                          ? SerializedSet<UnwrapSet<T>>
                          : T extends Transferable
                            ? SerializedTransferable<unknown>
                            : void

type SerializedWithTransfer<T extends unknown, V extends unknown> = {
  type: typeof constants.type.TRANSFER
  transfers: V extends Transferable
    ? Serialized<Transferable>[]
    : Serialized<ArrayBuffer>[]
  value: T extends Array<unknown>
    ? SerializedArray<SerializedReference>
    : T extends Record<'string | number | symbol', unknown>
      ? SerializedObject<SerializedReference>
      : SerializedReference
}

declare function serialize<T extends unknown>(
  value: T,
  forStorage?: boolean,
  interfaces?: unknown
): Serialized<T>

declare function serializeWithTransfer<T extends unknown, V extends unknown>(
  value: T,
  transferList: V[],
  interfaces?: unknown
): SerializedWithTransfer<T, V>

type Deserialized<S extends unknown> =
  S extends SerializedType<infer T>
    ? T
    : S extends SerializedValue<infer V>
      ? V
      : S extends SerializedDate
        ? Date
        : S extends SerializedRegExp
          ? RegExp
          : S extends SerializedURL
            ? URL
            : S extends SerializedError
              ? Error
              : S extends SerializedTypedArray
                ? ArrayBufferLike
                : S extends SerializedSharedArrayBuffer
                  ? SharedArrayBuffer
                  : S extends SerializedArrayBuffer
                    ? ArrayBuffer
                    : S extends SerializedArray<infer I>
                      ? I[]
                      : S extends SerializedMap<infer K, infer V>
                        ? Map<K, V>
                        : S extends SerializedObject<infer V>
                          ? { [key: string | number | symbol]: V }
                          : S extends SerializedSet<infer I>
                            ? Set<I>
                            : S extends SerializedTransferable<infer T>
                              ? T
                              : unknown

declare function deserialize<T extends unknown>(
  serialized: T,
  interfaces?: unknown,
  references?: unknown
): Deserialized<T>

declare function deserializeWithTransfer<T extends unknown>(
  serialized: T,
  interfaces?: unknown
): Deserialized<T>

declare interface Transferable {
  readonly detached: boolean
  [Symbol.bare.detach](): void
}

declare class Transferable {
  static [Symbol.bare.attach](forStorage?: boolean): void
}

declare interface Serializable {
  [Symbol.bare.serialize](): void
}

declare class Serializable {
  static [Symbol.bare.deserialize](serialized?: unknown): void
}

declare class DataCloneError extends Error {
  static INVALID_VERSION(msg: string): DataCloneError
  static UNSERIALIZABLE_TYPE(msg: string): DataCloneError
  static UNTRANSFERABLE_TYPE(msg: string): DataCloneError
  static ALREADY_TRANSFERRED(msg: string): DataCloneError
  static INVALID_REFERENCE(msg: string): DataCloneError
  static INVALID_INTERFACE(msg: string): DataCloneError
}

declare namespace structuredClone {
  export {
    serialize,
    serializeWithTransfer,
    deserialize,
    deserializeWithTransfer,
    constants,
    DataCloneError as errors,
    Serializable,
    Transferable
  }
}

export = structuredClone
