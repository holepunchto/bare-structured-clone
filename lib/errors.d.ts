declare class DataCloneError extends Error {
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `INVALID_VERSION`.
   */
  static INVALID_VERSION(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `UNSERIALIZABLE_TYPE`.
   */
  static UNSERIALIZABLE_TYPE(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `UNTRANSFERABLE_TYPE`.
   */
  static UNTRANSFERABLE_TYPE(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `ALREADY_TRANSFERRED`.
   */
  static ALREADY_TRANSFERRED(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `INVALID_REFERENCE`.
   */
  static INVALID_REFERENCE(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `INVALID_INTERFACE`.
   */
  static INVALID_INTERFACE(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `INVALID_PROPERTY_KEY`.
   */
  static INVALID_PROPERTY_KEY(msg: string): DataCloneError
  /**
   * @param msg - The error message.
   * @returns A new `DataCloneError` with code `INVALID_ARRAY_LAYOUT`.
   */
  static INVALID_ARRAY_LAYOUT(msg: string): DataCloneError
  static INVALID_TYPE(msg: string): DataCloneError
  static INVALID_VIEW(msg: string): DataCloneError
}

export = DataCloneError
