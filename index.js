const c = require('compact-encoding')
const bitfield = require('compact-encoding-bitfield')
const constants = require('./lib/constants')
const errors = require('./lib/errors')

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

    case 'symbol': throw errors.UNSUPPORTED_TYPE(`Symbol '${value.description}' cannot be serialized`)

    case 'function': throw errors.UNSUPPORTED_TYPE(`Function '${value.name}' cannot be serialized`)
  }

  if (value instanceof Date) {
    return { type: t.DATE, value: value.getTime() }
  }

  if (value instanceof RegExp) {
    return { type: t.REGEXP, source: value.source, flags: value.flags }
  }

  let serialized

  if (value instanceof Map) {
    serialized = { type: t.MAP, id: 0, data: [] }
  } else if (value instanceof Set) {
    serialized = { type: t.SET, id: 0, data: [] }
  } else if (value instanceof Error) {
    let name

    switch (value.name) {
      case 'EvalError':
      case 'RangeError':
      case 'ReferenceError':
      case 'SyntaxError':
      case 'TypeError':
        name = value.name
        break
      default:
        name = 'Error'
    }

    serialized = { type: t.ERROR, name, message: value.message.toString(), stack: null }

    if (value.stack) {
      serialized.stack = serialize(value.stack, forStorage, references)
    }

    return serialized
  } else if (
    value instanceof Promise ||
    value instanceof WeakMap ||
    value instanceof WeakSet ||
    value instanceof WeakRef
  ) {
    throw errors.UNSUPPORTED_TYPE(`${value.constructor.name} cannot be serialized`)
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

    case t.MAP:
      value = new Map()
      break
    case t.SET:
      value = new Set()
      break

    case t.ERROR:
      switch (serialized.name) {
        case 'EvalError':
          value = new EvalError(serialized.message)
          break
        case 'RangeError':
          value = new RangeError(serialized.message)
          break
        case 'ReferenceError':
          value = new ReferenceError(serialized.message)
          break
        case 'SyntaxError':
          value = new SyntaxError(serialized.message)
          break
        case 'TypeError':
          value = new TypeError(serialized.message)
          break
        default:
          value = new Error(serialized.message)
      }

      if (serialized.stack !== null) {
        value.stack = deserialize(serialized.stack, references)
      }

      return value

    case t.ARRAY:
      value = new Array(serialized.length)
      break
    case t.OBJECT:
      value = {}
      break
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
}

// https://html.spec.whatwg.org/multipage/structured-data.html#structureddeserializewithtransfer
exports.deserializeWithTransfer = function deserializeWithTransfer (serialized) {

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
