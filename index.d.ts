import Buffer from 'bare-buffer'
import URL from 'bare-url'
import constants from './lib/constants'
import DataCloneError from './lib/errors'

declare const symbols: {
  readonly serialize: unique symbol
  readonly deserialize: unique symbol
  readonly detach: unique symbol
  readonly attach: unique symbol
}

interface SerializedUndefined {
  type: typeof constants.type.UNDEFINED
}

interface SerializedNull {
  type: typeof constants.type.NULL
}

interface SerializedTrue {
  type: typeof constants.type.TRUE
}

interface SerializedFalse {
  type: typeof constants.type.FALSE
}

interface SerializedNumber {
  type: typeof constants.type.NUMBER
  value: number
}

interface SerializedBigInt {
  type: typeof constants.type.BIGINT
  value: bigint
}

interface SerializedString {
  type: typeof constants.type.STRING
  value: string
}

interface SerializedExternal {
  type: typeof constants.type.EXTERNAL
  value: ArrayBuffer
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
  stack: SerializedValue
  cause?: SerializedValue
  errors?: SerializedValue[]
}

interface SerializedArrayBuffer {
  type: typeof constants.type.ARRAYBUFFER
  id: number
  owned: boolean
  data: ArrayBuffer
}

interface SerializedResizableArrayBuffer {
  type: typeof constants.type.RESIZABLEARRAYBUFFER
  id: number
  owned: boolean
  data: ArrayBuffer
  maxByteLength: number
}

interface SerializedSharedArrayBuffer {
  type: typeof constants.type.SHAREDARRAYBUFFER
  id: number
  backingStore: ArrayBuffer
}

interface SerializedGrowableSharedArrayBuffer {
  type: typeof constants.type.GROWABLESHAREDARRAYBUFFER
  id: number
  backingStore: ArrayBuffer
  maxByteLength: number
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

interface SerializedDataView {
  type: typeof constants.type.DATAVIEW
  id: number
  buffer: SerializedArrayBuffer
  byteOffset: number
  byteLength: number
}

interface SerializedMap {
  type: typeof constants.type.MAP
  id: number
  data: { key: SerializedValue; value: SerializedValue }[]
}

interface SerializedSet {
  type: typeof constants.type.SET
  id: number
  data: SerializedValue[]
}

interface SerializedArray {
  type: typeof constants.type.ARRAY
  id: number
  length: number
  properties: { key: string; value: SerializedValue }[]
}

interface SerializedObject {
  type: typeof constants.type.OBJECT
  id: number
  properties: { key: string; value: SerializedValue }[]
}

interface SerializedReference {
  type: typeof constants.type.REFERENCE
  id: number
}

interface SerializedURL {
  type: typeof constants.type.URL
  id: number
  href: string
}

interface SerializedBuffer {
  type: typeof constants.type.BUFFER
  id: number
  buffer: SerializedArrayBuffer
  byteOffset: number
  byteLength: number
}

interface SerializedSerializable {
  type: typeof constants.type.SERIALIZABLE
  id: number
  interface: number
  value: SerializedValue
}

interface SerializedArrayBufferTransfer {
  type: typeof constants.type.ARRAYBUFFER
  id: number
  backingStore: ArrayBuffer
}

interface SerializedResizableArrayBufferTransfer {
  type: typeof constants.type.RESIZABLEARRAYBUFFER
  id: number
  backingStore: ArrayBuffer
  maxByteLength: number
}

interface SerializedTransferableTransfer {
  type: typeof constants.type.TRANSFERABLE
  id: number
  interface: number
  value: SerializedValue
}

interface SerializedTransfer {
  type: typeof constants.type.TRANSFER
  transfers: (
    | SerializedArrayBufferTransfer
    | SerializedResizableArrayBufferTransfer
    | SerializedTransferableTransfer
  )[]
  value: SerializedValue
}

type SerializedValue =
  | SerializedUndefined
  | SerializedNull
  | SerializedTrue
  | SerializedFalse
  | SerializedNumber
  | SerializedBigInt
  | SerializedString
  | SerializedExternal
  | SerializedDate
  | SerializedRegExp
  | SerializedError
  | SerializedArrayBuffer
  | SerializedResizableArrayBuffer
  | SerializedSharedArrayBuffer
  | SerializedGrowableSharedArrayBuffer
  | SerializedTypedArray
  | SerializedDataView
  | SerializedMap
  | SerializedSet
  | SerializedArray
  | SerializedObject
  | SerializedReference
  | SerializedURL
  | SerializedBuffer
  | SerializedSerializable

interface Serializable<T = unknown> {
  [symbols.serialize](): T
}

declare class Serializable {}

interface SerializableConstructor<T = unknown> {
  new (...args: any[]): Serializable<T>

  [symbols.deserialize](serialized: T): Serializable<T>
}

type SerializableValue =
  | undefined
  | null
  | boolean
  | number
  | bigint
  | string
  | Date
  | RegExp
  | Error
  | ArrayBuffer
  | SharedArrayBuffer
  | Uint8Array
  | Uint8ClampedArray
  | Int8Array
  | Uint16Array
  | Int16Array
  | Uint32Array
  | Int32Array
  | BigUint64Array
  | BigInt64Array
  | Float32Array
  | Float64Array
  | DataView
  | Map<SerializableValue, SerializableValue>
  | Set<SerializableValue>
  | SerializableValue[]
  | { [key: string | number]: SerializableValue }
  | URL
  | Buffer
  | Serializable

interface Transferable<T = unknown> {
  readonly detached: boolean
  [symbols.detach](): T
}

declare class Transferable {}

interface TransferableConstructor<T = unknown> {
  new (...args: any[]): Transferable<T>

  [symbols.attach](serialized: T): Transferable<T>
}

type TransferableValue = ArrayBuffer | Transferable

interface StructuredCloneOptions {
  transfer: TransferableValue[]
  interfaces: (SerializableConstructor | TransferableConstructor)[]
}

declare function structuredClone<
  T extends SerializableValue | TransferableValue
>(value: T, opts?: StructuredCloneOptions): T

declare namespace structuredClone {
  export function serialize(
    value: SerializableValue,
    forStorage?: boolean,
    interfaces?: (SerializableConstructor | TransferableConstructor)[]
  ): SerializedValue

  export function serializeWithTransfer(
    value: SerializableValue | TransferableValue,
    transferList?: TransferableValue[],
    interfaces?: (SerializableConstructor | TransferableConstructor)[]
  ): SerializedTransfer

  export function deserialize<T extends SerializableValue>(
    serialized: SerializedValue,
    interfaces?: (SerializableConstructor | TransferableConstructor)[]
  ): T

  export function deserializeWithTransfer<
    T extends SerializableValue | TransferableValue
  >(
    serialized: SerializedTransfer,
    interfaces?: (SerializableConstructor | TransferableConstructor)[]
  ): T

  export {
    type StructuredCloneOptions,
    constants,
    symbols,
    type DataCloneError,
    DataCloneError as errors,
    Serializable,
    type SerializableValue,
    type SerializableConstructor,
    Transferable,
    type TransferableValue,
    type TransferableConstructor
  }
}

export = structuredClone
