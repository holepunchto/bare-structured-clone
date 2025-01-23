declare class DataCloneError extends Error {
  static INVALID_VERSION(msg: string): DataCloneError
  static UNSERIALIZABLE_TYPE(msg: string): DataCloneError
  static UNTRANSFERABLE_TYPE(msg: string): DataCloneError
  static ALREADY_TRANSFERRED(msg: string): DataCloneError
  static INVALID_REFERENCE(msg: string): DataCloneError
  static INVALID_INTERFACE(msg: string): DataCloneError
}

export = DataCloneError
