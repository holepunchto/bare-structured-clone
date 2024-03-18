const test = require('brittle')
const { constants, serialize } = require('.')

const { type } = constants

test('serialize undefined', (t) => {
  t.alike(serialize(undefined), { type: type.UNDEFINED })
})

test('serialize null', (t) => {
  t.alike(serialize(null), { type: type.NULL })
})

test('serialize boolean', (t) => {
  t.alike(serialize(true), { type: type.TRUE })
  t.alike(serialize(false), { type: type.FALSE })
})

test('serialize array', (t) => {
  t.alike.coercively(serialize([42, 'hello', true]), {
    type: type.ARRAY,
    id: 0,
    length: 3,
    properties: [
      { key: '0', value: { type: type.NUMBER, value: 42 } },
      { key: '1', value: { type: type.STRING, value: 'hello' } },
      { key: '2', value: { type: type.TRUE } }
    ]
  })
})

test('serialize circular array', (t) => {
  const arr = []
  arr[0] = arr

  t.alike.coercively(serialize(arr), {
    type: type.ARRAY,
    id: 1,
    length: 1,
    properties: [
      { key: '0', value: { type: type.REFERENCE, id: 1 } }
    ]
  })
})

test('serialize object', (t) => {
  t.alike.coercively(serialize({ foo: 42, bar: 'hello', baz: true }), {
    type: type.OBJECT,
    id: 0,
    properties: [
      { key: 'foo', value: { type: type.NUMBER, value: 42 } },
      { key: 'bar', value: { type: type.STRING, value: 'hello' } },
      { key: 'baz', value: { type: type.TRUE } }
    ]
  })
})

test('serialize circular object', (t) => {
  const obj = {}
  obj.self = obj

  t.alike.coercively(serialize(obj), {
    type: type.OBJECT,
    id: 1,
    properties: [
      { key: 'self', value: { type: type.REFERENCE, id: 1 } }
    ]
  })
})

test('serialize map', (t) => {
  t.alike.coercively(serialize(new Map([['foo', 42], [1, true]])), {
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

test('serialize circular map', (t) => {
  const map = new Map()
  map.set('self', map)

  t.alike.coercively(serialize(map), {
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

test('serialize set', (t) => {
  t.alike.coercively(serialize(new Set(['foo', 42, true])), {
    type: type.SET,
    id: 0,
    data: [
      { type: type.STRING, value: 'foo' },
      { type: type.NUMBER, value: 42 },
      { type: type.TRUE }
    ]
  })
})

test('serialize circular set', (t) => {
  const set = new Set()
  set.add(set)

  t.alike.coercively(serialize(set), {
    type: type.SET,
    id: 1,
    data: [
      { type: type.REFERENCE, id: 1 }
    ]
  })
})
