const test = require('brittle')
const c = require('compact-encoding')
const structuredClone = require('..')

const {
  constants: { type },
  serializeWithTransfer,
  deserializeWithTransfer
} = structuredClone

function transfer(t, from, to, transferList, interfaces, expected) {
  if (!Array.isArray(interfaces)) {
    expected = interfaces
    interfaces = []
  }

  t.comment(from)

  let serialized = serializeWithTransfer(from, transferList, interfaces)
  t.alike(
    serialized,
    typeof expected === 'function' ? expected(serialized) : expected,
    'serializes as expected'
  )

  const buffer = c.encode(structuredClone, serialized)
  t.ok(buffer instanceof Buffer, 'encodes to a buffer')

  serialized = c.decode(structuredClone, buffer)
  t.ok(serialized, 'decodes from a buffer')

  const deserialized = deserializeWithTransfer(serialized, interfaces)
  t.alike(deserialized, to, 'deserializes as expected')
}

test('transfer arraybuffer', (t) => {
  const from = new ArrayBuffer(4)
  const to = new ArrayBuffer(4)

  transfer(t, from, to, [from], (serialized) => {
    const [buf] = serialized.transfers

    t.ok(from.detached, 'buffer is detached')
    t.ok(buf.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.TRANSFER,
      transfers: [
        { type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }
      ],
      value: { type: type.REFERENCE, id: 1 }
    }
  })
})

test('transfer resizable arraybuffer', (t) => {
  const from = new ArrayBuffer(4, { maxByteLength: 8 })
  const to = new ArrayBuffer(4, { maxByteLength: 8 })

  transfer(t, from, to, [from], (serialized) => {
    const [buf] = serialized.transfers

    t.ok(from.detached, 'buffer is detached')
    t.ok(buf.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.TRANSFER,
      transfers: [
        {
          type: type.RESIZABLEARRAYBUFFER,
          id: 1,
          backingStore: buf.backingStore,
          maxByteLength: 8
        }
      ],
      value: { type: type.REFERENCE, id: 1 }
    }
  })
})

test('transfer arraybuffer in array', (t) => {
  const from = [new ArrayBuffer(4)]
  const to = [new ArrayBuffer(4)]

  transfer(t, from, to, [from[0]], (serialized) => {
    const [buf] = serialized.transfers

    t.ok(from[0].detached, 'buffer is detached')
    t.ok(buf.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.TRANSFER,
      transfers: [
        { type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }
      ],
      value: {
        type: type.ARRAY,
        id: 2,
        length: 1,
        properties: [
          {
            key: '0',
            value: { type: type.REFERENCE, id: 1 }
          }
        ]
      }
    }
  })
})

test('transfer arraybuffer in object', (t) => {
  const from = { buf: new ArrayBuffer(4) }
  const to = { buf: new ArrayBuffer(4) }

  transfer(t, from, to, [from.buf], (serialized) => {
    const [buf] = serialized.transfers

    t.ok(from.buf.detached, 'buffer is detached')
    t.ok(buf.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.TRANSFER,
      transfers: [
        { type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }
      ],
      value: {
        type: type.OBJECT,
        id: 2,
        properties: [
          {
            key: 'buf',
            value: { type: type.REFERENCE, id: 1 }
          }
        ]
      }
    }
  })
})

test('transfer transferable', (t) => {
  class Foo {
    constructor() {
      this.detached = false
    }

    [Symbol.for('bare.detach')]() {
      this.detached = true

      return 1234
    }

    static [Symbol.for('bare.attach')](value) {
      t.is(value, 1234)

      return new Foo()
    }
  }

  const from = new Foo()
  const to = new Foo()

  transfer(t, from, to, [from], [Foo], () => {
    t.ok(from.detached, 'value is detached')

    return {
      type: type.TRANSFER,
      transfers: [
        {
          type: type.TRANSFERABLE,
          id: 1,
          interface: 1,
          value: { type: type.NUMBER, value: 1234 }
        }
      ],
      value: { type: type.REFERENCE, id: 1 }
    }
  })
})

test('transfer transferable, unregistered', (t) => {
  class Foo {
    [Symbol.for('bare.detach')]() {}
  }

  const foo = new Foo()

  try {
    serializeWithTransfer(foo, [foo])
    t.fail()
  } catch (err) {
    t.comment(err.message)
  }
})
