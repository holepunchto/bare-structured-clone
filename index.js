const c = require('compact-encoding')
const bitfield = require('compact-encoding-bitfield')
const bits = require('bits-to-bytes')
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
    this.ids = new WeakMap()
    this.nextId = 1
  }

  id (object) {
    let id = this.ids.get(object)
    if (id) return id

    id = this.nextId++
    this.ids.set(object, id)

    return id
  }

  has (object) {
    return this.ids.has(object)
  }
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserialize
exports.serialize = function serialize (value, forStorage = false, references = new SerializeRefMap()) {
  return serializeValue(value, forStorage, references)
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer
exports.serializeWithTransfer = function serializeWithTransfer (value, transferList = []) {
  const references = new SerializeRefMap()

  for (const transferable of transferList) {
    if (transferable instanceof ArrayBuffer) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE('Detached ArrayBuffer cannot be transferred')
      }

      if (references.has(transferable)) {
        throw errors.ALREADY_TRANSFERRED('ArrayBuffer has already been transferred')
      }

      references.id(transferable)
    } else {
      throw errors.UNTRANSFERABLE_TYPE('Value cannot be transferred')
    }
  }

  const serialized = serializeValue(value, false, references)

  const transfers = []

  for (const transferable of transferList) {
    if (transferable instanceof ArrayBuffer) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE('Detached ArrayBuffer cannot be transferred')
      }

      const backingStore = binding.getSharedArrayBufferBackingStore(transferable)

      const id = references.id(transferable)

      let transfer

      if (value.resizable) {
        transfer = { type: t.RESIZABLEARRAYBUFFER, id, backingStore, maxByteLength: value.maxByteLength }
      } else {
        transfer = { type: t.ARRAYBUFFER, id, backingStore }
      }

      transfers.push(transfer)

      binding.detachArrayBuffer(transferable)
    }
  }

  return { type: t.TRANSFER, transfers, value: serialized }
}

function serializeValue (value, forStorage, references) {
  switch (typeof value) {
    case 'undefined': return { type: t.UNDEFINED }
    case 'boolean': return { type: value ? t.TRUE : t.FALSE }
    case 'number': return { type: t.NUMBER, value }
    case 'bigint': return { type: t.BIGINT, value }
    case 'string': return serializeString(value)
    case 'symbol': return serializeSymbol(value)
    case 'function': return serializeFunction(value)
  }

  if (value === null) return { type: t.NULL }

  return serializeReferenceable(value, forStorage, references)
}

function serializeString (value) {
  return { type: t.STRING, value }
}

function serializeSymbol (value) {
  throw errors.UNSERIALIZABLE_TYPE(`Symbol '${value.description}' cannot be serialized`)
}

function serializeFunction (value) {
  throw errors.UNSERIALIZABLE_TYPE(`Function '${value.name}' cannot be serialized`)
}

function serializeReferenceable (value, forStorage, references) {
  if (references.has(value)) return serializeReference(value, references)

  if (value instanceof Date) return serializeDate(value, references)
  if (value instanceof RegExp) return serializeRegExp(value, references)
  if (value instanceof Error) return serializeError(value, forStorage, references)
  if (value instanceof ArrayBuffer) return serializeArrayBuffer(value, references)
  if (value instanceof SharedArrayBuffer) return serializeSharedArrayBuffer(value, forStorage, references)
  if (value instanceof DataView) return serializeDataView(value, forStorage, references)
  if (value instanceof Buffer) return serializeBuffer(value, forStorage, references)
  if (ArrayBuffer.isView(value)) return serializeTypedArray(value, forStorage, references)
  if (value instanceof Map) return serializeMap(value, forStorage, references)
  if (value instanceof Set) return serializeSet(value, forStorage, references)
  if (value instanceof Array) return serializeArray(value, forStorage, references)
  if (value instanceof URL) return serializeURL(value, references)
  if (binding.isExternal(value)) return serializeExternal(value, forStorage, references)

  if (
    value instanceof Promise ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof WeakRef
  ) {
    throw errors.UNSERIALIZABLE_TYPE(`${value.constructor.name} cannot be serialized`)
  }

  return serializeObject(value, forStorage, references)
}

function serializeReference (value, references) {
  return { type: t.REFERENCE, id: references.id(value) }
}

function serializeDate (value, references) {
  return { type: t.DATE, id: references.id(value), value: value.getTime() }
}

function serializeRegExp (value, references) {
  return { type: t.REGEXP, id: references.id(value), source: value.source, flags: value.flags }
}

