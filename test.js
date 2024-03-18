const test = require('brittle')
const { constants, serialize, serializeWithTransfer, deserialize, deserializeWithTransfer } = require('.')

const { type } = constants

test('undefined', (t) => {
  const serialized = serialize(undefined)

  t.alike(serialized, { type: type.UNDEFINED })

  t.is(deserialize(serialized), undefined)
})

test('null', (t) => {
  const serialized = serialize(null)

  t.alike(serialized, { type: type.NULL })

  t.is(deserialize(serialized), null)
})

test('boolean', (t) => {
  {
    const serialized = serialize(true)

    t.alike(serialized, { type: type.TRUE })

    t.is(deserialize(serialized), true)
  }
  {
    const serialized = serialize(false)

    t.alike(serialized, { type: type.FALSE })

    t.is(deserialize(serialized), false)
  }
})

test('array', (t) => {
  const arr = [42, 'hello', true]

  const serialized = serialize(arr)

  t.alike.coercively(serialized, {
    type: type.ARRAY,
    id: 0,
    length: 3,
    properties: [
      { key: '0', value: { type: type.NUMBER, value: 42 } },
      { key: '1', value: { type: type.STRING, value: 'hello' } },
      { key: '2', value: { type: type.TRUE } }
    ]
  })

  t.alike(deserialize(serialized), arr)
})

test('circular array', (t) => {
  const arr = []
  arr[0] = arr

  const serialized = serialize(arr)

  t.alike.coercively(serialized, {
    type: type.ARRAY,
    id: 1,
    length: 1,
    properties: [
      { key: '0', value: { type: type.REFERENCE, id: 1 } }
    ]
  })

  t.alike(deserialize(serialized), arr)
})

test('object', (t) => {
  const obj = { foo: 42, bar: 'hello', baz: true }

  const serialized = serialize(obj)

  t.alike.coercively(serialized, {
    type: type.OBJECT,
    id: 0,
    properties: [
      { key: 'foo', value: { type: type.NUMBER, value: 42 } },
      { key: 'bar', value: { type: type.STRING, value: 'hello' } },
      { key: 'baz', value: { type: type.TRUE } }
    ]
  })

  t.alike(deserialize(serialized), obj)
})

test('circular object', (t) => {
  const obj = {}
  obj.self = obj

  const serialized = serialize(obj)

  t.alike.coercively(serialized, {
    type: type.OBJECT,
    id: 1,
    properties: [
      { key: 'self', value: { type: type.REFERENCE, id: 1 } }
    ]
  })

  t.alike(deserialize(serialized), obj)
})

test('map', (t) => {
  const map = new Map([['foo', 42], [1, true]])

  const serialized = serialize(map)

  t.alike.coercively(serialized, {
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

  t.alike(deserialize(serialized), map)
})

test('circular map', (t) => {
  const map = new Map()
  map.set('self', map)

  const serialized = serialize(map)

  t.alike.coercively(serialized, {
    type: type.MAP,
    id: 1,
    data: [
      {
        key: { type: type.STRING, value: 'self' },
        value: { type: type.REFERENCE, id: 1 }
      }
    ]
  })

  t.alike(deserialize(serialized), map)
})

test('set', (t) => {
  const set = new Set(['foo', 42, true])

  const serialized = serialize(set)

  t.alike.coercively(serialized, {
    type: type.SET,
    id: 0,
    data: [
      { type: type.STRING, value: 'foo' },
      { type: type.NUMBER, value: 42 },
      { type: type.TRUE }
    ]
  })

  t.alike(deserialize(serialized), set)
})

test('circular set', (t) => {
  const set = new Set()
  set.add(set)

  const serialized = serialize(set)

  t.alike.coercively(serialized, {
    type: type.SET,
    id: 1,
    data: [
      { type: type.REFERENCE, id: 1 }
    ]
  })

  t.alike(deserialize(serialized), set)
})

test('buffer', (t) => {
  const buf = Buffer.from([1, 2, 3, 4])

  const serialized = serialize(buf)

  t.alike(serialized, {
    type: type.BUFFER,
    owned: false,
    data: buf
  })

  t.alike(deserialize(serialized), buf)
})

test('arraybuffer', (t) => {
  const buf = new ArrayBuffer(4)

  Buffer.from(buf).set([1, 2, 3, 4])

  const serialized = serialize(buf)

  t.alike(serialized, {
    type: type.ARRAYBUFFER,
    owned: false,
    data: buf
  })

  t.alike(deserialize(serialized), buf)
})

test('resizable arraybuffer', (t) => {
  const buf = new ArrayBuffer(4, { maxByteLength: 8 })

  Buffer.from(buf).set([1, 2, 3, 4])

  const serialized = serialize(buf)

  t.alike(serialized, {
    type: type.RESIZABLEARRAYBUFFER,
    owned: false,
    data: buf,
    maxByteLength: 8
  })

  t.alike(deserialize(serialized), buf)
})

test('sharedarraybuffer', (t) => {
  const buf = new SharedArrayBuffer(4)

  Buffer.from(buf).set([1, 2, 3, 4])

  const serialized = serialize(buf)

  t.is(serialized.type, type.SHAREDARRAYBUFFER)
  t.ok(serialized.backingStore instanceof Buffer)

  t.alike(deserialize(serialized), buf)
})

test('growable sharedarraybuffer', (t) => {
  const buf = new SharedArrayBuffer(4, { maxByteLength: 8 })

  Buffer.from(buf).set([1, 2, 3, 4])

  const serialized = serialize(buf)

  t.is(serialized.type, type.GROWABLESHAREDARRAYBUFFER)
  t.ok(serialized.backingStore instanceof Buffer)

  t.alike(deserialize(serialized), buf)
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
  t.ok(transfer.backingStore instanceof Buffer)

  buf = deserializeWithTransfer(serialized)

  t.is(buf.byteLength, 4)
})
