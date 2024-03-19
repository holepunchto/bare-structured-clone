const test = require('brittle')
const c = require('compact-encoding')
const structuredClone = require('.')

const {
  constants: { type },
  serialize,
  serializeWithTransfer,
  deserialize,
  deserializeWithTransfer
} = structuredClone

function clone (t, value, expected) {
  const serialized = serialize(value)
  t.alike.coercively(serialized, typeof expected === 'function' ? expected(serialized) : expected, 'serializes as expected')

  const deserialized = deserialize(serialized)
  t.alike(deserialized, value, 'deserializes as expected')

  const buffer = c.encode(structuredClone, serialize(value))
  t.ok(buffer instanceof Buffer, 'encodes to a buffer')

  t.alike(deserialize(c.decode(structuredClone, buffer)), value, 'decodes from a buffer')
}

test('undefined', (t) => {
  clone(t, undefined, { type: type.UNDEFINED })
})

test('null', (t) => {
  clone(t, null, { type: type.NULL })
})

test('true', (t) => {
  clone(t, true, { type: type.TRUE })
})

test('false', (t) => {
  clone(t, false, { type: type.FALSE })
})

test('array', (t) => {
  clone(t, [42, 'hello', true], {
    type: type.ARRAY,
    id: 0,
    length: 3,
    properties: [
      { key: '0', value: { type: type.NUMBER, value: 42 } },
      { key: '1', value: { type: type.STRING, value: 'hello' } },
      { key: '2', value: { type: type.TRUE } }
    ]
  }
  )
})

test('circular array', (t) => {
  const arr = []
  arr[0] = arr

  clone(t, arr, {
    type: type.ARRAY,
    id: 1,
    length: 1,
    properties: [
      { key: '0', value: { type: type.REFERENCE, id: 1 } }
    ]
  })
})

test('object', (t) => {
  clone(t, { foo: 42, bar: 'hello', baz: true }, {
    type: type.OBJECT,
    id: 0,
    properties: [
      { key: 'foo', value: { type: type.NUMBER, value: 42 } },
      { key: 'bar', value: { type: type.STRING, value: 'hello' } },
      { key: 'baz', value: { type: type.TRUE } }
    ]
  })
})

test('circular object', (t) => {
  const obj = {}
  obj.self = obj

  clone(t, obj, {
    type: type.OBJECT,
    id: 1,
    properties: [
      { key: 'self', value: { type: type.REFERENCE, id: 1 } }
    ]
  })
})

test('map', (t) => {
  clone(t, new Map([['foo', 42], [1, true]]), {
    type: type.MAP,
    id: 0,
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
  })
})

test('circular map', (t) => {
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

test('set', (t) => {
  clone(t, new Set(['foo', 42, true]), {
    type: type.SET,
    id: 0,
    data: [
      { type: type.STRING, value: 'foo' },
      { type: type.NUMBER, value: 42 },
      { type: type.TRUE }
    ]
  })
})

test('circular set', (t) => {
  const set = new Set()
  set.add(set)

  clone(t, set, {
    type: type.SET,
    id: 1,
    data: [
      { type: type.REFERENCE, id: 1 }
    ]
  })
})

test('buffer', (t) => {
  const buf = Buffer.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.BUFFER,
    buffer: {
      type: type.ARRAYBUFFER,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4
  })
})

test('arraybuffer', (t) => {
  const buf = new ArrayBuffer(4)

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, {
    type: type.ARRAYBUFFER,
    owned: false,
    data: buf
  })
})

test('resizable arraybuffer', (t) => {
  const buf = new ArrayBuffer(4, { maxByteLength: 8 })

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, {
    type: type.RESIZABLEARRAYBUFFER,
    owned: false,
    data: buf,
    maxByteLength: 8
  })
})

test('sharedarraybuffer', (t) => {
  const buf = new SharedArrayBuffer(4)

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, (serialized) => {
    t.ok(serialized.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.SHAREDARRAYBUFFER,
      backingStore: serialized.backingStore
    }
  })
})

test('growable sharedarraybuffer', (t) => {
  const buf = new SharedArrayBuffer(4, { maxByteLength: 8 })

  Buffer.from(buf).set([1, 2, 3, 4])

  clone(t, buf, (serialized) => {
    t.ok(serialized.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.GROWABLESHAREDARRAYBUFFER,
      backingStore: serialized.backingStore,
      maxByteLength: 8
    }
  })
})

test('uint8array', (t) => {
  const buf = Uint8Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    view: type.typedarray.UINT8ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4,
    length: 4
  })
})

test('int8array', (t) => {
  const buf = Int8Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    view: type.typedarray.INT8ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4,
    length: 4
  })
})

test('uint16array', (t) => {
  const buf = Uint16Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    view: type.typedarray.UINT16ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 8,
    length: 4
  })
})

test('int16array', (t) => {
  const buf = Int16Array.from([1, 2, 3, 4])

  clone(t, buf, {
    type: type.TYPEDARRAY,
    view: type.typedarray.INT16ARRAY,
    buffer: {
      type: type.ARRAYBUFFER,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 8,
    length: 4
  })
})

test('dataview', (t) => {
  const buf = new DataView(new ArrayBuffer(4))

  clone(t, buf, {
    type: type.DATAVIEW,
    buffer: {
      type: type.ARRAYBUFFER,
      owned: false,
      data: buf.buffer
    },
    byteOffset: 0,
    byteLength: 4
  })
})

test('transfer arraybuffer', (t) => {
  let buf = new ArrayBuffer(4)

  const serialized = serializeWithTransfer(buf, [buf])

  t.ok(buf.detached)

  t.is(serialized.type, type.TRANSFER)
  t.is(serialized.transfers.length, 1)

  t.alike(serialized.value, {
    type: type.REFERENCE,
    id: 1
  })

  const transfer = serialized.transfers[0]

  t.is(transfer.type, type.ARRAYBUFFER)
  t.is(transfer.id, 1)
  t.ok(transfer.backingStore instanceof ArrayBuffer)

  buf = deserializeWithTransfer(serialized)

  t.is(buf.byteLength, 4)
})
