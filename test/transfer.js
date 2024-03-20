const test = require('brittle')
const c = require('compact-encoding')
const structuredClone = require('..')

const { constants: { type }, serializeWithTransfer, deserializeWithTransfer } = structuredClone

function transfer (t, from, to, transferList, expected) {
  t.comment(from)

  let serialized = serializeWithTransfer(from, transferList)
  t.alike(serialized, typeof expected === 'function' ? expected(serialized) : expected, 'serializes as expected')

  const buffer = c.encode(structuredClone, serialized)
  t.ok(buffer instanceof Buffer, 'encodes to a buffer')

  serialized = c.decode(structuredClone, buffer)
  t.ok(serialized, 'decodes from a buffer')

  const deserialized = deserializeWithTransfer(serialized)
  t.alike(deserialized, to, 'deserializes as expected')
}

test.solo('transfer arraybuffer', (t) => {
  const from = new ArrayBuffer(4)
  const to = new ArrayBuffer(4)

  transfer(t, from, to, [from], (serialized) => {
    const [buf] = serialized.transfers

    t.ok(from.detached, 'buffer is detached')
    t.ok(buf.backingStore instanceof ArrayBuffer, 'backing store is a buffer')

    return {
      type: type.TRANSFER,
      value: { type: type.REFERENCE, id: 1 },
      transfers: [
        { type: type.ARRAYBUFFER, id: 1, backingStore: buf.backingStore }
      ]
    }
  })
})
