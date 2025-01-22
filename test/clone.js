const test = require('brittle')
const c = require('compact-encoding')
const structuredClone = require('..')

const {
  constants: { type },
  symbols,
  serialize,
  deserialize
} = structuredClone

function clone(t, value, interfaces, expected) {
  if (!Array.isArray(interfaces)) {
    expected = interfaces
    interfaces = []
  }

  t.comment(value)

  let serialized = serialize(value, false, interfaces)
  t.alike(
    serialized,
    typeof expected === 'function' ? expected(serialized) : expected,
    'serializes as expected'
  )

  const buffer = c.encode(structuredClone, serialized)
  t.ok(buffer instanceof Buffer, 'encodes to a buffer')

  serialized = c.decode(structuredClone, buffer)
  t.ok(serialized, 'decodes from a buffer')

  const deserialized = deserialize(serialized, interfaces)

  t.alike(deserialized, value, 'deserializes as expected')
}

test('clone undefined', (t) => {
  clone(t, undefined, { type: type.UNDEFINED })
})

test('clone null', (t) => {
  clone(t, null, { type: type.NULL })
})

test('clone boolean', (t) => {
  clone(t, true, { type: type.TRUE })
  clone(t, false, { type: type.FALSE })
})

test('clone number', (t) => {
  clone(t, 1234, { type: type.NUMBER, value: 1234 })
  clone(t, -1234, { type: type.NUMBER, value: -1234 })

  clone(t, 0, { type: type.NUMBER, value: 0 })
  clone(t, -0, { type: type.NUMBER, value: -0 })

  clone(t, Math.PI, { type: type.NUMBER, value: Math.PI })
  clone(t, -Math.PI, { type: type.NUMBER, value: -Math.PI })

  clone(t, NaN, { type: type.NUMBER, value: NaN })

  clone(t, Infinity, { type: type.NUMBER, value: Infinity })
  clone(t, -Infinity, { type: type.NUMBER, value: -Infinity })
})

test('clone bigint', (t) => {
  clone(t, 1234n, { type: type.BIGINT, value: 1234n })
  clone(t, -1234n, { type: type.BIGINT, value: -1234n })

  clone(t, 0n, { type: type.BIGINT, value: 0n })

  clone(t, 2n ** 64n, { type: type.BIGINT, value: 2n ** 64n })
  clone(t, -(2n ** 64n), { type: type.BIGINT, value: -(2n ** 64n) })

  clone(t, 2n ** 128n, { type: type.BIGINT, value: 2n ** 128n })
  clone(t, -(2n ** 128n), { type: type.BIGINT, value: -(2n ** 128n) })
})

test('clone string', (t) => {
  clone(t, 'hello world', { type: type.STRING, value: 'hello world' })
})

test('clone date', (t) => {
  clone(t, new Date(123456789), { type: type.DATE, id: 1, value: 123456789 })
  clone(t, new Date(-123456789), { type: type.DATE, id: 1, value: -123456789 })
})

test('clone regexp', (t) => {
  clone(t, /he(ll)o [world]+/, {
    type: type.REGEXP,
    id: 1,
    source: 'he(ll)o [world]+',
    flags: ''
  })
  clone(t, /he(ll)o [world]+/gi, {
    type: type.REGEXP,
    id: 1,
    source: 'he(ll)o [world]+',
    flags: 'gi'
  })
})

test('clone error', (t) => {
  const err = new Error('err')
  err.stack = `${err.name}: ${err.message}\n    at file:///foo/bar.js`

  clone(t, err, {
    type: type.ERROR,
    id: 1,
    name: 0,
    message: 'err',
    stack: {
      type: type.STRING,
      value: err.stack
    }
  })
})

test('clone error with cause', (t) => {
  const err = new Error('err', { cause: 'err cause' })
  err.stack = `${err.name}: ${err.message}\n    at file:///foo/bar.js`

  clone(t, err, {
    type: type.ERROR,
    id: 1,
    name: 0,
    message: 'err',
    stack: {
      type: type.STRING,
      value: err.stack
    },
    cause: {
      type: type.STRING,
      value: 'err cause'
    }
  })
})

test('clone type error', (t) => {
  const err = new TypeError('err')
  err.stack = `${err.name}: ${err.message}\n    at file:///foo/bar.js`

  clone(t, err, {
    type: type.ERROR,
    id: 1,
    name: type.error.TYPE,
    message: 'err',
    stack: {
      type: type.STRING,
      value: err.stack
    }
  })
})

