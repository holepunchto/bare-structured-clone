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

See the [`bare-structured-clone` reference](https://docs.pears.com/reference/bare/modules/bare-structured-clone).

## Threat model

`bare-structured-clone` is one of the addons Bare compiles into its binary, so it inherits [Bare's threat model](https://github.com/holepunchto/bare/blob/main/docs/threat-model.md). See [`docs/threat-model.md`](docs/threat-model.md) for where this addon sits in it.

## License

Apache-2.0
