const getType = require('bare-type')
const c = require('compact-encoding')
const bitfield = require('compact-encoding-bitfield')
const bits = require('bits-to-bytes')
const constants = require('./lib/constants')
const errors = require('./lib/errors')
const binding = require('./binding')

const t = constants.type

module.exports = exports = function structuredClone (value, opts = {}) {
  return exports.deserializeWithTransfer(exports.serializeWithTransfer(value, opts.transfer, opts.interfaces), opts.interfaces)
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserialize
exports.serialize = function serialize (value, forStorage = false, interfaces = []) {
  return serializeValue(value, forStorage, new InterfaceMap(interfaces), new ReferenceMap())
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer
exports.serializeWithTransfer = function serializeWithTransfer (value, transferList = [], interfaces = []) {
  return serializeValueWithTransfer(value, transferList, new InterfaceMap(interfaces))
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
exports.deserialize = function deserialize (serialized, interfaces = []) {
  return deserializeValue(serialized, new InterfaceMap(interfaces), new Map())
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserializewithtransfer
exports.deserializeWithTransfer = function deserializeWithTransfer (serialized, interfaces = []) {
  return deserializeValueWithTransfer(serialized, new InterfaceMap(interfaces))
}

exports.constants = constants
exports.errors = errors

exports.Serializable = class Serializable {
  [Symbol.for('bare.serialize')] (forStorage) {}

  static [Symbol.for('bare.deserialize')] (serialized) {}
}

exports.Transferable = class Transferable {
  constructor () {
    this.detached = false
  }

  [Symbol.for('bare.detach')] () {
    this.detached = true
  }

  static [Symbol.for('bare.attach')] (serialized) {}
}

class InterfaceMap {
  constructor (interfaces) {
    this.ids = new WeakMap()
    this.interfaces = new Map()

    let nextId = 1

    for (const constructor of interfaces) {
      const id = nextId++

      this.ids.set(constructor, id)
      this.interfaces.set(id, constructor)
    }
  }

  id (constructor) {
    const id = this.ids.get(constructor)

    if (!id) {
      throw errors.INVALID_INTERFACE(`Class '${constructor.name}' is not registered as a serializable or transferable interface`)
    }

    return id
  }

  get (id) {
    const constructor = this.interfaces.get(id)

    if (!constructor) {
      throw errors.INVALID_INTERFACE(`Interface with ID '${id}' was not found`)
    }

    return constructor
  }
}

class ReferenceMap {
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

function serializeValue (value, forStorage, interfaces, references) {
  const type = getType(value)

  if (type.isUndefined()) return { type: t.UNDEFINED }
  if (type.isNull()) return { type: t.NULL }
  if (type.isBoolean()) return { type: value ? t.TRUE : t.FALSE }
  if (type.isNumber()) return { type: t.NUMBER, value }
  if (type.isBigInt()) return { type: t.BIGINT, value }
  if (type.isString()) return serializeString(value)
  if (type.isSymbol()) return serializeSymbol(value)
  if (type.isObject()) return serializeReferenceable(type, value, forStorage, interfaces, references)
  if (type.isFunction()) return serializeFunction(value)
  if (type.isExternal()) return serializeExternal(value, forStorage, references)
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

function serializeReferenceable (type, value, forStorage, interfaces, references) {
  if (references.has(value)) return serializeReference(value, references)

  if (value instanceof URL) return serializeURL(value, references)
  if (value instanceof Buffer) return serializeBuffer(value, forStorage, interfaces, references)

  if (type.isArray()) return serializeArray(value, forStorage, interfaces, references)
  if (type.isDate()) return serializeDate(value, references)
  if (type.isRegExp()) return serializeRegExp(value, references)
  if (type.isError()) return serializeError(value, forStorage, interfaces, references)
  if (type.isMap()) return serializeMap(value, forStorage, interfaces, references)
  if (type.isSet()) return serializeSet(value, forStorage, interfaces, references)
  if (type.isArrayBuffer()) return serializeArrayBuffer(value, references)
  if (type.isSharedArrayBuffer()) return serializeSharedArrayBuffer(value, forStorage, references)
  if (type.isTypedArray()) return serializeTypedArray(type, value, forStorage, interfaces, references)
  if (type.isDataView()) return serializeDataView(value, forStorage, interfaces, references)

  if (
    type.isPromise() ||
    type.isProxy() ||
    type.isWeakMap() ||
    type.isWeakSet() ||
    type.isWeakRef()
  ) {
    throw errors.UNSERIALIZABLE_TYPE(`${value.constructor.name} cannot be serialized`)
  }

  const serialize = value[Symbol.for('bare.serialize')]

  if (serialize) return serializeSerializable(value, serialize, forStorage, interfaces, references)

  return serializeObject(value, forStorage, interfaces, references)
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

function serializeError (value, forStorage, interfaces, references) {
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
    stack: serializeValue(value.stack, forStorage, interfaces, references)
  }

  if ('cause' in value) { // Don't add unless defined
    serialized.cause = serializeValue(value.cause, forStorage, interfaces, references)
  }

  if (name === t.error.AGGREGATE) {
    serialized.errors = value.errors.map((err) => serializeValue(err, forStorage, interfaces, references))
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

function serializeTypedArray (type, value, forStorage, interfaces, references) {
  let view

  if (type.isUint8Array()) {
    view = t.typedarray.UINT8ARRAY
  } else if (type.isUint8ClampedArray()) {
    view = t.typedarray.UINT8CLAMPEDARRAY
  } else if (type.isInt8Array()) {
    view = t.typedarray.INT8ARRAY
  } else if (type.isUint16Array()) {
    view = t.typedarray.UINT16ARRAY
  } else if (type.isInt16Array()) {
    view = t.typedarray.INT16ARRAY
  } else if (type.isUint32Array()) {
    view = t.typedarray.UINT32ARRAY
  } else if (type.isInt32Array()) {
    view = t.typedarray.INT32ARRAY
  } else if (type.isBigUint64Array()) {
    view = t.typedarray.BIGUINT64ARRAY
  } else if (type.isBigInt64Array()) {
    view = t.typedarray.BIGINT64ARRAY
  } else if (type.isFloat32Array()) {
    view = t.typedarray.FLOAT32ARRAY
  } else if (type.isFloat64Array()) {
    view = t.typedarray.FLOAT64ARRAY
  }

  return {
    type: t.TYPEDARRAY,
    id: references.id(value),
    view,
    buffer: serializeValue(value.buffer, forStorage, interfaces, references),
    byteOffset: value.byteOffset,
    byteLength: value.byteLength,
    length: value.length
  }
}

function serializeDataView (value, forStorage, interfaces, references) {
  return {
    type: t.DATAVIEW,
    id: references.id(references),
    buffer: serializeValue(value.buffer, forStorage, interfaces, references),
    byteOffset: value.byteOffset,
    byteLength: value.byteLength
  }
}

function serializeMap (value, forStorage, interfaces, references) {
  const id = references.id(value)
  const data = []

  for (const entry of value) {
    const [key, value] = entry

    data.push({
      key: serializeValue(key, forStorage, interfaces, references),
      value: serializeValue(value, forStorage, interfaces, references)
    })
  }

  return { type: t.MAP, id, data }
}

function serializeSet (value, forStorage, interfaces, references) {
  const id = references.id(value)
  const data = []

  for (const entry of value) {
    data.push(serializeValue(entry, forStorage, interfaces, references))
  }

  return { type: t.SET, id, data }
}

function serializeArray (value, forStorage, interfaces, references) {
  const id = references.id(value)
  const properties = []

  for (const entry of Object.entries(value)) {
    const [key, value] = entry

    properties.push({
      key,
      value: serializeValue(value, forStorage, interfaces, references)
    })
  }

  return { type: t.ARRAY, id, length: value.length, properties }
}

function serializeObject (value, forStorage, interfaces, references) {
  const id = references.id(value)
  const properties = []

  for (const entry of Object.entries(value)) {
    const [key, value] = entry

    properties.push({
      key,
      value: serializeValue(value, forStorage, interfaces, references)
    })
  }

  return { type: t.OBJECT, id, properties }
}

function serializeURL (value, references) {
  return { type: t.URL, id: references.id(value), href: value.href }
}

function serializeBuffer (value, forStorage, interfaces, references) {
  if (value.detached) {
    throw errors.UNSERIALIZABLE_TYPE('Detached Buffer cannot be serialized')
  }

  return {
    type: t.BUFFER,
    id: references.id(value),
    buffer: serializeValue(value.buffer, forStorage, interfaces, references),
    byteOffset: value.byteOffset,
    byteLength: value.byteLength
  }
}

function serializeExternal (value, forStorage) {
  if (forStorage) {
    throw errors.UNSERIALIZABLE_TYPE('External pointer cannot be serialized to storage')
  }

  return {
    type: t.EXTERNAL,
    pointer: binding.getExternal(value)
  }
}

function serializeSerializable (value, serializer, forStorage, interfaces, references) {
  return {
    type: t.SERIALIZABLE,
    id: references.id(value),
    interface: interfaces.id(value.constructor),
    value: serializeValue(serializer.call(value, forStorage), forStorage, interfaces, references)
  }
}

function serializeValueWithTransfer (value, transferList, interfaces) {
  const references = new ReferenceMap()

  for (const transferable of transferList) {
    const type = getType(transferable)

    if (type.isArrayBuffer()) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE('Detached \'ArrayBuffer\' cannot be transferred')
      }

      if (references.has(transferable)) {
        throw errors.ALREADY_TRANSFERRED('\'ArrayBuffer\' has already been transferred')
      }

      references.id(transferable)
    } else {
      const detach = transferable[Symbol.for('bare.detach')]

      if (detach) {
        if (transferable.detached) {
          throw errors.UNTRANSFERABLE_TYPE(`Detached '${transferable.constructor.name}' cannot be transferred`)
        }

        if (references.has(transferable)) {
          throw errors.ALREADY_TRANSFERRED(`'${transferable.constructor.name}' has already been transferred`)
        }

        references.id(transferable)
      } else {
        throw errors.UNTRANSFERABLE_TYPE('Value cannot be transferred')
      }
    }
  }

  const serialized = serializeValue(value, false, interfaces, references)

  const transfers = []

  for (const transferable of transferList) {
    const type = getType(transferable)

    if (type.isArrayBuffer()) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE('Detached ArrayBuffer cannot be transferred')
      }

      const backingStore = binding.getArrayBufferBackingStore(transferable)

      const id = references.id(transferable)

      let transfer

      if (value.resizable) {
        transfer = { type: t.RESIZABLEARRAYBUFFER, id, backingStore, maxByteLength: value.maxByteLength }
      } else {
        transfer = { type: t.ARRAYBUFFER, id, backingStore }
      }

      transfers.push(transfer)

      binding.detachArrayBuffer(transferable)
    } else {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE(`Detached '${transferable.constructor.name}' cannot be transferred`)
      }

      const detach = transferable[Symbol.for('bare.detach')]

      const transfer = {
        type: t.TRANSFERABLE,
        id: references.id(transferable),
        interface: interfaces.id(transferable.constructor),
        value: serializeValue(detach.call(transferable), false, interfaces, references)
      }

      transfers.push(transfer)
    }
  }

  return { type: t.TRANSFER, transfers, value: serialized }
}

function deserializeValue (serialized, interfaces, references) {
  let value

  switch (serialized.type) {
    case t.UNDEFINED: return undefined
    case t.NULL: return null
    case t.TRUE: return true
    case t.FALSE: return false

    case t.NUMBER:
    case t.BIGINT:
    case t.STRING: return serialized.value

    case t.EXTERNAL: return binding.createExternal(serialized.pointer)

    case t.DATE:
      value = new Date(serialized.value)
      break

    case t.REGEXP:
      value = new RegExp(serialized.source, serialized.flags)
      break

    case t.ERROR: {
      const options = {}

      if ('cause' in serialized) {
        options.case = deserializeValue(serialized.cause, interfaces, references)
      }

      switch (serialized.name) {
        case t.error.AGGREGATE:
          value = new AggregateError(serialized.errors.map((err) => deserializeValue(err, interfaces, references)), serialized.message, options)
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

      value.stack = deserializeValue(serialized.stack, interfaces, references)

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
      const buffer = deserializeValue(serialized.buffer, interfaces, references)

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
      value = new DataView(deserializeValue(serialized.buffer, interfaces, references), serialized.byteOffset, serialized.byteLength)
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
      value = Buffer.from(deserializeValue(serialized.buffer, interfaces, references), serialized.byteOffset, serialized.byteLength)
      break

    case t.SERIALIZABLE: {
      const constructor = interfaces.get(serialized.interface)

      const deserialize = constructor[Symbol.for('bare.deserialize')]

      value = deserialize.call(constructor, deserializeValue(serialized.value, interfaces, references))
      break
    }
  }

  references.set(serialized.id, value)

  switch (serialized.type) {
    case t.MAP:
      for (const entry of serialized.data) {
        value.set(deserializeValue(entry.key, interfaces, references), deserializeValue(entry.value, interfaces, references))
      }
      break

    case t.SET:
      for (const entry of serialized.data) {
        value.add(deserializeValue(entry, interfaces, references))
      }
      break

    case t.ARRAY:
    case t.OBJECT:
      for (const entry of serialized.properties) {
        value[entry.key] = deserializeValue(entry.value, interfaces, references)
      }
      break
  }

  return value
}

function deserializeValueWithTransfer (serialized, interfaces) {
  const references = new Map()

  for (const transfer of serialized.transfers) {
    switch (transfer.type) {
      case t.ARRAYBUFFER:
      case t.RESIZABLEARRAYBUFFER:
        references.set(transfer.id, binding.createArrayBuffer(transfer.backingStore))
        break

      case t.TRANSFERABLE: {
        const constructor = interfaces.get(transfer.interface)

        const attach = constructor[Symbol.for('bare.attach')]

        references.set(transfer.id, attach.call(constructor, deserializeValue(transfer.value, interfaces, references)))
        break
      }
    }
  }

  return deserializeValue(serialized.value, interfaces, references)
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
      case t.TRANSFERABLE:
        c.uint.preencode(state, m.interface)
        value.preencode(state, m.value)
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
      case t.TRANSFERABLE:
        c.uint.encode(state, m.interface)
        value.encode(state, m.value)
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
      case t.TRANSFERABLE: return {
        type,
        id,
        interface: c.uint.decode(state),
        value: value.decode(state)
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
      case t.EXTERNAL:
        return c.arraybuffer.preencode(state, m.pointer)
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
      case t.SERIALIZABLE:
        c.uint.preencode(state, m.interface)
        value.preencode(state, m.value)
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
      case t.EXTERNAL:
        return c.arraybuffer.encode(state, m.pointer)
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
      case t.SERIALIZABLE:
        c.uint.encode(state, m.interface)
        value.encode(state, m.value)
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
      case t.EXTERNAL: return {
        type,
        pointer: c.arraybuffer.decode(state)
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
      case t.SERIALIZABLE: return {
        type,
        id,
        interface: c.uint.decode(state),
        value: value.decode(state)
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
