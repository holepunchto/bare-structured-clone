module.exports = class DataCloneError extends Error {
  constructor (msg, code, fn = DataCloneError) {
    super(`${code}: ${msg}`)
    this.code = code

    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, fn)
    }
  }

  get name () {
    return 'DataCloneError'
  }

  static INVALID_VERSION (msg) {
    return new DataCloneError(msg, 'INVALID_VERSION', DataCloneError.INVALID_VERSION)
  }

  static UNSUPPORTED_TYPE (msg) {
    return new DataCloneError(msg, 'UNSUPPORTED_TYPE', DataCloneError.UNSUPPORTED_TYPE)
  }

  static INVALID_REFERENCE (msg) {
    return new DataCloneError(msg, 'INVALID_REFERENCE', DataCloneError.INVALID_REFERENCE)
  }
}