function serializeError (value, forStorage, references) {
  let name = 0

  switch (value.name) {
    case 'AggregateError':
      name = t.error.AGGREGATE
      break
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
    case 'URIError':
      name = t.error.URI
      break
  }

  const serialized = {
    type: t.ERROR,
    id: references.id(value),
    name,
    message: value.message.toString(),
    stack: serializeValue(value.stack, forStorage, references)
  }

  if ('cause' in value) { // Don't add unless defined
    serialized.cause = serializeValue(value.cause, forStorage, references)
  }

  if (name === t.error.AGGREGATE) {
    serialized.errors = value.errors.map((err) => serializeValue(err, forStorage, references))
  }

  return serialized
}

function serializeArrayBuffer (value, references) {
  if (value.detached) {
    throw errors.UNSERIALIZABLE_TYPE('Detached ArrayBuffer cannot be serialized')
  }

  const id = references.id(value)

  if (value.resizable) {
    return {
      type: t.RESIZABLEARRAYBUFFER,
      id,
      owned: false,
      data: value,
      maxByteLength: value.maxByteLength
    }
  }

  return {
    type: t.ARRAYBUFFER,
    id,
    owned: false,
    data: value
  }
}

function serializeSharedArrayBuffer (value, forStorage, references) {
  if (forStorage) {
    throw errors.UNSERIALIZABLE_TYPE('SharedArrayBuffer cannot be serialized to storage')
  }

  const id = references.id(value)

  const backingStore = binding.getSharedArrayBufferBackingStore(value)

  if (value.growable) {
    return {
      type: t.GROWABLESHAREDARRAYBUFFER,
      id,
      backingStore,
      maxByteLength: value.maxByteLength
    }
  }

  return {
    type: t.SHAREDARRAYBUFFER,
    id,
    backingStore
  }
}

function serializeTypedArray (value, forStorage, references) {
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
  }

  return {
    type: t.TYPEDARRAY,
    id: references.id(value),
    view,
    buffer: serializeValue(value.buffer, forStorage, references),
    byteOffset: value.byteOffset,
    byteLength: value.byteLength,
    length: value.length
  }
}

function serializeDataView (value, forStorage, references) {
  return {
    type: t.DATAVIEW,
    id: references.id(references),
    buffer: serializeValue(value.buffer, forStorage, references),
    byteOffset: value.byteOffset,
    byteLength: value.byteLength
  }
}

function serializeMap (value, forStorage, references) {
  const id = references.id(value)
  const data = []

  for (const entry of value) {
    const [key, value] = entry

    data.push({
      key: serializeValue(key, forStorage, references),
      value: serializeValue(value, forStorage, references)
    })
  }

  return { type: t.MAP, id, data }
}

function serializeSet (value, forStorage, references) {
  const id = references.id(value)
  const data = []

  for (const entry of value) {
    data.push(serializeValue(entry, forStorage, references))
  }

  return { type: t.SET, id, data }
}

function serializeArray (value, forStorage, references) {
  const id = references.id(value)
  const properties = []

  for (const entry of Object.entries(value)) {
    const [key, value] = entry

    properties.push({
      key,
      value: serializeValue(value, forStorage, references)
    })
  }

  return { type: t.ARRAY, id, length: value.length, properties }
}

function serializeObject (value, forStorage, references) {
  const id = references.id(value)
  const properties = []

  for (const entry of Object.entries(value)) {
    const [key, value] = entry

    properties.push({
      key,
      value: serializeValue(value, forStorage, references)
    })
  }

  return { type: t.OBJECT, id, properties }
}

function serializeURL (value, references) {
  return { type: t.URL, id: references.id(value), href: value.href }
}

function serializeBuffer (value, forStorage, references) {
  if (value.detached) {
    throw errors.UNSERIALIZABLE_TYPE('Detached Buffer cannot be serialized')
  }

  return {
    type: t.BUFFER,
    id: references.id(value),
    buffer: serializeValue(value.buffer, forStorage, references),
    byteOffset: value.byteOffset,
    byteLength: value.byteLength
  }
}

