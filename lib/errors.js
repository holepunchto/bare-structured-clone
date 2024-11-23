module.exports = class DataCloneError extends Error {
  constructor(msg, code, fn = DataCloneError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name() {
    return 'DataCloneError'
  }

  static INVALID_VERSION(msg) {
    return new DataCloneError(
      msg,
      'INVALID_VERSION',
      DataCloneError.INVALID_VERSION
    )
  }

  static UNSERIALIZABLE_TYPE(msg) {
    return new DataCloneError(
      msg,
      'UNSERIALIZABLE_TYPE',
      DataCloneError.UNSERIALIZABLE_TYPE
    )
  }

  static UNTRANSFERABLE_TYPE(msg) {
    return new DataCloneError(
      msg,
      'UNTRANSFERABLE_TYPE',
      DataCloneError.UNTRANSFERABLE_TYPE
    )
  }

  static ALREADY_TRANSFERRED(msg) {
    return new DataCloneError(
      msg,
      'ALREADY_TRANSFERRED',
      DataCloneError.ALREADY_TRANSFERRED
    )
  }

  static INVALID_REFERENCE(msg) {
    return new DataCloneError(
      msg,
      'INVALID_REFERENCE',
      DataCloneError.INVALID_REFERENCE
    )
  }

  static INVALID_INTERFACE(msg) {
    return new DataCloneError(
      msg,
      'INVALID_INTERFACE',
      DataCloneError.INVALID_INTERFACE
    )
  }
}