test('clone type error with cause', (t) => {
  const err = new TypeError('err', { cause: 'err cause' })
  err.stack = `${err.name}: ${err.message}\n    at file:///foo/bar.js`

  clone(t, err, {
    type: type.ERROR,
    id: 1,
    name: type.error.TYPE,
    message: 'err',
    stack: {
      type: type.STRING,
      value: err.stack
    },
    cause: {
      type: type.STRING,
      value: 'err cause'
    }
  })
})

test('clone aggregate error', (t) => {
  const err = new Error('err')
  err.stack = `${err.name}: ${err.message}\n    at file:///foo/bar.js`

  const aggregateErr = new AggregateError([err], 'aggregate err')
  aggregateErr.stack = `${aggregateErr.name}: ${aggregateErr.message}\n    at file:///foo/bar.js`

  clone(t, aggregateErr, {
    type: type.ERROR,
    id: 1,
    name: type.error.AGGREGATE,
    message: 'aggregate err',
    stack: {
      type: type.STRING,
      value: aggregateErr.stack
    },
    errors: [
      {
        type: type.ERROR,
        id: 2,
        name: 0,
        message: 'err',
        stack: {
          type: type.STRING,
          value: err.stack
        }
      }
    ]
  })
})

test('clone aggregate error with cause', (t) => {
  const err = new Error('err')
  err.stack = `${err.name}: ${err.message}\n    at file:///foo/bar.js`

  const aggregateErr = new AggregateError([err], 'aggregate err', {
    cause: 'err cause'
  })
  aggregateErr.stack = `${aggregateErr.name}: ${aggregateErr.message}\n    at file:///foo/bar.js`

  clone(t, aggregateErr, {
    type: type.ERROR,
    id: 1,
    name: type.error.AGGREGATE,
    message: 'aggregate err',
    stack: {
      type: type.STRING,
      value: aggregateErr.stack
    },
    cause: {
      type: type.STRING,
      value: 'err cause'
    },
    errors: [
      {
        type: type.ERROR,
        id: 2,
        name: 0,
        message: 'err',
        stack: {
          type: type.STRING,
          value: err.stack
        }
      }
    ]
  })
})

test('clone arraybuffer', (t) => {
  const buf = new ArrayBuffer(4)

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, {
    type: type.ARRAYBUFFER,
    id: 1,
    owned: false,
    data: buf
  })
})

test('clone resizable arraybuffer', (t) => {
  const buf = new ArrayBuffer(4, { maxByteLength: 8 })

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, {
    type: type.RESIZABLEARRAYBUFFER,
    id: 1,
    owned: false,
    data: buf,
    maxByteLength: 8
  })
})

test('clone sharedarraybuffer', (t) => {
  const buf = new SharedArrayBuffer(4)

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, (serialized) => {
    t.ok(
      serialized.backingStore instanceof ArrayBuffer,
      'backing store is a buffer'
    )

    return {
      type: type.SHAREDARRAYBUFFER,
      id: 1,
      backingStore: serialized.backingStore
    }
  })
})

test('clone growable sharedarraybuffer', (t) => {
  const buf = new SharedArrayBuffer(4, { maxByteLength: 8 })

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, (serialized) => {
    t.ok(
      serialized.backingStore instanceof ArrayBuffer,
      'backing store is a buffer'
    )

    return {
      type: type.GROWABLESHAREDARRAYBUFFER,
      id: 1,
      backingStore: serialized.backingStore,
      maxByteLength: 8
    }
  })
})

test('clone uint8array', (t) => {
  const buf = Uint8Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    id: 1,
    view: type.typedarray.UINT8ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4,
    length: 4
  })
})

test('clone multiple uint8arrays backed by same buffer', (t) => {
  const buf = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])

  const a = new Uint8Array(buf.buffer, 0, 4)
  const b = new Uint8Array(buf.buffer, 4, 4)

  clone(t, [a, b], {
    type: type.ARRAY,
    id: 1,
    length: 2,
    properties: [
      {
        key: '0',
        value: {
          type: type.TYPEDARRAY,
          id: 2,
          view: type.typedarray.UINT8ARRAY,
          buffer: {
            type: type.ARRAYBUFFER,
            id: 3,
            owned: false,
            data: buf.buffer
          },
          byteOffset: 0,
          byteLength: 4,
          length: 4
        }
      },
      {
        key: '1',
        value: {
          type: type.TYPEDARRAY,
          id: 4,
          view: type.typedarray.UINT8ARRAY,
          buffer: {
            type: type.REFERENCE,
            id: 3
          },
          byteOffset: 4,
          byteLength: 4,
          length: 4
        }
      }
    ]
  })
})

test('clone int8array', (t) => {
  const buf = Int8Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    id: 1,
    view: type.typedarray.INT8ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4,
    length: 4
  })
})

