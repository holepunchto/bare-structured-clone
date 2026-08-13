const getType = require('bare-type')
const { isURL } = require('bare-url')
const { isBuffer } = require('bare-buffer')
const c = require('compact-encoding')
const constants = require('./lib/constants')
const errors = require('./lib/errors')
const binding = require('./binding')

const t = constants.type

const kNames = Symbol('bare.structured-clone.names')

const kSerialize = Symbol.for('bare.serialize')
const kDeserialize = Symbol.for('bare.deserialize')
const kDetach = Symbol.for('bare.detach')
const kAttach = Symbol.for('bare.attach')
const kInterface = Symbol.for('bare.interface')

module.exports = exports = function structuredClone(value, opts = {}) {
  const interfaces = new InterfaceMap(opts.interfaces || [])

  return deserializeValueWithTransfer(
    serializeValueWithTransfer(value, opts.transfer || [], interfaces),
    interfaces
  )
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserialize
exports.serialize = function serialize(value, forStorage = false, interfaces = []) {
  const references = new ReferenceMap()

  const serialized = serializeValue(value, forStorage, new InterfaceMap(interfaces), references)

  finalizeBuffers(references)

  return serialized
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structuredserializewithtransfer
exports.serializeWithTransfer = function serializeWithTransfer(
  value,
  transferList = [],
  interfaces = []
) {
  return serializeValueWithTransfer(value, transferList, new InterfaceMap(interfaces))
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserialize
exports.deserialize = function deserialize(serialized, interfaces = []) {
  return deserializeValue(serialized, new InterfaceMap(interfaces), new Map())
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserializewithtransfer
exports.deserializeWithTransfer = function deserializeWithTransfer(serialized, interfaces = []) {
  return deserializeValueWithTransfer(serialized, new InterfaceMap(interfaces))
}

exports.constants = constants
exports.errors = errors

exports.symbols = {
  serialize: kSerialize,
  deserialize: kDeserialize,
  detach: kDetach,
  attach: kAttach,
  interface: kInterface
}

exports.Serializable = class Serializable {
  [exports.symbols.serialize](forStorage) {}

  static [exports.symbols.deserialize](serialized) {}
}

exports.Transferable = class Transferable {
  constructor() {
    this.detached = false
  }

  [exports.symbols.detach]() {
    this.detached = true
  }

  static [exports.symbols.attach](serialized) {}
}

class InterfaceMap {
  constructor(interfaces) {
    // Most values carry no custom interfaces at all, so the backing maps are
    // only allocated once there is something to put in them.
    this.ids = null
    this.keys = null
    this.interfaces = null

    if (interfaces.length === 0) return

    this.ids = new WeakMap()
    this.keys = new Map()
    this.interfaces = new Map()

    let nextId = 1

    for (const constructor of interfaces) {
      const id = nextId++

      this.ids.set(constructor, id)

      const key = constructor[kInterface]

      if (key !== undefined) this.keys.set(key, id)

      this.interfaces.set(id, constructor)
    }
  }

  id(constructor) {
    if (this.ids === null) {
      throw errors.INVALID_INTERFACE(
        `Class '${constructor.name}' is not registered as a serializable or transferable interface`
      )
    }

    let id = this.ids.get(constructor)

    if (id) return id

    // The constructor was not registered by identity, but a distinct copy of
    // the same class might have been, for example when the value originates
    // from code that bundles its own copy of the interface. Fall back to the
    // interface key that the class declares for itself, a shared symbol such
    // as one from the global registry, so that any such copy with a matching
    // API resolves to the registered interface.
    const key = constructor[kInterface]

    if (key !== undefined) {
      id = this.keys.get(key)

      if (id) {
        this.ids.set(constructor, id)

        return id
      }
    }

    throw errors.INVALID_INTERFACE(
      `Class '${constructor.name}' is not registered as a serializable or transferable interface`
    )
  }

  get(id) {
    const constructor = this.interfaces === null ? undefined : this.interfaces.get(id)

    if (!constructor) {
      throw errors.INVALID_INTERFACE(`Interface with ID '${id}' was not found`)
    }

    return constructor
  }
}

class ReferenceMap {
  constructor() {
    // Serializing a primitive never records a reference, so defer allocating
    // the backing map until the first object is seen.
    this.ids = null
    this.nextId = 1

    // Which arraybuffers are viewed by the value, and which the value carries
    // in its own right. Both are only needed once the whole value has been
    // walked, to decide whether each buffer can be shared or has to be copied
    // out of.
    this.views = null
    this.buffers = null
  }

  view(buffer, node) {
    if (this.views === null) this.views = new Map()

    const nodes = this.views.get(buffer)

    if (nodes === undefined) this.views.set(buffer, [node])
    else nodes.push(node)
  }

  buffer(buffer) {
    if (this.buffers === null) this.buffers = new Set()

    this.buffers.add(buffer)
  }

  id(object) {
    if (this.ids === null) this.ids = new WeakMap()
    else {
      const id = this.ids.get(object)
      if (id) return id
    }

    const id = this.nextId++
    this.ids.set(object, id)

    return id
  }

  has(object) {
    return this.ids !== null && this.ids.has(object)
  }
}

// The largest value an array index may take, above which a numeric key is an
// ordinary named property.
const MAX_INDEX = 0xfffffffe

// Returns the index a key denotes, or -1 if the key names an ordinary property.
function asIndex(key) {
  // Names outnumber indices on ordinary objects, so rule them out on the first
  // character before going through a numeric conversion. This also means the
  // conversion below can never produce a negative number.
  const code = key.charCodeAt(0)

  if (code < 0x30 || code > 0x39) return -1

  const index = +key

  if (!Number.isInteger(index) || index > MAX_INDEX) return -1
  if ('' + index !== key) return -1

  return index
}

// Sharing the whole of an arraybuffer between the views onto it is what keeps
// those views aliased on the far side of a clone. It is only safe to do when
// the views cover the buffer between them; a view onto part of a larger buffer
// would otherwise take everything around it along too, which for a buffer drawn
// from a pool is unrelated data belonging to somebody else. So where the views
// leave any of the buffer uncovered, each one is given a copy of just the bytes
// it spans.
//
// Aliasing between such views is given up in the process, which is the price of
// not carrying the gaps between them. Buffers the value carries in their own
// right are always shared whole, as nothing about them is being leaked, and so
// are resizable and shared buffers, whose semantics a copy would not preserve.
function finalizeBuffers(references) {
  const views = references.views

  if (views === null) return

  const buffers = references.buffers

  for (const [buffer, nodes] of views) {
    if (buffers !== null && buffers.has(buffer)) continue

    // Only a buffer this serialization owns the sole node for can be rewritten.
    // Anything else, a transferred buffer in particular, is already accounted
    // for somewhere the views cannot see.
    let owner = null

    for (const node of nodes) {
      if (node.buffer.type === t.ARRAYBUFFER) owner = node.buffer
    }

    if (owner === null || owner.data !== buffer) continue

    if (covers(nodes, buffer.byteLength)) continue

    for (const node of nodes) {
      const data = new ArrayBuffer(node.byteLength)

      new Uint8Array(data).set(new Uint8Array(buffer, node.byteOffset, node.byteLength))

      node.buffer =
        node.buffer === owner
          ? Object.assign(owner, { data })
          : { type: t.ARRAYBUFFER, id: references.id(data), owned: false, data }

      node.byteOffset = 0
    }
  }
}

// Whether the views leave no part of a buffer of `byteLength` bytes uncovered.
function covers(nodes, byteLength) {
  if (byteLength === 0) return true

  const ranges = nodes
    .map((node) => [node.byteOffset, node.byteOffset + node.byteLength])
    .sort((a, b) => a[0] - b[0])

  let end = 0

  for (const [from, to] of ranges) {
    if (from > end) return false
    if (to > end) end = to
  }

  return end >= byteLength
}

function serializeValue(value, forStorage, interfaces, references) {
  switch (typeof value) {
    case 'undefined':
      return { type: t.UNDEFINED }
    case 'boolean':
      return { type: value ? t.TRUE : t.FALSE }
    case 'number':
      return { type: t.NUMBER, value }
    case 'bigint':
      return { type: t.BIGINT, value }
    case 'string':
      return serializeString(value)
    case 'symbol':
      return serializeSymbol(value)
    case 'function':
      return serializeFunction(value)
  }

  if (value === null) return { type: t.NULL }

  const type = getType(value)

  if (type.isObject()) {
    return serializeReferenceable(type, value, forStorage, interfaces, references)
  }

  if (type.isExternal()) return serializeExternal(value, forStorage, references)
}

function serializeString(value) {
  return { type: t.STRING, value }
}

function serializeSymbol(value) {
  throw errors.UNSERIALIZABLE_TYPE(`Symbol '${value.description}' cannot be serialized`)
}

function serializeFunction(value) {
  throw errors.UNSERIALIZABLE_TYPE(`Function '${value.name}' cannot be serialized`)
}

function serializeReferenceable(type, value, forStorage, interfaces, references) {
  if (references.has(value)) {
    if (type.isArrayBuffer()) references.buffer(value)

    return serializeReference(value, references)
  }

  if (isURL(value)) return serializeURL(value, references)
  if (isBuffer(value)) return serializeBuffer(value, forStorage, interfaces, references)

  if (type.isArray()) return serializeArray(value, forStorage, interfaces, references)
  if (type.isDate()) return serializeDate(value, references)
  if (type.isRegExp()) return serializeRegExp(value, references)
  if (type.isError()) return serializeError(value, forStorage, interfaces, references)
  if (type.isMap()) return serializeMap(value, forStorage, interfaces, references)
  if (type.isSet()) return serializeSet(value, forStorage, interfaces, references)
  if (type.isArrayBuffer()) {
    references.buffer(value)
    return serializeArrayBuffer(value, references)
  }
  if (type.isSharedArrayBuffer()) return serializeSharedArrayBuffer(value, forStorage, references)
  if (type.isTypedArray()) {
    return serializeTypedArray(type, value, forStorage, interfaces, references)
  }
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

  const serialize = value[kSerialize]

  if (serialize) return serializeSerializable(value, serialize, forStorage, interfaces, references)

  return serializeObject(value, forStorage, interfaces, references)
}

function serializeReference(value, references) {
  return { type: t.REFERENCE, id: references.id(value) }
}

function serializeDate(value, references) {
  return { type: t.DATE, id: references.id(value), value: value.getTime() }
}

function serializeRegExp(value, references) {
  return {
    type: t.REGEXP,
    id: references.id(value),
    source: value.source,
    flags: value.flags
  }
}

function serializeError(value, forStorage, interfaces, references) {
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

  if ('cause' in value) {
    // Don't add unless defined
    serialized.cause = serializeValue(value.cause, forStorage, interfaces, references)
  }

  if (name === t.error.AGGREGATE) {
    serialized.errors = value.errors.map((err) =>
      serializeValue(err, forStorage, interfaces, references)
    )
  }

  return serialized
}

function serializeViewBuffer(view, value, forStorage, interfaces, references) {
  let serialized

  if (references.has(value)) serialized = serializeReference(value, references)
  else if (getType(value).isSharedArrayBuffer()) {
    serialized = serializeSharedArrayBuffer(value, forStorage, references)
  } else {
    serialized = serializeArrayBuffer(value, references)
  }

  references.view(value, view)

  return serialized
}

function serializeArrayBuffer(value, references) {
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

function serializeSharedArrayBuffer(value, forStorage, references) {
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

function serializeTypedArray(type, value, forStorage, interfaces, references) {
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
  } else if (type.isFloat16Array()) {
    view = t.typedarray.FLOAT16ARRAY
  } else if (type.isFloat32Array()) {
    view = t.typedarray.FLOAT32ARRAY
  } else if (type.isFloat64Array()) {
    view = t.typedarray.FLOAT64ARRAY
  }

  const serialized = {
    type: t.TYPEDARRAY,
    id: references.id(value),
    view,
    buffer: null,
    byteOffset: value.byteOffset,
    byteLength: value.byteLength,
    length: value.length
  }

  serialized.buffer = serializeViewBuffer(
    serialized,
    value.buffer,
    forStorage,
    interfaces,
    references
  )

  return serialized
}

function serializeDataView(value, forStorage, interfaces, references) {
  const serialized = {
    type: t.DATAVIEW,
    id: references.id(value),
    buffer: null,
    byteOffset: value.byteOffset,
    byteLength: value.byteLength
  }

  serialized.buffer = serializeViewBuffer(
    serialized,
    value.buffer,
    forStorage,
    interfaces,
    references
  )

  return serialized
}

function serializeMap(value, forStorage, interfaces, references) {
  const id = references.id(value)
  const data = new Array(value.size)

  let i = 0

  for (const entry of value) {
    data[i++] = {
      key: serializeValue(entry[0], forStorage, interfaces, references),
      value: serializeValue(entry[1], forStorage, interfaces, references)
    }
  }

  return { type: t.MAP, id, data }
}

function serializeSet(value, forStorage, interfaces, references) {
  const id = references.id(value)
  const data = new Array(value.size)

  let i = 0

  for (const entry of value) {
    data[i++] = serializeValue(entry, forStorage, interfaces, references)
  }

  return { type: t.SET, id, data }
}

function serializeArray(value, forStorage, interfaces, references) {
  const id = references.id(value)

  const keys = Object.keys(value)
  const length = value.length

  // Indices enumerate ahead of names and in ascending order, so if the last one
  // falls where a dense array would put it then every index in range is present.
  // This also means the indices are known without converting any key.
  const dense = keys.length >= length && (length === 0 || keys[length - 1] === '' + (length - 1))

  let elements = null
  let from = 0

  if (dense) {
    elements = new Array(length)

    for (; from < length; from++) {
      elements[from] = serializeValue(value[from], forStorage, interfaces, references)
    }
  }

  const properties = new Array(keys.length - from)

  for (let i = from; i < keys.length; i++) {
    const key = keys[i]
    const index = asIndex(key)

    properties[i - from] = {
      key: index === -1 ? key : index,
      value: serializeValue(value[key], forStorage, interfaces, references)
    }
  }

  return { type: t.ARRAY, id, length, elements, properties }
}

function serializeObject(value, forStorage, interfaces, references) {
  const id = references.id(value)

  return {
    type: t.OBJECT,
    id,
    properties: serializeProperties(value, forStorage, interfaces, references)
  }
}

function serializeProperties(value, forStorage, interfaces, references) {
  const keys = Object.keys(value)
  const properties = new Array(keys.length)

  for (let i = 0, n = keys.length; i < n; i++) {
    const key = keys[i]

    // An ordinary object may be keyed by index too, and those keys travel as
    // numbers just as an array's do.
    const index = asIndex(key)

    properties[i] = {
      key: index === -1 ? key : index,
      value: serializeValue(value[key], forStorage, interfaces, references)
    }
  }

  return properties
}

function serializeURL(value, references) {
  return { type: t.URL, id: references.id(value), href: value.href }
}

function serializeBuffer(value, forStorage, interfaces, references) {
  if (value.detached) {
    throw errors.UNSERIALIZABLE_TYPE('Detached Buffer cannot be serialized')
  }

  const serialized = {
    type: t.BUFFER,
    id: references.id(value),
    buffer: null,
    byteOffset: value.byteOffset,
    byteLength: value.byteLength
  }

  serialized.buffer = serializeViewBuffer(
    serialized,
    value.buffer,
    forStorage,
    interfaces,
    references
  )

  return serialized
}

function serializeExternal(value, forStorage) {
  if (forStorage) {
    throw errors.UNSERIALIZABLE_TYPE('External pointer cannot be serialized to storage')
  }

  return {
    type: t.EXTERNAL,
    pointer: binding.getExternal(value)
  }
}

function serializeSerializable(value, serializer, forStorage, interfaces, references) {
  return {
    type: t.SERIALIZABLE,
    id: references.id(value),
    interface: interfaces.id(value.constructor),
    value: serializeValue(serializer.call(value, forStorage), forStorage, interfaces, references)
  }
}

function serializeValueWithTransfer(value, transferList, interfaces) {
  const references = new ReferenceMap()

  for (const transferable of transferList) {
    const type = getType(transferable)

    if (type.isArrayBuffer()) {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE("Detached 'ArrayBuffer' cannot be transferred")
      }

      if (references.has(transferable)) {
        throw errors.ALREADY_TRANSFERRED("'ArrayBuffer' has already been transferred")
      }

      references.id(transferable)
    } else {
      const detach = transferable[kDetach]

      if (detach) {
        if (transferable.detached) {
          throw errors.UNTRANSFERABLE_TYPE(
            `Detached '${transferable.constructor.name}' cannot be transferred`
          )
        }

        if (references.has(transferable)) {
          throw errors.ALREADY_TRANSFERRED(
            `'${transferable.constructor.name}' has already been transferred`
          )
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

      if (transferable.resizable) {
        transfer = {
          type: t.RESIZABLEARRAYBUFFER,
          id,
          backingStore,
          maxByteLength: transferable.maxByteLength
        }
      } else {
        transfer = { type: t.ARRAYBUFFER, id, backingStore }
      }

      transfers.push(transfer)

      binding.detachArrayBuffer(transferable)
    } else {
      if (transferable.detached) {
        throw errors.UNTRANSFERABLE_TYPE(
          `Detached '${transferable.constructor.name}' cannot be transferred`
        )
      }

      const detach = transferable[kDetach]

      const transfer = {
        type: t.TRANSFERABLE,
        id: references.id(transferable),
        interface: interfaces.id(transferable.constructor),
        value: serializeValue(detach.call(transferable), false, interfaces, references)
      }

      transfers.push(transfer)
    }
  }

  finalizeBuffers(references)

  return { type: t.TRANSFER, transfers, value: serialized }
}

function deserializeValue(serialized, interfaces, references) {
  let value

  switch (serialized.type) {
    case t.UNDEFINED:
      return undefined
    case t.NULL:
      return null
    case t.TRUE:
      return true
    case t.FALSE:
      return false

    case t.NUMBER:
    case t.INTEGER:
    case t.BIGINT:
    case t.STRING:
      return serialized.value

    case t.EXTERNAL:
      return binding.createExternal(serialized.pointer)

    case t.DATE:
      value = new Date(serialized.value)
      break

    case t.REGEXP:
      value = new RegExp(serialized.source, serialized.flags)
      break

    case t.ERROR: {
      const options = 'cause' in serialized ? { cause: undefined } : undefined

      switch (serialized.name) {
        case t.error.AGGREGATE:
          value = new AggregateError([], serialized.message, options)
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
        case t.error.URI:
          value = new URIError(serialized.message, options)
          break
        default:
          value = new Error(serialized.message, options)
      }

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
        value = new ArrayBuffer(serialized.data.byteLength, {
          maxByteLength: serialized.maxByteLength
        })

        Buffer.from(value).set(Buffer.from(serialized.data))
      }

      break

    case t.SHAREDARRAYBUFFER:
    case t.GROWABLESHAREDARRAYBUFFER:
      value = binding.createSharedArrayBuffer(serialized.backingStore)
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
        case t.typedarray.FLOAT16ARRAY:
          value = new Float16Array(buffer, serialized.byteOffset, serialized.length)
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
      value = new DataView(
        deserializeValue(serialized.buffer, interfaces, references),
        serialized.byteOffset,
        serialized.byteLength
      )
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

    case t.URL:
      value = new URL(serialized.href)
      break

    case t.BUFFER:
      value = Buffer.from(
        deserializeValue(serialized.buffer, interfaces, references),
        serialized.byteOffset,
        serialized.byteLength
      )
      break

    case t.SERIALIZABLE: {
      const constructor = interfaces.get(serialized.interface)

      const deserialize = constructor[kDeserialize]

      value = deserialize.call(
        constructor,
        deserializeValue(serialized.value, interfaces, references)
      )
      break
    }
  }

  references.set(serialized.id, value)

  switch (serialized.type) {
    case t.ERROR:
      value.stack = deserializeValue(serialized.stack, interfaces, references)

      if ('cause' in serialized) {
        value.cause = deserializeValue(serialized.cause, interfaces, references)
      }

      if (serialized.name === t.error.AGGREGATE) {
        for (const err of serialized.errors) {
          value.errors.push(deserializeValue(err, interfaces, references))
        }
      }
      break

    case t.MAP:
      for (const entry of serialized.data) {
        value.set(
          deserializeValue(entry.key, interfaces, references),
          deserializeValue(entry.value, interfaces, references)
        )
      }
      break

    case t.SET:
      for (const entry of serialized.data) {
        value.add(deserializeValue(entry, interfaces, references))
      }
      break

    case t.ARRAY: {
      const elements = serialized.elements

      if (elements !== null) {
        for (let i = 0, n = elements.length; i < n; i++) {
          value[i] = deserializeValue(elements[i], interfaces, references)
        }
      }

      for (const entry of serialized.properties) {
        value[entry.key] = deserializeValue(entry.value, interfaces, references)
      }
      break
    }

    case t.OBJECT:
      for (const entry of serialized.properties) {
        value[entry.key] = deserializeValue(entry.value, interfaces, references)
      }
      break
  }

  return value
}

function deserializeValueWithTransfer(serialized, interfaces) {
  const references = new Map()

  for (const transfer of serialized.transfers) {
    switch (transfer.type) {
      case t.ARRAYBUFFER:
      case t.RESIZABLEARRAYBUFFER:
        references.set(transfer.id, binding.createArrayBuffer(transfer.backingStore))
        break

      case t.TRANSFERABLE: {
        const constructor = interfaces.get(transfer.interface)

        const attach = constructor[kAttach]

        references.set(
          transfer.id,
          attach.call(constructor, deserializeValue(transfer.value, interfaces, references))
        )
        break
      }
    }
  }

  return deserializeValue(serialized.value, interfaces, references)
}

const header = {
  preencode(state) {
    c.uint.preencode(state, constants.VERSION)
    c.uint.preencode(state, 0) // Flags
  },
  encode(state) {
    c.uint.encode(state, constants.VERSION)
    c.uint.encode(state, 0) // Flags
  },
  decode(state) {
    const version = c.uint.decode(state)

    if (version !== constants.VERSION) {
      throw errors.INVALID_VERSION(`Invalid ABI version '${version}'`)
    }

    c.uint.decode(state) // Flags
  }
}

const propertyKey = {
  preencode(state, m) {
    if (typeof m === 'number') {
      c.uint.preencode(state, t.key.INDEX)
      c.uint.preencode(state, m)
      return
    }

    let names = state[kNames]

    if (names === null) names = state[kNames] = new Map()
    else {
      const reference = names.get(m)

      if (reference !== undefined) {
        c.uint.preencode(state, t.key.NAME_REFERENCE)
        c.uint.preencode(state, reference)
        return
      }
    }

    names.set(m, names.size)

    c.uint.preencode(state, t.key.NAME)
    c.string.preencode(state, m)
  },
  encode(state, m) {
    if (typeof m === 'number') {
      c.uint.encode(state, t.key.INDEX)
      c.uint.encode(state, m)
      return
    }

    let names = state[kNames]

    if (names === null) names = state[kNames] = new Map()
    else {
      const reference = names.get(m)

      if (reference !== undefined) {
        c.uint.encode(state, t.key.NAME_REFERENCE)
        c.uint.encode(state, reference)
        return
      }
    }

    names.set(m, names.size)

    c.uint.encode(state, t.key.NAME)
    c.string.encode(state, m)
  },
  decode(state) {
    const kind = c.uint.decode(state)

    switch (kind) {
      case t.key.INDEX:
        return c.uint.decode(state)

      case t.key.NAME: {
        const name = c.string.decode(state)

        if (state[kNames] === null) state[kNames] = [name]
        else state[kNames].push(name)

        return name
      }

      case t.key.NAME_REFERENCE: {
        const reference = c.uint.decode(state)

        if (state[kNames] === null || reference >= state[kNames].length) {
          throw errors.INVALID_PROPERTY_KEY(`Property name with ID '${reference}' was not found`)
        }

        return state[kNames][reference]
      }

      default:
        throw errors.INVALID_PROPERTY_KEY(`Unknown property key kind '${kind}'`)
    }
  }
}

const property = {
  preencode(state, m) {
    propertyKey.preencode(state, m.key)
    value.preencode(state, m.value)
  },
  encode(state, m) {
    propertyKey.encode(state, m.key)
    value.encode(state, m.value)
  },
  decode(state) {
    return {
      key: propertyKey.decode(state),
      value: value.decode(state)
    }
  }
}

const properties = c.array(property)

const arrayBody = {
  preencode(state, m) {
    if (m.elements === null) {
      c.uint.preencode(state, t.array.SPARSE)
    } else {
      c.uint.preencode(state, t.array.DENSE)

      for (let i = 0, n = m.elements.length; i < n; i++) {
        value.preencode(state, m.elements[i])
      }
    }

    properties.preencode(state, m.properties)
  },
  encode(state, m) {
    if (m.elements === null) {
      c.uint.encode(state, t.array.SPARSE)
    } else {
      c.uint.encode(state, t.array.DENSE)

      for (let i = 0, n = m.elements.length; i < n; i++) {
        value.encode(state, m.elements[i])
      }
    }

    properties.encode(state, m.properties)
  },
  decode(state, length) {
    const layout = c.uint.decode(state)

    if (layout === t.array.SPARSE) {
      return { elements: null, properties: properties.decode(state) }
    }

    if (layout !== t.array.DENSE) {
      throw errors.INVALID_ARRAY_LAYOUT(`Unknown array layout '${layout}'`)
    }

    const elements = new Array(length)

    for (let i = 0; i < length; i++) elements[i] = value.decode(state)

    return { elements, properties: properties.decode(state) }
  }
}

const entry = {
  preencode(state, m) {
    value.preencode(state, m.key)
    value.preencode(state, m.value)
  },
  encode(state, m) {
    value.encode(state, m.key)
    value.encode(state, m.value)
  },
  decode(state) {
    return {
      key: value.decode(state),
      value: value.decode(state)
    }
  }
}

const entries = c.array(entry)

const transfer = {
  preencode(state, m) {
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
  encode(state, m) {
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
  decode(state) {
    const type = c.uint.decode(state)
    const id = c.uint.decode(state)

    switch (type) {
      case t.ARRAYBUFFER:
        return {
          type,
          id,
          backingStore: c.arraybuffer.decode(state)
        }
      case t.RESIZABLEARRAYBUFFER:
        return {
          type,
          id,
          backingStore: c.arraybuffer.decode(state),
          maxByteLength: c.uint.decode(state)
        }
      case t.TRANSFERABLE:
        return {
          type,
          id,
          interface: c.uint.decode(state),
          value: value.decode(state)
        }
    }
  }
}

const transfers = c.array(transfer)

function typeOf(m) {
  if (m.type !== t.NUMBER) return m.type

  const value = m.value

  if (!Number.isInteger(value) || value < -0x80000000 || value > 0x7fffffff) {
    return t.NUMBER
  }

  // Negative zero has to stay a double, as its integer form cannot be told
  // apart from positive zero.
  if (value === 0 && 1 / value < 0) return t.NUMBER

  return t.INTEGER
}

const value = {
  preencode(state, m) {
    const type = typeOf(m)

    c.uint.preencode(state, type)

    switch (type) {
      case t.UNDEFINED:
      case t.NULL:
      case t.TRUE:
      case t.FALSE:
        return
      case t.NUMBER:
        return c.float64.preencode(state, m.value)
      case t.INTEGER:
        return c.int.preencode(state, m.value)
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

    c.uint.preencode(state, m.id)

    switch (m.type) {
      case t.DATE:
        c.int.preencode(state, m.value)
        break
      case t.REGEXP:
        c.string.preencode(state, m.source)
        c.string.preencode(state, m.flags)
        break
      case t.ERROR:
        c.uint.preencode(state, 'cause' in m ? 1 : 0) // Flags
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
        arrayBody.preencode(state, m)
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
  encode(state, m) {
    const type = typeOf(m)

    c.uint.encode(state, type)

    switch (type) {
      case t.UNDEFINED:
      case t.NULL:
      case t.TRUE:
      case t.FALSE:
        return
      case t.NUMBER:
        return c.float64.encode(state, m.value)
      case t.INTEGER:
        return c.int.encode(state, m.value)
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
        c.uint.encode(state, 'cause' in m ? 1 : 0) // Flags
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
        arrayBody.encode(state, m)
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
  decode(state) {
    const type = c.uint.decode(state)

    switch (type) {
      case t.UNDEFINED:
      case t.NULL:
      case t.TRUE:
      case t.FALSE:
        return {
          type
        }
      case t.NUMBER:
        return {
          type,
          value: c.float64.decode(state)
        }
      case t.INTEGER:
        return {
          type: t.NUMBER,
          value: c.int.decode(state)
        }
      case t.BIGINT:
        return {
          type,
          value: c.bigint.decode(state)
        }
      case t.STRING:
        return {
          type,
          value: c.string.decode(state)
        }
      case t.EXTERNAL:
        return {
          type,
          pointer: c.arraybuffer.decode(state)
        }
      case t.TRANSFER:
        return {
          type,
          transfers: transfers.decode(state),
          value: value.decode(state)
        }
    }

    const id = c.uint.decode(state)

    switch (type) {
      case t.DATE:
        return {
          type,
          id,
          value: c.int.decode(state)
        }
      case t.REGEXP:
        return {
          type,
          id,
          source: c.string.decode(state),
          flags: c.string.decode(state)
        }
      case t.ERROR: {
        const flags = c.uint.decode(state)

        const hasCause = (flags & 1) !== 0

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
      case t.ARRAYBUFFER:
        return {
          type,
          id,
          owned: true,
          data: c.arraybuffer.decode(state)
        }
      case t.RESIZABLEARRAYBUFFER:
        return {
          type,
          id,
          owned: true,
          data: c.arraybuffer.decode(state),
          maxByteLength: c.uint.decode(state)
        }
      case t.SHAREDARRAYBUFFER:
        return {
          type,
          id,
          backingStore: c.arraybuffer.decode(state)
        }
      case t.GROWABLESHAREDARRAYBUFFER:
        return {
          type,
          id,
          backingStore: c.arraybuffer.decode(state),
          maxByteLength: c.uint.decode(state)
        }
      case t.TYPEDARRAY:
        return {
          type,
          id,
          view: c.uint.decode(state),
          buffer: value.decode(state),
          byteOffset: c.uint.decode(state),
          byteLength: c.uint.decode(state),
          length: c.uint.decode(state)
        }
      case t.DATAVIEW:
        return {
          type,
          id,
          buffer: value.decode(state),
          byteOffset: c.uint.decode(state),
          byteLength: c.uint.decode(state)
        }
      case t.MAP:
        return {
          type,
          id,
          data: entries.decode(state)
        }
      case t.SET:
        return {
          type,
          id,
          data: values.decode(state)
        }
      case t.ARRAY: {
        const length = c.uint.decode(state)
        const { elements, properties } = arrayBody.decode(state, length)

        return { type, id, length, elements, properties }
      }
      case t.OBJECT:
        return {
          type,
          id,
          properties: properties.decode(state)
        }
      case t.REFERENCE:
        return {
          type,
          id
        }
      case t.URL:
        return {
          type,
          id,
          href: c.string.decode(state)
        }
      case t.BUFFER:
        return {
          type,
          id,
          buffer: value.decode(state),
          byteOffset: c.uint.decode(state),
          byteLength: c.uint.decode(state)
        }
      case t.SERIALIZABLE:
        return {
          type,
          id,
          interface: c.uint.decode(state),
          value: value.decode(state)
        }
    }
  }
}

const values = c.array(value)

exports.preencode = function preencode(state, m) {
  state[kNames] = null
  header.preencode(state)
  value.preencode(state, m)
}

exports.encode = function encode(state, m) {
  state[kNames] = null
  header.encode(state)
  value.encode(state, m)
}

exports.decode = function decode(state) {
  state[kNames] = null
  header.decode(state)
  return value.decode(state)
}
