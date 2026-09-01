const test = require('brittle')
const c = require('compact-encoding')
const structuredClone = require('..')
const binding = require('../binding')

const ADDON = require.addon.resolve('..', __filename)

const {
  constants: { type },
  serialize,
  deserialize,
  serializeWithTransfer,
  deserializeWithTransfer
} = structuredClone

function forged(value = 0x4141414141414141n) {
  const handle = new ArrayBuffer(8)

  new BigUint64Array(handle)[0] = value

  return handle
}

test('forged backing store handle is rejected', (t) => {
  t.exception(() =>
    deserializeWithTransfer({
      transfers: [{ type: type.ARRAYBUFFER, id: 0, backingStore: forged() }],
      value: { type: type.REFERENCE, id: 0 }
    })
  )
})

test('forged external pointer is rejected', (t) => {
  t.exception(() => deserialize({ type: type.EXTERNAL, pointer: forged() }))
})

test('forged sharedarraybuffer handle is rejected', (t) => {
  t.exception(() => deserialize({ type: type.SHAREDARRAYBUFFER, id: 0, backingStore: forged() }))
})

test('a handle that is not an arraybuffer is rejected', (t) => {
  t.exception(() => deserialize({ type: type.EXTERNAL, pointer: 'not a handle' }))
  t.exception(() => deserialize({ type: type.EXTERNAL, pointer: new ArrayBuffer(4) }))
})

test('a copied backing store handle cannot be claimed twice', (t) => {
  // The handle is plain bytes, so claiming it must not be defeated by taking
  // a copy of those bytes first.
  const buffer = new ArrayBuffer(8)

  const serialized = serializeWithTransfer(buffer, [buffer])

  const copy = new ArrayBuffer(8)
  Buffer.from(copy).set(Buffer.from(serialized.transfers[0].backingStore))

  serialized.transfers.push({ type: type.ARRAYBUFFER, id: 1, backingStore: copy })

  t.exception(() => deserializeWithTransfer(serialized))
})

test('a backing store handle cannot be claimed as the wrong kind', (t) => {
  const buffer = new ArrayBuffer(8)

  const { backingStore } = serializeWithTransfer(buffer, [buffer]).transfers[0]

  t.exception(() => deserialize({ type: type.SHAREDARRAYBUFFER, id: 0, backingStore }))
})

test('a non-detachable arraybuffer cannot be transferred', (t) => {
  const memory = new WebAssembly.Memory({ initial: 1 })

  t.exception(() => serializeWithTransfer(memory.buffer, [memory.buffer]), /UNTRANSFERABLE_TYPE/)

  t.absent(memory.buffer.detached, 'the buffer is left alone')
})

test('binding rejects values of the wrong type', (t) => {
  // Passing the wrong type is a mistake by the caller rather than bad input
  // off the wire, so these come back as type errors.
  t.exception.all(() => binding.getArrayBufferBackingStore('not an arraybuffer'))
  t.exception.all(() => binding.getSharedArrayBufferBackingStore(new ArrayBuffer(8)))
  t.exception.all(() => binding.getExternal({}))
  t.exception.all(() => binding.detachArrayBuffer(42))
  t.exception.all(() => binding.createArrayBuffer())
  t.exception.all(() => binding.createExternal(null))
})

test('a detached arraybuffer has no backing store to take', (t) => {
  const buffer = new ArrayBuffer(8)

  serializeWithTransfer(buffer, [buffer])

  t.ok(buffer.detached)
  t.exception(() => binding.getArrayBufferBackingStore(buffer), /detached/)
})

test('an encoded handle outlives the serialization it came from', (t) => {
  if (typeof global.gc !== 'function') return t.comment('run with --expose-gc to check')

  let buffer

  {
    const source = new ArrayBuffer(64)
    new Uint8Array(source).fill(0xab)

    buffer = c.encode(structuredClone, serializeWithTransfer(source, [source]))
  }

  global.gc()
  global.gc()

  const claimed = deserializeWithTransfer(c.decode(structuredClone, buffer))

  t.is(claimed.byteLength, 64)
  t.is(new Uint8Array(claimed)[63], 0xab, 'the contents survived')
})

test('an abandoned serialization releases its backing stores', (t) => {
  if (typeof global.gc !== 'function') return t.comment('run with --expose-gc to check')

  // Never encoded and never claimed, so nothing can reach these again and the
  // collector, rather than the registry, is left owning them.
  for (let i = 0; i < 2000; i++) {
    const buffer = new ArrayBuffer(64 * 1024)

    serializeWithTransfer(buffer, [buffer])
  }

  global.gc()

  t.pass('128 MiB of abandoned transfers did not exhaust memory')
})

test('serialized handles are not addresses', (t) => {
  // A pointer would repeat; a token minted for the same backing store twice
  // must not.
  const buffer = new SharedArrayBuffer(8)

  const first = new BigUint64Array(serialize(buffer).backingStore)[0]
  const second = new BigUint64Array(serialize(buffer).backingStore)[0]

  t.not(first, second)
})

test('the addon can be instantiated more than once', (t) => {
  // The initialiser runs for every `new Addon()`, not once per thread.
  const first = new Bare.Addon(new URL('file://' + ADDON)).exports
  const second = new Bare.Addon(new URL('file://' + ADDON)).exports

  const buffer = new ArrayBuffer(64)

  const handle = first.getArrayBufferBackingStore(buffer)
  first.detachArrayBuffer(buffer)

  t.is(
    second.createArrayBuffer(handle).byteLength,
    64,
    'a handle minted by one instance is claimable through another'
  )

  t.exception(() => first.createArrayBuffer(handle), 'and only once')
})

test('threads may come and go', (t) => {
  // The registry outlives any one thread, and the addon need not have been
  // loaded from the main thread first.
  const source = `
    const binding = new Bare.Addon(new URL('file://${ADDON}')).exports
    const status = new Int32Array(Bare.Thread.self.data)

    try {
      const buffer = new ArrayBuffer(64)
      const handle = binding.getArrayBufferBackingStore(buffer)
      binding.detachArrayBuffer(buffer)

      // Deliberately left outstanding, so the thread exits still owning it.
      binding.retainHandle(binding.getArrayBufferBackingStore(new ArrayBuffer(1024)))

      status[0] = binding.createArrayBuffer(handle).byteLength === 64 ? 1 : 2
    } catch {
      status[0] = 3
    }
  `

  for (let i = 0; i < 8; i++) {
    const result = new SharedArrayBuffer(4)
    const status = new Int32Array(result)

    new Bare.Thread('worker.js', { source, data: result }).join()

    t.is(status[0], 1, 'thread ' + i + ' transferred cleanly')
  }
})
