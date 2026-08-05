import { StructuredCloneOptions, SerializableValue, TransferableValue } from '.'

declare global {
  /**
   * Clone `value` by serializing and then deserializing it. `opts` may include a `transfer` list and an `interfaces` list.
   * @param value - The value to clone.
   * @param opts - Options carrying the optional `transfer` and `interfaces` lists.
   * @returns A deep copy of `value`, with any transferred objects detached from the original.
   * @throws {UNSERIALIZABLE_TYPE} `value`, or a value it references, is of a type that cannot be serialized (for example a function, a symbol, or a detached `ArrayBuffer`).
   * @throws {UNTRANSFERABLE_TYPE} a value in the `transfer` list cannot be transferred.
   * @throws {ALREADY_TRANSFERRED} a value in the `transfer` list has already been transferred.
   * @throws {INVALID_INTERFACE} a serializable or transferable value has an interface that is not present in the `interfaces` list.
   */
  function structuredClone<T extends SerializableValue | TransferableValue>(
    value: T,
    opts?: StructuredCloneOptions
  ): T
}
