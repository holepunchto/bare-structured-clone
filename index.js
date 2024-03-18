const c = require('compact-encoding')
const bitfield = require('compact-encoding-bitfield')
const constants = require('./lib/constants')
const errors = require('./lib/errors')
const binding = require('./binding')

const t = constants.type

module.exports = exports = function structuredClone (value, opts = {}) {
  return exports.deserializeWithTransfer(exports.serializeWithTransfer(value, opts.transfer))
}

exports.constants = constants

class SerializeRefMap {
  constructor () {
    this.refs = new WeakMap()
    this.ids = new WeakMap()
    this.nextId = 1
  }

  has (object) {
    return this.refs.has(object)
  }

  get (object) {
    return this.refs.get(object) || null
  }

  set (object, ref) {
    this.refs.set(object, ref)
  }

  id (object) {
    let id = this.ids.get(object)
    if (id) return id

    id = this.nextId++
    this.ids.set(object, id)

    return id
  }
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserialize
exports.serialize = function serialize (value, forStorage = false, references = new SerializeRefMap()) {
  if (references.has(value)) return { type: t.REFERENCE, id: references.id(value) }

  if (value === undefined) return { type: t.UNDEFINED }
  if (value === null) return { type: t.NULL }
  if (value === true) return { type: t.TRUE }
  if (value === false) return { type: t.FALSE }

  switch (typeof value) {
    case 'number': return { type: t.NUMBER, value }
    case 'bigint': return { type: t.BIGINT, value }
    case 'string': return { type: t.STRING, value }

    case 'symbol': throw errors.UNSERIALIZABLE_TYPE(`Symbol '${value.description}' cannot be serialized`)

    case 'function': throw errors.UNSERIALIZABLE_TYPE(`Function '${value.name}' cannot be serialized`)
  }

  if (value instanceof Date) {
    return { type: t.DATE, value: value.getTime() }
  }

  if (value instanceof RegExp) {
    return { type: t.REGEXP, source: value.source, flags: value.flags }
  }

  if (value instanceof URL) {
    return { type: t.URL, href: value.href }
  }

  if (value instanceof Buffer) {
    if (value.detached) {
      throw errors.UNSERIALIZABLE_TYPE('Detached Buffer cannot be serialized')
    }

    return { type: t.BUFFER, owned: false, data: value }
  }

  if (value instanceof ArrayBuffer) {
    if (value.detached) {
      throw errors.UNSERIALIZABLE_TYPE('Detached ArrayBuffer cannot be serialized')
    }

    if (value.resizable) {
      return { type: t.RESIZABLEARRAYBUFFER, owned: false, data: value, maxByteLength: value.maxByteLength }
    }

    return { type: t.ARRAYBUFFER, owned: false, data: value }
  }

  if (value instanceof SharedArrayBuffer) {
    if (forStorage) {
      throw errors.UNSERIALIZABLE_TYPE('SharedArrayBuffer cannot be serialized to storage')
    }

    const backingStore = Buffer.from(binding.getSharedArrayBufferBackingStore(value))

    if (value.growable) {
      return { type: t.GROWABLESHAREDARRAYBUFFER, backingStore, maxByteLength: value.maxByteLength }
    }

    return { type: t.SHAREDARRAYBUFFER, backingStore }
  }

  if (ArrayBuffer.isView(value)) {
    const buffer = serialize(value.buffer, forStorage, references)

    let view

    if (value instanceof Uint8Array) {
      view = t.typedarray.UINT8ARRAY
    } else if (value instanceof Uint8ClampedArray) {
      view = t.typedarray.UINT8CLAMPEDARRAY
    } else if (value instanceof Int8Array) {
      view = t.typedarray.INT8ARRAY
    } else if (value instanceof Uint16Array) {
      view = t.typedarray.UINT16ARRAY
    } else if (value instanceof Int16Array) {
      view = t.typedarray.INT16ARRAY
    } else if (value instanceof Uint32Array) {
      view = t.typedarray.UINT32ARRAY
    } else if (value instanceof Int32Array) {
      view = t.typedarray.INT32ARRAY
    } else if (value instanceof BigUint64Array) {
      view = t.typedarray.BIGUINT64ARRAY
    } else if (value instanceof BigInt64Array) {
      view = t.typedarray.BIGINT64ARRAY
    } else if (value instanceof Float32Array) {
      view = t.typedarray.FLOAT32ARRAY
    } else if (value instanceof Float64Array) {
      view = t.typedarray.FLOAT64ARRAY
    } else if (value instanceof DataView) {
      return { type: t.DATAVIEW, buffer, byteOffset: value.byteOffset, byteLength: value.byteLength }
    }

    return { type: t.TYPEDARRAY, view, buffer, byteOffset: value.byteOffset, byteLength: value.byteLength, length: value.length }
  }

  if (value instanceof Error) {
    let name

    switch (value.name) {
      case 'EvalError':
        name = t.error.EVAL
        break
      case 'RangeError':
        name = t.error.RANGE
        break
      case 'ReferenceError':
        name = t.error.REFERENCE
        break
      case 'SyntaxError':
        name = t.error.SYNTAX
        break
      case 'TypeError':
        name = t.error.TYPE
        break
      default:
        name = t.error.NONE
    }

    return {
      type: t.ERROR,
      name,
      message: value.message.toString(),
      stack: value.stack ? serialize(value.stack, forStorage, references) : null
    }
  }

  if (
    value instanceof Promise ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof WeakRef
  ) {
    throw errors.UNSERIALIZABLE_TYPE(`${value.constructor.name} cannot be serialized`)
  }

  let serialized

  if (value instanceof Map) {
    serialized = { type: t.MAP, id: 0, data: [] }
  } else if (value instanceof Set) {
    serialized = { type: t.SET, id: 0, data: [] }
  } else if (Array.isArray(value)) {
    serialized = { type: t.ARRAY, id: 0, length: value.length, properties: [] }
  } else {
    serialized = { type: t.OBJECT, id: 0, properties: [] }
  }

  references.set(value, serialized)

  switch (serialized.type) {
    case t.MAP:
      for (const entry of value) {
        const [key, value] = entry

        serialized.data.push({
          key: serialize(key, forStorage, references),
          value: serialize(value, forStorage, references)
        })
      }
      break

    case t.SET:
      for (const entry of value) {
        serialized.data.push(serialize(entry, forStorage, references))
      }
      break

    default:
      for (const entry of Object.entries(value)) {
        const [key, value] = entry

        serialized.properties.push({
          key,
          value: serialize(value, forStorage, references)
        })
      }
  }

  if (references.ids.has(value)) serialized.id = references.id(value)

  return serialized
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer
exports.serializeWithTransfer = function serializeWithTransfer (value, transferList) {
  const references = new SerializeRefMap()

  for (const transferable of transferList) {
    if (transferable instanceof ArrayBuffer) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE('Detached ArrayBuffer cannot be transferred')
      }

      if (references.has(transferable)) {
        throw errors.ALREADY_TRANSFERRED('ArrayBuffer has already been transferred')
      }

      references.set(transferable, null)
    } else {
      throw errors.UNTRANSFERABLE_TYPE('Value cannot be transferred')
    }
  }