test('clone uint16array', (t) => {
  const buf = Uint16Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    id: 1,
    view: type.typedarray.UINT16ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 8,
    length: 4
  })
})

test('clone int16array', (t) => {
  const buf = Int16Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    id: 1,
    view: type.typedarray.INT16ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 8,
    length: 4
  })
})

test('clone dataview', (t) => {
  const buf = new DataView(new ArrayBuffer(4))

  clone(t, buf, {
    type: type.DATAVIEW,
    id: 1,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4
  })
})

test('clone map', (t) => {
  clone(
    t,
    new Map([
      ['foo', 42],
      [1, true]
    ]),
    {
      type: type.MAP,
      id: 1,
      data: [
        {
          key: { type: type.STRING, value: 'foo' },
          value: { type: type.NUMBER, value: 42 }
        },
        {
          key: { type: type.NUMBER, value: 1 },
          value: { type: type.TRUE }
        }
      ]
    }
  )
})

test('clone circular map', (t) => {
  const map = new Map()
  map.set('self', map)

  clone(t, map, {
    type: type.MAP,
    id: 1,
    data: [
      {
        key: { type: type.STRING, value: 'self' },
        value: { type: type.REFERENCE, id: 1 }
      }
    ]
  })
})

test('clone set', (t) => {
  clone(t, new Set(['foo', 42, true]), {
    type: type.SET,
    id: 1,
    data: [
      { type: type.STRING, value: 'foo' },
      { type: type.NUMBER, value: 42 },
      { type: type.TRUE }
    ]
  })
})

test('clone circular set', (t) => {
  const set = new Set()
  set.add(set)

  clone(t, set, {
    type: type.SET,
    id: 1,
    data: [{ type: type.REFERENCE, id: 1 }]
  })
})

test('clone array', (t) => {
  clone(t, [42, 'hello', true], {
    type: type.ARRAY,
    id: 1,
    length: 3,
    properties: [
      { key: '0', value: { type: type.NUMBER, value: 42 } },
      { key: '1', value: { type: type.STRING, value: 'hello' } },
      { key: '2', value: { type: type.TRUE } }
    ]
  })
})

test('clone circular array', (t) => {
  const arr = []
  arr[0] = arr

  clone(t, arr, {
    type: type.ARRAY,
    id: 1,
    length: 1,
    properties: [{ key: '0', value: { type: type.REFERENCE, id: 1 } }]
  })
})

test('clone array with additional property', (t) => {
  const arr = [42, 'hello', true]
  arr.foo = 'bar'

  clone(t, arr, {
    type: type.ARRAY,
    id: 1,
    length: 3,
    properties: [
      { key: '0', value: { type: type.NUMBER, value: 42 } },
      { key: '1', value: { type: type.STRING, value: 'hello' } },
      { key: '2', value: { type: type.TRUE } },
      { key: 'foo', value: { type: type.STRING, value: 'bar' } }
    ]
  })
})

test('clone object', (t) => {
  clone(
    t,
    { foo: 42, bar: 'hello', baz: true },
    {
      type: type.OBJECT,
      id: 1,
      properties: [
        { key: 'foo', value: { type: type.NUMBER, value: 42 } },
        { key: 'bar', value: { type: type.STRING, value: 'hello' } },
        { key: 'baz', value: { type: type.TRUE } }
      ]
    }
  )
})

test('clone circular object', (t) => {
  const obj = {}
  obj.self = obj

  clone(t, obj, {
    type: type.OBJECT,
    id: 1,
    properties: [{ key: 'self', value: { type: type.REFERENCE, id: 1 } }]
  })
})

test('clone url', (t) => {
  clone(t, new URL('https://example.org'), {
    type: type.URL,
    id: 1,
    href: 'https://example.org/'
  })
})

test('clone buffer', (t) => {
  const buf = Buffer.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.BUFFER,
    id: 1,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4
  })
})

test('clone serializable', (t) => {
  class Foo {
    constructor() {
      this.foo = 'foo'
    }

    [symbols.serialize]() {
      return this.foo
    }

    static [symbols.deserialize](serialized) {
      t.is(serialized, 'foo')

      return new Foo()
    }
  }

  const foo = new Foo()

  clone(t, foo, [Foo], {
    type: type.SERIALIZABLE,
    id: 1,
    interface: 1,
    value: {
      type: type.STRING,
      value: 'foo'
    }
  })
})

test('clone serializable, unregistered', (t) => {
  class Foo {
    [symbols.serialize]() {}
  }

  try {
    serialize(new Foo())
    t.fail()
  } catch (err) {
    t.comment(err.message)
  }
})
