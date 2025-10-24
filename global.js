const { serializeWithTransfer, deserializeWithTransfer } = require('.')

global.structuredClone = function structuredClone(value, opts = {}) {
  return deserializeWithTransfer(
    serializeWithTransfer(value, opts.transfer, opts.interfaces),
    opts.interfaces
  )
}