  const serialized = exports.serialize(value, false, references)

  const transfers = []

  for (const transferable of transferList) {
    if (transferable instanceof ArrayBuffer) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE('Detached ArrayBuffer cannot be transferred')
      }

      const backingStore = Buffer.from(binding.getSharedArrayBufferBackingStore(transferable))

      const id = references.id(transferable)

      let reference

      if (value.resizable) {
        reference = { type: t.RESIZABLEARRAYBUFFER, id, backingStore, maxByteLength: value.maxByteLength }
      } else {
        reference = { type: t.ARRAYBUFFER, id, backingStore }
      }

      transfers.push(reference)

      binding.detachArrayBuffer(transferable)
    }
  }

  return {
    type: t.TRANSFER,
    value: serialized,
    transfers
  }
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
exports.deserialize = function deserialize (serialized, references = new Map()) {
  let value

  switch (serialized.type) {
    case t.UNDEFINED: return undefined
    case t.NULL: return null
    case t.TRUE: return true
    case t.FALSE: return false

    case t.NUMBER:
    case t.BIGINT:
    case t.STRING: return serialized.value

    case t.DATE: return new Date(serialized.value)
    case t.REGEXP: return new RegExp(serialized.source, serialized.flags)
    case t.URL: return new URL(serialized.href)

    case t.BUFFER:
      return serialized.data

    case t.ARRAYBUFFER:
      if (serialized.owned) return serialized.data

      value = new ArrayBuffer(serialized.data.byteLength)

      Buffer.from(value).set(Buffer.from(serialized.data))

      return value

    case t.RESIZABLEARRAYBUFFER:
      if (serialized.owned) return serialized.data

      value = new ArrayBuffer(serialized.data.byteLength, { maxByteLength: serialized.maxByteLength })

      Buffer.from(value).set(Buffer.from(serialized.data))

      return value

    case t.SHAREDARRAYBUFFER:
    case t.GROWABLESHAREDARRAYBUFFER:
      value = binding.createSharedArrayBuffer(serialized.backingStore.buffer)

      serialized.backingStore.fill(0)

      return value

    case t.TYPEDARRAY: {
      const buffer = deserialize(serialized.buffer)

      switch (serialized.view) {
        case t.typedarray.UINT8ARRAY:
          return new Uint8Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.UINT8CLAMPEDARRAY:
          return new Uint8ClampedArray(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.INT8ARRAY:
          return new Int8Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.UINT16ARRAY:
          return new Uint16Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.INT16ARRAY:
          return new Int16Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.UINT32ARRAY:
          return new Uint32Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.INT32ARRAY:
          return new Int32Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.BIGUINT64ARRAY:
          return new BigUint64Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.BIGINT64ARRAY:
          return new BigInt64Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.FLOAT32ARRAY:
          return new Float32Array(buffer, serialized.byteOffset, serialized.length)
        case t.typedarray.FLOAT64ARRAY:
          return new Float64Array(buffer, serialized.byteOffset, serialized.length)
      }

      break
    }

    case t.DATAVIEW:
      return new DataView(deserialize(serialized.buffer), serialized.byteOffset, serialized.byteLength)

    case t.ERROR:
      switch (serialized.name) {
        case t.error.EVAL:
          value = new EvalError(serialized.message)
          break
        case t.error.RANGE:
          value = new RangeError(serialized.message)
          break
        case t.error.REFERENCE:
          value = new ReferenceError(serialized.message)
          break
        case t.error.SYNTAX:
          value = new SyntaxError(serialized.message)
          break
        case t.error.TYPE:
          value = new TypeError(serialized.message)
          break
        default:
          value = new Error(serialized.message)
      }

      if (serialized.stack !== null) {
        value.stack = deserialize(serialized.stack, references)
      }

      return value

    case t.MAP:
      value = new Map()
      break
    case t.SET:
      value = new Set()
      break
    case t.ARRAY:
      value = new Array(serialized.length)
      break
    case t.OBJECT:
      value = {}
      break

    case t.REFERENCE:
      if (references.has(serialized.id)) value = references.get(serialized.id)
      else {
        throw errors.INVALID_REFERENCE(`Object with ID '${serialized.id}' was not found`)
      }

      return value
  }

  if (serialized.id) references.set(serialized.id, value)

  switch (serialized.type) {
    case t.MAP:
      for (const entry of serialized.data) {
        value.set(deserialize(entry.key, references), deserialize(entry.value, references))
      }
      break

    case t.SET:
      for (const entry of serialized.data) {
        value.add(deserialize(entry, references))
      }
      break

    case t.ARRAY:
    case t.OBJECT:
      for (const entry of serialized.properties) {
        value[entry.key] = deserialize(entry.value, references)
      }
  }

  return value
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserializewithtransfer
exports.deserializeWithTransfer = function deserializeWithTransfer (serialized) {
  const references = new Map()

  for (const transfer of serialized.transfers) {
    switch (transfer.type) {
      case t.ARRAYBUFFER:
      case t.RESIZABLEARRAYBUFFER:
        references.set(transfer.id, binding.createArrayBuffer(transfer.backingStore.buffer))
    }
  }

  return exports.deserialize(serialized.value, references)
}

const flags = bitfield(0)

const header = {
  preencode (state) {
    c.uint.preencode(state, constants.VERSION)
    flags.preencode(state)
  },
  encode (state) {
    c.uint.encode(state, constants.VERSION)
    flags.encode(state, 0)
  },
  decode (state) {
    const version = c.uint.decode(state)

    if (version !== constants.VERSION) {
      throw errors.INVALID_VERSION(`Invalid ABI version '${version}'`)
    }

    flags.decode(state)
  }
}

const pair = {
  preencode (state, m) {
    c.string.preencode(state, m.key)
    value.preencode(state, m.value)
  },
  encode (state, m) {
    c.string.encode(state, m.key)
    value.encode(state, m.value)
  },
  decode (state) {
    return {
      key: c.string.decode(state),
      value: value.decode(state)
    }
  }
}

const pairs = c.array(pair)

const id = c.uint

const value = {
  preencode (state, m) {
    c.uint.preencode(state, m.type)

    switch (m.type) {
      case t.NUMBER:
        c.float64.preencode(state, m.value)
        break
      case t.BIGINT: // TODO
        break
      case t.STRING:
        c.string.preencode(state, m.value)
        break
      case t.DATE:
        c.int.preencode(state, m.value)
        break
      case t.REGEXP:
        c.string.preencode(state, m.source)
        c.string.preencode(state, m.flags)
        break
      case t.URL:
        c.string.preencode(state, m.href)
        break
      case t.MAP:
        id.preencode(state, m.id)
        pairs.preencode(state, m.data)
        break
      case t.SET:
        id.preencode(state, m.id)
        values.preencode(state, m.data)
        break
      case t.ARRAY:
        id.preencode(state, m.id)
        c.uint.preencode(state, m.length)
        pairs.preencode(state, m.properties)
        break
      case t.OBJECT:
        id.preencode(state, m.id)
        pairs.preencode(state, m.properties)
        break
    }
  },
  encode (state, m) {
    c.uint.encode(state, m.type)

    switch (m.type) {
      case t.NUMBER:
        c.float64.encode(state, m.value)
        break
      case t.BIGINT: // TODO
        break
      case t.STRING:
        c.string.encode(state, m.value)
        break
      case t.DATE:
        c.int.encode(state, m.value)
        break
      case t.REGEXP:
        c.string.encode(state, m.source)
        c.string.encode(state, m.flags)
        break
      case t.URL:
        c.string.encode(state, m.href)
        break
      case t.MAP:
        id.encode(state, m.id)
        pairs.encode(state, m.data)
        break
      case t.SET:
        id.encode(state, m.id)
        values.encode(state, m.data)
        break
      case t.ARRAY:
        id.encode(state, m.id)
        c.uint.encode(state, m.length)
        pairs.encode(state, m.properties)
        break
      case t.OBJECT:
        id.encode(state, m.id)
        pairs.encode(state, m.properties)
        break
    }
  },
  decode (state) {
    const type = c.uint.decode(state)

    switch (type) {
      case t.NUMBER: return {
        type,
        value: c.float64.decode(state)
      }
      case t.BIGINT: return { // TODO
        type
      }
      case t.STRING: return {
        type,
        value: c.string.decode(state)
      }
      case t.DATE: return {
        type,
        value: c.int.decode(state)
      }
      case t.REGEXP: return {
        type,
        source: c.string.decode(state),
        flags: c.string.decode(state)
      }
      case t.URL: return {
        type,
        href: c.string.decode(state)
      }
      case t.MAP: return {
        type,
        id: id.decode(state),
        data: pairs.decode(state)
      }
      case t.SET: return {
        type,
        id: id.decode(state),
        data: values.decode(state)
      }
      case t.ARRAY: return {
        type,
        id: id.decode(state),
        length: c.uint.decode(state),
        properties: pairs.decode(state)
      }
      case t.OBJECT: return {
        type,
        id: id.decode(state),
        properties: pairs.decode(state)
      }
      default: return {
        type
      }
    }
  }
}

const values = c.array(value)

exports.preencode = function preencode (state, m) {
  header.preencode(state)
  value.preencode(state, m)
}

exports.encode = function encode (state, m) {
  header.encode(state)
  value.encode(state, m)
}

exports.decode = function decode (state) {
  header.decode(state)
  return value.decode(state)
}
