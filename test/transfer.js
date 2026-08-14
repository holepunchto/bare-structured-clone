const test = require('brittle')
const c = require('compact-encoding')
const structuredClone = require('..')

const {
  constants: { type },
  symbols,
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
      transfers: [{ type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }],
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

test('transfer arraybuffer reads resizability from the buffer', (t) => {
  const arrayBuffer = new ArrayBuffer(8)

  const serialized = serializeWithTransfer({ resizable: true, maxByteLength: 999, arrayBuffer }, [
    arrayBuffer
  ])

  t.is(serialized.transfers[0].type, type.ARRAYBUFFER, 'tagged as a plain arraybuffer')
  t.absent('maxByteLength' in serialized.transfers[0], 'no max byte length recorded')
})

test('transfer resizable arraybuffer stays resizable', (t) => {
  const arrayBuffer = new ArrayBuffer(8, { maxByteLength: 64 })

  const serialized = serializeWithTransfer({ arrayBuffer }, [arrayBuffer])

  t.is(serialized.transfers[0].type, type.RESIZABLEARRAYBUFFER, 'tagged as a resizable arraybuffer')
  t.is(serialized.transfers[0].maxByteLength, 64, 'records the max byte length')

  const cloned = deserializeWithTransfer(
    c.decode(structuredClone, c.encode(structuredClone, serialized))
  )

  t.is(cloned.arrayBuffer.byteLength, 8, 'byte length survives')
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
      transfers: [{ type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }],
      value: {
        type: type.ARRAY,
        id: 2,
        length: 1,
        elements: [{ type: type.REFERENCE, id: 1 }],
        properties: []
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
      transfers: [{ type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }],
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

test('transfer shares property names', (t) => {
  const arrayBuffer = new ArrayBuffer(4)

  const serialized = serializeWithTransfer(
    { shared: { alpha: 1 }, other: { alpha: 2 }, arrayBuffer },
    [arrayBuffer]
  )

  const cloned = deserializeWithTransfer(
    c.decode(structuredClone, c.encode(structuredClone, serialized))
  )

  t.alike(cloned.shared, { alpha: 1 }, 'first name survives')
  t.alike(cloned.other, { alpha: 2 }, 'repeated name survives')
  t.is(cloned.arrayBuffer.byteLength, 4, 'transfer survives')
})

test('transfer transferable', (t) => {
  class Foo {
    constructor() {
      this.detached = false
    }

    [symbols.detach]() {
      this.detached = true

      return 1234
    }

    static [symbols.attach](value) {
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
    [symbols.detach]() {}
  }

  const foo = new Foo()

  try {
    serializeWithTransfer(foo, [foo])
    t.fail()
  } catch (err) {
    t.comment(err.message)
  }
})

test('transfer transferable matched by interface key', (t) => {
  // Two distinct copies of the same class, as would arise when the value to
  // transfer comes from code that bundles its own copy of the interface. The
  // copies share an interface key but not their class identity.
  function makeClass() {
    return class Foo {
      constructor() {
        this.detached = false
      }

      static get [symbols.interface]() {
        return Symbol.for('foo')
      }

      [symbols.detach]() {
        this.detached = true

        return 1234
      }

      static [symbols.attach](value) {
        t.is(value, 1234)

        return new Foo()
      }
    }
  }

  const Registered = makeClass()
  const Bundled = makeClass()

  t.not(Registered, Bundled, 'classes have distinct identities')

  const from = new Bundled()
  const to = new Registered()

  transfer(t, from, to, [from], [Registered], () => {
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

test('transfer arraybuffer cannot be claimed twice', (t) => {
  const buffer = new ArrayBuffer(8)

  const serialized = serializeWithTransfer({ buffer }, [buffer])

  t.is(deserializeWithTransfer(serialized).buffer.byteLength, 8, 'the first claim succeeds')

  t.exception(() => deserializeWithTransfer(serialized), 'the second is rejected')
})

test('sharedarraybuffer cannot be claimed twice', (t) => {
  const buffer = new SharedArrayBuffer(8)

  const serialized = structuredClone.serialize(buffer)

  t.is(structuredClone.deserialize(serialized).byteLength, 8, 'the first claim succeeds')

  t.exception(() => structuredClone.deserialize(serialized), 'the second is rejected')
})

test('transfer transferable left out of the transfer list', (t) => {
  // A value that can only travel by being transferred must not be quietly
  // copied when it was not handed over.
  class Foo {
    constructor() {
      this.detached = false
    }

    [symbols.detach]() {
      this.detached = true
    }

    static [symbols.attach]() {
      return new Foo()
    }
  }

  const foo = new Foo()

  try {
    serializeWithTransfer({ foo }, [], [Foo])
    t.fail('expected serialization to throw')
  } catch (err) {
    t.is(err.code, 'UNSERIALIZABLE_TYPE', 'throws rather than copying')
  }

  t.absent(foo.detached, 'the value is left alone')
})

test('transfer transferable that is also serializable', (t) => {
  // Being serializable is a way through in its own right, so leaving such a
  // value out of the transfer list serializes it instead of turning it away.
  class Foo {
    constructor(n) {
      this.n = n
      this.detached = false
    }

    [symbols.serialize]() {
      return this.n
    }

    static [symbols.deserialize](n) {
      return new Foo(n)
    }

    [symbols.detach]() {
      this.detached = true
      return this.n
    }

    static [symbols.attach](n) {
      return new Foo(n)
    }
  }

  const foo = new Foo(1234)

  const cloned = structuredClone({ foo }, { interfaces: [Foo] })

  t.ok(cloned.foo instanceof Foo, 'is serialized')
  t.is(cloned.foo.n, 1234, 'carrying its value')
  t.absent(foo.detached, 'without being detached')
})

test('transfer detached transferable left out of the transfer list', (t) => {
  class Foo {
    constructor() {
      this.detached = false
    }

    [symbols.detach]() {
      this.detached = true
    }

    static [symbols.attach]() {
      return new Foo()
    }
  }

  const foo = new Foo()

  structuredClone({}, { transfer: [foo], interfaces: [Foo] })

  t.ok(foo.detached, 'the value is detached')

  try {
    structuredClone({ foo }, { interfaces: [Foo] })
    t.fail('expected serialization to throw')
  } catch (err) {
    t.is(err.code, 'UNSERIALIZABLE_TYPE', 'throws rather than copying')
  }
})
