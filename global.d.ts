import { StructuredCloneOptions, SerializableValue, TransferableValue } from '.'

declare global {
  function structuredClone<T extends SerializableValue | TransferableValue>(
    value: T,
    opts?: StructuredCloneOptions
  ): T
}