function serializeExternal (value, forStorage, references) {
  if (forStorage) {
    throw errors.UNSERIALIZABLE_TYPE('External pointer cannot be serialized to storage')
  }

  return {
    type: t.EXTERNAL,
    id: references.id(value),
    pointer: binding.getExternal(value)
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

    case t.DATE:
      value = new Date(serialized.value)
      break

    case t.REGEXP:
      value = new RegExp(serialized.source, serialized.flags)
      break

    case t.ERROR: {
      const options = {}

      if ('cause' in serialized) {
        options.case = deserialize(serialized.cause, references)
      }

      switch (serialized.name) {
        case t.error.AGGREGATE:
          value = new AggregateError(serialized.errors.map((err) => deserialize(err, references)), serialized.message, options)
          break
        case t.error.EVAL:
          value = new EvalError(serialized.message, options)
          break
        case t.error.RANGE:
          value = new RangeError(serialized.message, options)
          break
        case t.error.REFERENCE:
          value = new ReferenceError(serialized.message, options)
          break
        case t.error.SYNTAX:
          value = new SyntaxError(serialized.message, options)
          break
        case t.error.TYPE:
          value = new TypeError(serialized.message, options)
          break
        default:
          value = new Error(serialized.message, options)
      }

      value.stack = deserialize(serialized.stack, references)

      break
    }

    case t.ARRAYBUFFER:
      if (serialized.owned) value = serialized.data
      else {
        value = new ArrayBuffer(serialized.data.byteLength)

        Buffer.from(value).set(Buffer.from(serialized.data))
      }

      break

    case t.RESIZABLEARRAYBUFFER:
      if (serialized.owned) value = serialized.data
      else {
        value = new ArrayBuffer(serialized.data.byteLength, { maxByteLength: serialized.maxByteLength })

        Buffer.from(value).set(Buffer.from(serialized.data))
      }

      break

    case t.SHAREDARRAYBUFFER:
    case t.GROWABLESHAREDARRAYBUFFER:
      value = binding.createSharedArrayBuffer(serialized.backingStore)

      Buffer.from(serialized.backingStore).fill(0)

      break

    case t.TYPEDARRAY: {
      const buffer = deserialize(serialized.buffer, references)

      switch (serialized.view) {
        case t.typedarray.UINT8ARRAY:
          value = new Uint8Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.UINT8CLAMPEDARRAY:
          value = new Uint8ClampedArray(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.INT8ARRAY:
          value = new Int8Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.UINT16ARRAY:
          value = new Uint16Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.INT16ARRAY:
          value = new Int16Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.UINT32ARRAY:
          value = new Uint32Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.INT32ARRAY:
          value = new Int32Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.BIGUINT64ARRAY:
          value = new BigUint64Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.BIGINT64ARRAY:
          value = new BigInt64Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.FLOAT32ARRAY:
          value = new Float32Array(buffer, serialized.byteOffset, serialized.length)
          break
        case t.typedarray.FLOAT64ARRAY:
          value = new Float64Array(buffer, serialized.byteOffset, serialized.length)
          break
      }

      break
    }

    case t.DATAVIEW:
      value = new DataView(deserialize(serialized.buffer, references), serialized.byteOffset, serialized.byteLength)
      break

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

    case t.URL: return new URL(serialized.href)

    case t.BUFFER:
      value = Buffer.from(deserialize(serialized.buffer, references), serialized.byteOffset, serialized.byteLength)
      break

    case t.EXTERNAL:
      value = binding.createExternal(serialized.pointer)
      break
  }

  references.set(serialized.id, value)

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
        references.set(transfer.id, binding.createArrayBuffer(transfer.backingStore))
    }
  }

  return exports.deserialize(serialized.value, references)
}

const flags = bitfield(7)

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

