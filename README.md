# bare-structured-clone

Structured cloning algorithm for JavaScript. Implements the HTML serialization, deserialization, and transfer steps (<https://html.spec.whatwg.org/multipage/structured-data.html#structured-clone>) and exposes a compact-encoding codec (<https://github.com/holepunchto/compact-encoding>) for encoding serialized values to a buffer.

```
npm i bare-structured-clone
```

## Usage

```js
const structuredClone = require('bare-structured-clone')

const copy = structuredClone({ hello: 'world' })

const buffer = new ArrayBuffer(4)
const transferred = structuredClone(buffer, { transfer: [buffer] })
```

To install `structuredClone` as a global, require the `global` submodule:

```js
require('bare-structured-clone/global')

const copy = structuredClone({ hello: 'world' })
```

## API

#### `const copy = structuredClone(value[, options])`

Clone `value` by serializing and then deserializing it. `options` may include a `transfer` list and an `interfaces` list:

```js
options = {
  transfer: [],
  interfaces: []
}
```

`transfer` is an array of `ArrayBuffer` and `Transferable` objects whose ownership is transferred to the clone. After transfer, the original objects are detached. `interfaces` is an array of `Serializable` and `Transferable` constructors that may appear in `value`; each constructor must be present at both serialize and deserialize time.

#### `const serialized = serialize(value[, forStorage[, interfaces]])`

Serialize `value` to a `SerializedValue` describing its structure. If `forStorage` is `true`, the value is being serialized for persistent storage; types that cannot be persisted (such as `SharedArrayBuffer`) will throw.

#### `const serialized = serializeWithTransfer(value[, transferList[, interfaces]])`

Like `serialize()` but additionally detaches the objects in `transferList` and embeds their backing stores in the resulting `SerializedTransfer`.

#### `const value = deserialize(serialized[, interfaces])`

Deserialize a value previously produced by `serialize()`.

#### `const value = deserializeWithTransfer(serialized[, interfaces])`

Deserialize a value previously produced by `serializeWithTransfer()`, attaching the transferred backing stores to new objects.

#### `preencode(state, serialized)`

#### `encode(state, serialized)`

#### `const serialized = decode(state)`

The module is itself a compact-encoding codec for `SerializedValue` and `SerializedTransfer`, prefixing the payload with an ABI version header. Use it with `compact-encoding` to encode a serialized value to a buffer:

```js
const c = require('compact-encoding')
const structuredClone = require('bare-structured-clone')
const { serialize, deserialize } = structuredClone

const buffer = c.encode(structuredClone, serialize({ hello: 'world' }))
const value = deserialize(c.decode(structuredClone, buffer))
```

#### `constants`

Numeric tags used in serialized values. Also available as `require('bare-structured-clone/constants')`.

```js
constants = {
  VERSION,
  type: {
    UNDEFINED,
    NULL,
    TRUE,
    FALSE,
    NUMBER,
    BIGINT,
    STRING,
    DATE,
    REGEXP,
    ERROR,
    ARRAYBUFFER,
    RESIZABLEARRAYBUFFER,
    SHAREDARRAYBUFFER,
    GROWABLESHAREDARRAYBUFFER,
    TYPEDARRAY,
    DATAVIEW,
    MAP,
    SET,
    ARRAY,
    OBJECT,
    REFERENCE,
    TRANSFER,
    URL,
    BUFFER,
    EXTERNAL,
    SERIALIZABLE,
    TRANSFERABLE,
    typedarray: {
      /* ... */
    },
    error: {
      /* ... */
    }
  }
}
```

#### `symbols`

Well-known symbols used to implement custom `Serializable` and `Transferable` interfaces.

```js
symbols = {
  serialize: Symbol.for('bare.serialize'),
  deserialize: Symbol.for('bare.deserialize'),
  detach: Symbol.for('bare.detach'),
  attach: Symbol.for('bare.attach')
}
```

#### `class Serializable`

Base class for custom serializable interfaces. Subclasses must implement two methods keyed by the symbols above:

```js
const { Serializable, symbols } = require('bare-structured-clone')

class MySerializable extends Serializable {
  [symbols.serialize](forStorage) {
    // Return a `SerializableValue` describing this instance
  }

  static [symbols.deserialize](serialized) {
    // Return a new instance reconstructed from `serialized`
  }
}
```

The constructor must be registered via the `interfaces` option on both ends of the clone.

#### `class Transferable`

Base class for custom transferable interfaces. Instances carry a `detached` boolean that flips to `true` once ownership has been transferred. Subclasses must implement two methods keyed by the symbols above:

```js
const { Transferable, symbols } = require('bare-structured-clone')

class MyTransferable extends Transferable {
  [symbols.detach]() {
    // Release ownership and return a `SerializableValue` describing
    // the detached state
  }

  static [symbols.attach](serialized) {
    // Return a new instance that takes ownership of `serialized`
  }
}
```

The constructor must be registered via the `interfaces` option on both ends of the clone. The base `detach` implementation sets `detached` to `true`; subclasses should call `super[symbols.detach]()` after releasing their state.

## License

Apache-2.0
