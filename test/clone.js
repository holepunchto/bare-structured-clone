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

  if (value instanceof URL) {
    t.is(deserialized.href, value.href, 'deserializes as expected')
  } else {
    t.alike(deserialized, value, 'deserializes as expected')
  }
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

test('clone integer boundaries', (t) => {
  for (const value of [
    0,
    1,
    -1,
    127,
    -128,
    255,
    65535,
    2147483647,
    -2147483648,
    2147483648,
    -2147483649,
    4294967295,
    Number.MAX_SAFE_INTEGER,
    -Number.MAX_SAFE_INTEGER
  ]) {
    const cloned = deserialize(
      c.decode(structuredClone, c.encode(structuredClone, serialize(value)))
    )
    t.is(cloned, value, `${value} round trips`)
  }

  const negativeZero = deserialize(
    c.decode(structuredClone, c.encode(structuredClone, serialize(-0)))
  )

  t.ok(Object.is(negativeZero, -0), 'negative zero stays negative')
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

test('clone error restores its cause', (t) => {
  const cloned = structuredClone(new Error('outer', { cause: new TypeError('inner') }))

  t.ok(cloned.cause instanceof TypeError, 'cause is a type error')
  t.is(cloned.cause && cloned.cause.message, 'inner', 'cause carries its message')
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
    t.ok(serialized.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

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
    t.ok(serialized.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

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

test('clone uint8array backed by sharedarraybuffer', (t) => {
  const buf = new Uint8Array(new SharedArrayBuffer(4))

  buf.set([1, 2, 3, 4])

  clone(t, buf, (serialized) => {
    t.ok(serialized.buffer.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.TYPEDARRAY,
      id: 1,
      view: type.typedarray.UINT8ARRAY,
      buffer: {
        type: type.SHAREDARRAYBUFFER,
        id: 2,
        backingStore: serialized.buffer.backingStore
      },
      byteOffset: 0,
      byteLength: 4,
      length: 4
    }
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
    elements: [
      {
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
      },
      {
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
    ],
    properties: []
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

test('clone dataview keeps its identity', (t) => {
  const view = new DataView(new ArrayBuffer(8))

  const cloned = structuredClone({ a: view, b: view })

  t.ok(cloned.a instanceof DataView, 'clones as a dataview')
  t.is(cloned.a, cloned.b, 'both properties resolve to the same dataview')
})

test('clone distinct dataviews get distinct references', (t) => {
  const a = new DataView(new ArrayBuffer(8))
  const b = new DataView(new ArrayBuffer(8))

  const serialized = serialize({ a, b })

  const [first, second] = serialized.properties

  t.not(first.value.id, second.value.id, 'ids are distinct')
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
    elements: [
      { type: type.NUMBER, value: 42 },
      { type: type.STRING, value: 'hello' },
      { type: type.TRUE }
    ],
    properties: []
  })
})

test('clone circular array', (t) => {
  const arr = []
  arr[0] = arr

  clone(t, arr, {
    type: type.ARRAY,
    id: 1,
    length: 1,
    elements: [{ type: type.REFERENCE, id: 1 }],
    properties: []
  })
})

test('clone array with additional property', (t) => {
  const arr = [42, 'hello', true]
  arr.foo = 'bar'

  clone(t, arr, {
    type: type.ARRAY,
    id: 1,
    length: 3,
    elements: [
      { type: type.NUMBER, value: 42 },
      { type: type.STRING, value: 'hello' },
      { type: type.TRUE }
    ],
    properties: [{ key: 'foo', value: { type: type.STRING, value: 'bar' } }]
  })
})

test('clone dense array keeps named properties apart', (t) => {
  const arr = ['a', 'b']
  arr.tag = 'c'

  const serialized = serialize(arr)

  t.is(serialized.elements.length, 2, 'elements hold the indices')
  t.alike(
    serialized.properties.map((p) => p.key),
    ['tag'],
    'properties hold only the names'
  )

  const cloned = deserialize(c.decode(structuredClone, c.encode(structuredClone, serialized)))

  t.alike([cloned[0], cloned[1], cloned.tag], ['a', 'b', 'c'], 'both survive')
})

test('clone sparse array keeps its holes', (t) => {
  const arr = new Array(6)
  arr[1] = 'a'
  arr[4] = 'b'

  const serialized = serialize(arr)

  t.alike(
    serialized.properties.map((p) => p.key),
    [1, 4],
    'only present indices are serialized'
  )

  const cloned = deserialize(c.decode(structuredClone, c.encode(structuredClone, serialized)))

  t.is(cloned.length, 6, 'length survives')
  t.absent(0 in cloned, 'hole survives')
  t.is(cloned[1], 'a', 'first element survives')
  t.is(cloned[4], 'b', 'second element survives')
})

test('clone sparse array has no elements', (t) => {
  const arr = new Array(4)
  arr[1] = 'a'
  arr.tag = 'b'

  const serialized = serialize(arr)

  t.is(serialized.elements, null, 'sparse arrays carry no elements')
  t.alike(
    serialized.properties.map((p) => p.key),
    [1, 'tag'],
    'indices stay with the properties'
  )
})

test('clone array with non canonical numeric properties', (t) => {
  const arr = [1]

  arr['01'] = 'a'
  arr['1e2'] = 'b'
  arr['1.5'] = 'c'
  arr['-1'] = 'd'
  arr['4294967295'] = 'e'

  const serialized = serialize(arr)

  t.is(serialized.elements.length, 1, 'the sole index is an element')

  const keys = serialized.properties.map((p) => p.key)

  t.alike(keys, ['01', '1e2', '1.5', '-1', '4294967295'], 'the rest stay names')

  const cloned = deserialize(c.decode(structuredClone, c.encode(structuredClone, serialized)))

  t.is(cloned[0], 1, 'index survives')
  t.is(cloned['01'], 'a', 'leading zero survives')
  t.is(cloned['1e2'], 'b', 'exponent survives')
  t.is(cloned['1.5'], 'c', 'fraction survives')
  t.is(cloned['-1'], 'd', 'negative survives')
  t.is(cloned['4294967295'], 'e', 'out of range index survives')
})

test('clone array with large index', (t) => {
  const arr = []
  arr[70000] = 'a'

  const cloned = structuredClone(arr)

  t.is(cloned.length, 70001, 'length survives')
  t.is(cloned[70000], 'a', 'element survives')
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

test('clone object keyed by index', (t) => {
  const cloned = structuredClone({ 2: 'a', b: 'c', 0: 'd' })

  t.alike(Object.keys(cloned), ['0', '2', 'b'], 'key order survives')
  t.alike(cloned, { 0: 'd', 2: 'a', b: 'c' }, 'values survive')
})

test('clone url', (t) => {
  clone(t, new URL('https://example.org'), {
    type: type.URL,
    id: 1,
    href: 'https://example.org/'
  })
})

test('clone url repeated in a graph', (t) => {
  const url = new URL('https://example.org/a?b=c#d')

  const cloned = structuredClone({ a: url, b: url })

  t.is(cloned.a.href, 'https://example.org/a?b=c#d', 'url round trips')
  t.is(cloned.a, cloned.b, 'both properties resolve to the same url')
})

test('clone buffer', (t) => {
  const buf = Buffer.from([1, 2, 3, 4])

  // A buffer may be a view into a larger pooled arraybuffer, in which case only
  // the bytes it spans are carried and it starts at the beginning of them.
  clone(t, buf, (serialized) => {
    t.is(serialized.buffer.data.byteLength, 4, 'carries only its own bytes')

    return {
      type: type.BUFFER,
      id: 1,
      buffer: {
        type: type.ARRAYBUFFER,
        id: 2,
        owned: false,
        data: serialized.buffer.data
      },
      byteOffset: 0,
      byteLength: 4
    }
  })
})

test('clone view onto a larger buffer copies out its bytes', (t) => {
  // The bytes outside the view belong to whatever else shares the buffer, and a
  // pool is shared with unrelated data, so they must not travel with the clone.
  const backing = new ArrayBuffer(64)

  new Uint8Array(backing).fill(0xaa)

  const view = new Uint8Array(backing, 16, 4)

  view.set([1, 2, 3, 4])

  const serialized = serialize(view)

  t.is(serialized.buffer.data.byteLength, 4, 'carries only the viewed bytes')
  t.is(serialized.byteOffset, 0, 'the view starts at the beginning of them')
  t.absent(
    Array.from(new Uint8Array(serialized.buffer.data)).includes(0xaa),
    'none of the surrounding bytes travel with it'
  )

  const cloned = deserialize(c.decode(structuredClone, c.encode(structuredClone, serialized)))

  t.alike(Array.from(cloned), [1, 2, 3, 4], 'the viewed bytes survive')
  t.is(cloned.buffer.byteLength, 4, 'the clone owns a buffer of its own size')
})

test('clone views covering a buffer stay aliased', (t) => {
  // Between them these two cover the buffer, so nothing is hidden by sharing it
  // and the aliasing is worth keeping.
  const backing = new ArrayBuffer(8)

  const a = new Uint8Array(backing, 0, 4)
  const b = new Uint8Array(backing, 4, 4)

  const serialized = serialize({ a, b })

  t.is(serialized.properties[0].value.buffer.type, type.ARRAYBUFFER, 'the first carries the buffer')
  t.is(serialized.properties[1].value.buffer.type, type.REFERENCE, 'the second refers to it')

  const cloned = structuredClone({ a, b })

  t.is(cloned.a.buffer, cloned.b.buffer, 'both views share one buffer')
  t.is(cloned.a.buffer.byteLength, 8, 'the whole buffer is carried')
})

test('clone views leaving a gap are copied apart', (t) => {
  const backing = new ArrayBuffer(12)

  new Uint8Array(backing).fill(0xbb)

  const a = new Uint8Array(backing, 0, 4)
  const b = new Uint8Array(backing, 8, 4)

  const cloned = structuredClone({ a, b })

  t.not(cloned.a.buffer, cloned.b.buffer, 'each view gets a buffer of its own')
  t.is(cloned.a.buffer.byteLength, 4, 'sized to the first view')
  t.is(cloned.b.buffer.byteLength, 4, 'sized to the second view')
})

test('clone buffer the value carries itself is kept whole', (t) => {
  // The arraybuffer is part of the message in its own right, so nothing is being
  // hidden and the view stays aliased to it.
  const backing = new ArrayBuffer(16)

  const view = new Uint8Array(backing, 4, 4)

  const cloned = structuredClone({ backing, view })

  t.is(cloned.backing.byteLength, 16, 'the buffer is carried whole')
  t.is(cloned.view.buffer, cloned.backing, 'the view still points at it')
  t.is(cloned.view.byteOffset, 4, 'at its original offset')
})

test('clone dataview onto a larger buffer copies out its bytes', (t) => {
  const backing = new ArrayBuffer(32)

  new Uint8Array(backing).fill(0xcc)

  const cloned = structuredClone(new DataView(backing, 8, 4))

  t.is(cloned.byteLength, 4, 'byte length survives')
  t.is(cloned.byteOffset, 0, 'rebased to the beginning')
  t.is(cloned.buffer.byteLength, 4, 'the clone owns a buffer of its own size')
})

test('clone buffer, unpooled', (t) => {
  const buf = Buffer.alloc(4)

  buf.set([1, 2, 3, 4])

  clone(t, buf, {
    type: type.BUFFER,
    id: 1,
    buffer: {
      type: type.ARRAYBUFFER,
      id: 2,
      owned: false,
      data: buf.buffer
    },
    byteOffset: buf.byteOffset,
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

// The tests below cover the encoding itself rather than the cloning of any
// one type: what the wire format spends bytes on, and what it rejects.

test('encode integer is smaller than a double', (t) => {
  const integers = c.encode(structuredClone, serialize([1, 2, 3, 4, 5])).byteLength
  const doubles = c.encode(structuredClone, serialize([1.5, 2.5, 3.5, 4.5, 5.5])).byteLength

  t.ok(integers < doubles, `integers ${integers} bytes, doubles ${doubles} bytes`)
})

test('encode dense array omits its indices', (t) => {
  // Both arrays carry four elements. The dense one recovers their indices from
  // their positions, while the sparse one has to write every index out.
  const dense = [1, 2, 3, 4]

  const sparse = new Array(5)
  sparse[0] = 1
  sparse[1] = 2
  sparse[2] = 3
  sparse[4] = 4

  const denseBytes = c.encode(structuredClone, serialize(dense)).byteLength
  const sparseBytes = c.encode(structuredClone, serialize(sparse)).byteLength

  t.ok(denseBytes < sparseBytes, `dense ${denseBytes} bytes, sparse ${sparseBytes} bytes`)

  const cloned = deserialize(
    c.decode(structuredClone, c.encode(structuredClone, serialize(sparse)))
  )

  t.is(cloned.length, 5, 'length survives')
  t.absent(3 in cloned, 'hole survives')
  t.alike([cloned[0], cloned[1], cloned[2], cloned[4]], [1, 2, 3, 4], 'elements survive')
})

test('encode repeated property names once', (t) => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ alpha: i, beta: 'b', gamma: true }))

  const many = c.encode(structuredClone, serialize(rows)).byteLength
  const one = c.encode(structuredClone, serialize([rows[0]])).byteLength

  t.ok(many < one * 20, `one row ${one} bytes, forty rows ${many} bytes`)

  const cloned = deserialize(c.decode(structuredClone, c.encode(structuredClone, serialize(rows))))

  t.alike(Object.keys(cloned[39]), ['alpha', 'beta', 'gamma'], 'names survive')
  t.alike(cloned[39], { alpha: 39, beta: 'b', gamma: true }, 'values survive')
})

test('encode graph with more than 252 references', (t) => {
  const value = Array.from({ length: 300 }, (_, i) => ({ i }))

  const serialized = serialize(value)

  const state = { start: 0, end: 0, buffer: null }
  structuredClone.preencode(state, serialized)

  const size = state.end

  const buffer = c.encode(structuredClone, serialized)

  t.is(buffer.byteLength, size, 'encodes exactly as many bytes as reserved')

  const decoded = deserialize(c.decode(structuredClone, buffer))

  t.is(decoded.length, 300, 'decodes every entry')
  t.alike(decoded[299], { i: 299 }, 'last entry survives')
})

test('decode rejects an unknown property key kind', (t) => {
  const serialized = serialize({ a: 1 })

  const buffer = c.encode(structuredClone, serialized)

  const state = { start: 0, end: buffer.byteLength, buffer }
  c.uint.decode(state) // Version
  c.uint.decode(state) // Flags
  c.uint.decode(state) // Type
  c.uint.decode(state) // Id
  c.uint.decode(state) // Property count

  buffer[state.start] = 0

  try {
    c.decode(structuredClone, buffer)
    t.fail('expected decode to throw')
  } catch (err) {
    t.is(err.code, 'INVALID_PROPERTY_KEY', 'throws for an unknown kind')
  }
})

test('decode rejects an unknown array layout', (t) => {
  const buffer = c.encode(structuredClone, serialize([1, 2]))

  const state = { start: 0, end: buffer.byteLength, buffer }
  c.uint.decode(state)
  c.uint.decode(state)
  c.uint.decode(state)
  c.uint.decode(state)
  c.uint.decode(state)

  buffer[state.start] = 0

  try {
    c.decode(structuredClone, buffer)
    t.fail('expected decode to throw')
  } catch (err) {
    t.is(err.code, 'INVALID_ARRAY_LAYOUT', 'throws for an unknown layout')
  }
})

test('decode rejects a dangling property name reference', (t) => {
  const buffer = c.encode(structuredClone, serialize({ a: 1 }))

  const state = { start: 0, end: buffer.byteLength, buffer }
  c.uint.decode(state)
  c.uint.decode(state)
  c.uint.decode(state)
  c.uint.decode(state)
  c.uint.decode(state)

  buffer[state.start] = structuredClone.constants.type.key.NAME_REFERENCE

  try {
    c.decode(structuredClone, buffer)
    t.fail('expected decode to throw')
  } catch (err) {
    t.is(err.code, 'INVALID_PROPERTY_KEY', 'throws for a dangling reference')
  }
})

test('decode rejects a mismatched abi version', (t) => {
  const buffer = c.encode(structuredClone, serialize({ a: 1 }))

  buffer[0] = 0

  try {
    c.decode(structuredClone, buffer)
    t.fail('expected decode to throw')
  } catch (err) {
    t.is(err.code, 'INVALID_VERSION', 'throws for an older version')
  }
})