const property = {
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

const properties = c.array(property)

const entry = {
  preencode (state, m) {
    value.preencode(state, m.key)
    value.preencode(state, m.value)
  },
  encode (state, m) {
    value.encode(state, m.key)
    value.encode(state, m.value)
  },
  decode (state) {
    return {
      key: value.decode(state),
      value: value.decode(state)
    }
  }
}

const entries = c.array(entry)

const transfer = {
  preencode (state, m) {
    c.uint.preencode(state, m.type)
    c.uint.preencode(state, m.id)

    switch (m.type) {
      case t.ARRAYBUFFER:
        c.arraybuffer.preencode(state, m.backingStore)
        break
      case t.RESIZABLEARRAYBUFFER:
        c.arraybuffer.preencode(state, m.backingStore)
        c.uint.preencode(state, m.maxByteLength)
        break
    }
  },
  encode (state, m) {
    c.uint.encode(state, m.type)
    c.uint.encode(state, m.id)

    switch (m.type) {
      case t.ARRAYBUFFER:
        c.arraybuffer.encode(state, m.backingStore)
        break
      case t.RESIZABLEARRAYBUFFER:
        c.arraybuffer.encode(state, m.backingStore)
        c.uint.encode(state, m.maxByteLength)
        break
    }
  },
  decode (state) {
    const type = c.uint.decode(state)
    const id = c.uint.decode(state)

    switch (type) {
      case t.ARRAYBUFFER: return {
        type,
        id,
        backingStore: c.arraybuffer.decode(state)
      }
      case t.RESIZABLEARRAYBUFFER: return {
        type,
        id,
        backingStore: c.arraybuffer.decode(state),
        maxByteLength: c.uint.decode(state)
      }
    }
  }
}

const transfers = c.array(transfer)

const value = {
  preencode (state, m) {
    c.uint.preencode(state, m.type)

    switch (m.type) {
      case t.UNDEFINED:
      case t.NULL:
      case t.TRUE:
      case t.FALSE:
        return
      case t.NUMBER:
        return c.float64.preencode(state, m.value)
      case t.BIGINT:
        return c.bigint.preencode(state, m.value)
      case t.STRING:
        return c.string.preencode(state, m.value)
      case t.TRANSFER:
        transfers.preencode(state, m.transfers)
        value.preencode(state, m.value)
        return
    }

    c.uint.preencode(state, m.type)

    switch (m.type) {
      case t.DATE:
        c.int.preencode(state, m.value)
        break
      case t.REGEXP:
        c.string.preencode(state, m.source)
        c.string.preencode(state, m.flags)
        break
      case t.ERROR:
        flags.preencode(state)
        c.uint.preencode(state, m.name)
        c.string.preencode(state, m.message)
        value.preencode(state, m.stack)
        if ('cause' in m) value.preencode(state, m.cause)
        if (m.name === t.error.AGGREGATE) values.preencode(state, m.errors)
        break
      case t.ARRAYBUFFER:
        c.arraybuffer.preencode(state, m.data)
        break
      case t.RESIZABLEARRAYBUFFER:
        c.arraybuffer.preencode(state, m.data)
        c.uint.preencode(state, m.maxByteLength)
        break
      case t.SHAREDARRAYBUFFER:
        c.arraybuffer.preencode(state, m.backingStore)
        break
      case t.GROWABLESHAREDARRAYBUFFER:
        c.arraybuffer.preencode(state, m.backingStore)
        c.uint.preencode(state, m.maxByteLength)
        break
      case t.TYPEDARRAY:
        c.uint.preencode(state, m.view)
        value.preencode(state, m.buffer)
        c.uint.preencode(state, m.byteOffset)
        c.uint.preencode(state, m.byteLength)
        c.uint.preencode(state, m.length)
        break
      case t.DATAVIEW:
        value.preencode(state, m.buffer)
        c.uint.preencode(state, m.byteOffset)
        c.uint.preencode(state, m.byteLength)
        break
      case t.MAP:
        entries.preencode(state, m.data)
        break
      case t.SET:
        values.preencode(state, m.data)
        break
      case t.ARRAY:
        c.uint.preencode(state, m.length)
        properties.preencode(state, m.properties)
        break
      case t.OBJECT:
        properties.preencode(state, m.properties)
        break
      case t.EXTERNAL:
        c.arraybuffer.preencode(state, m.pointer)
        break
      case t.REFERENCE:
        break
      case t.URL:
        c.string.preencode(state, m.href)
        break
      case t.BUFFER:
        value.preencode(state, m.buffer)
        c.uint.preencode(state, m.byteOffset)
        c.uint.preencode(state, m.byteLength)
        break
    }
  },
  encode (state, m) {
    c.uint.encode(state, m.type)

    switch (m.type) {
      case t.UNDEFINED:
      case t.NULL:
      case t.TRUE:
      case t.FALSE:
        return
      case t.NUMBER:
        return c.float64.encode(state, m.value)
      case t.BIGINT:
        return c.bigint.encode(state, m.value)
      case t.STRING:
        return c.string.encode(state, m.value)
      case t.TRANSFER:
        transfers.encode(state, m.transfers)
        value.encode(state, m.value)
        return
    }

    c.uint.encode(state, m.id)

    switch (m.type) {
      case t.DATE:
        c.int.encode(state, m.value)
        break
      case t.REGEXP:
        c.string.encode(state, m.source)
        c.string.encode(state, m.flags)
        break
      case t.ERROR:
        flags.encode(state, bits.of('cause' in m))
        c.uint.encode(state, m.name)
        c.string.encode(state, m.message)
        value.encode(state, m.stack)
        if ('cause' in m) value.encode(state, m.cause)
        if (m.name === t.error.AGGREGATE) values.encode(state, m.errors)
        break
      case t.ARRAYBUFFER:
        c.arraybuffer.encode(state, m.data)
        break
      case t.RESIZABLEARRAYBUFFER:
        c.arraybuffer.encode(state, m.data)
        c.uint.encode(state, m.maxByteLength)
        break
      case t.SHAREDARRAYBUFFER:
        c.arraybuffer.encode(state, m.backingStore)
        break
      case t.GROWABLESHAREDARRAYBUFFER:
        c.arraybuffer.encode(state, m.backingStore)
        c.uint.encode(state, m.maxByteLength)
        break
      case t.TYPEDARRAY:
        c.uint.encode(state, m.view)
        value.encode(state, m.buffer)
        c.uint.encode(state, m.byteOffset)
        c.uint.encode(state, m.byteLength)
        c.uint.encode(state, m.length)
        break
      case t.DATAVIEW:
        value.encode(state, m.buffer)
        c.uint.encode(state, m.byteOffset)
        c.uint.encode(state, m.byteLength)
        break
      case t.MAP:
        entries.encode(state, m.data)
        break
      case t.SET:
        values.encode(state, m.data)
        break
      case t.ARRAY:
        c.uint.encode(state, m.length)
        properties.encode(state, m.properties)
        break
      case t.OBJECT:
        properties.encode(state, m.properties)
        break
      case t.EXTERNAL:
        c.arraybuffer.encode(state, m.pointer)
        break
      case t.REFERENCE:
        break
      case t.URL:
        c.string.encode(state, m.href)
        break
      case t.BUFFER:
        value.encode(state, m.buffer)
        c.uint.encode(state, m.byteOffset)
        c.uint.encode(state, m.byteLength)
        break
    }
  },
  decode (state) {
    const type = c.uint.decode(state)

    switch (type) {
      case t.UNDEFINED:
      case t.NULL:
      case t.TRUE:
      case t.FALSE: return {
        type
      }
      case t.NUMBER: return {
        type,
        value: c.float64.decode(state)
      }
      case t.BIGINT: return {
        type,
        value: c.bigint.decode(state)
      }
      case t.STRING: return {
        type,
        value: c.string.decode(state)
      }
      case t.TRANSFER: return {
        type,
        transfers: transfers.decode(state),
        value: value.decode(state)
      }
    }

    const id = c.uint.decode(state)

    switch (type) {
      case t.DATE: return {
        type,
        id,
        value: c.int.decode(state)
      }
      case t.REGEXP: return {
        type,
        id,
        source: c.string.decode(state),
        flags: c.string.decode(state)
      }
      case t.ERROR: {
        const [hasCause] = bits.iterator(flags.decode(state))

        const m = {
          type,
          id,
          name: c.uint.decode(state),
          message: c.string.decode(state),
          stack: value.decode(state)
        }

        if (hasCause) m.cause = value.decode(state)

        if (m.name === t.error.AGGREGATE) m.errors = values.decode(state)

        return m
      }
      case t.ARRAYBUFFER: return {
        type,
        id,
        owned: true,
        data: c.arraybuffer.decode(state)
      }
      case t.RESIZABLEARRAYBUFFER: return {
        type,
        id,
        owned: true,
        data: c.arraybuffer.decode(state),
        maxByteLength: c.uint.decode(state)
      }
      case t.SHAREDARRAYBUFFER: return {
        type,
        id,
        backingStore: c.arraybuffer.decode(state)
      }
      case t.GROWABLESHAREDARRAYBUFFER: return {
        type,
        id,
        backingStore: c.arraybuffer.decode(state),
        maxByteLength: c.uint.decode(state)
      }
      case t.TYPEDARRAY: return {
        type,
        id,
        view: c.uint.decode(state),
        buffer: value.decode(state),
        byteOffset: c.uint.decode(state),
        byteLength: c.uint.decode(state),
        length: c.uint.decode(state)
      }
      case t.DATAVIEW: return {
        type,
        id,
        buffer: value.decode(state),
        byteOffset: c.uint.decode(state),
        byteLength: c.uint.decode(state)
      }
      case t.MAP: return {
        type,
        id,
        data: entries.decode(state)
      }
      case t.SET: return {
        type,
        id,
        data: values.decode(state)
      }
      case t.ARRAY: return {
        type,
        id,
        length: c.uint.decode(state),
        properties: properties.decode(state)
      }
      case t.OBJECT: return {
        type,
        id,
        properties: properties.decode(state)
      }
      case t.REFERENCE: return {
        type,
        id
      }
      case t.URL: return {
        type,
        id,
        href: c.string.decode(state)
      }
      case t.BUFFER: return {
        type,
        id,
        buffer: value.decode(state),
        byteOffset: c.uint.decode(state),
        byteLength: c.uint.decode(state)
      }
      case t.EXTERNAL: return {
        type,
        id,
        pointer: c.arraybuffer.decode(state)
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
