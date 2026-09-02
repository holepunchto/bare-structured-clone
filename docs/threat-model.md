# Threat model

## What this is

`bare-structured-clone` is compiled into Bare. It is listed in `src/builtins.json`, so every Bare process has it. That holds whether or not the process sealed, and no code has to load anything to reach it.

So this addon is part of Bare, and [Bare's threat model](https://github.com/holepunchto/bare/blob/main/docs/threat-model.md) covers it. Read that one first. This one only says where this addon sits in it.

## What it inherits

- **The promise.** Bare promises a sealed process gets no new native code. This addon is native code that is already in, so the seal neither adds it nor takes it away.
- **The attacker.** Untrusted JavaScript in a sealed process. It writes what it likes, runs on as many threads as it wants, and calls anything it can reach in any order and all at once. It can reach all of this addon.
- **The trust.** This addon is trusted, because Bare compiles it in. Whatever you compile in is your security policy, and this is one of the things you picked.
- **The walls.** The same table applies. A thread is not a wall and neither is a realm, so nothing here gets to assume it is alone.
- **The rules.** What Bare says to report, and what Bare says is not a bug, is the same here.

## What counts

- **Counts:** `binding.c` and the JavaScript that ships with it. Sealed JavaScript reaches all of it without loading a thing.
- **Does not count:** tests, benchmarks, and scratch code.

## What this addon adds

It serializes, deserializes and transfers any JavaScript value. It also reaches `ArrayBuffer` and `SharedArrayBuffer` backing stores, detaches them, and moves externals between Bare processes.

Thread messaging and transfer lists run on it, so it decodes bytes written by whoever sent the message.

Externals move as opaque tokens. `getExternal` mints a token for a pointer the process already holds, and `createExternal` redeems that token, once, for that same pointer. Pointers never reach JavaScript as numbers, and JavaScript cannot make an address up and have it taken.

## Where the risk is

Bare's list of risky spots names this addon twice, once as structured clone and once as thread transfer lists. It is the sharpest of the builtins, and the reason is simple. It turns attacker bytes into typed values, so a wrong length or a wrong tag is not a wrong answer, it is memory corruption.

Backing stores are the other half. Two live views onto a store that was detached or freed is the same bug in another form.

## What to report

- Any input to deserialization that reads or writes out of bounds, on any bytes at all, including truncated and hand-written ones
- Any way to reach a detached or freed backing store
- Any way to redeem a token that was never minted, to redeem one twice, or to get an address into JavaScript as a number
- Allocation or stack growth that an input can drive without bound, deep and cyclic graphs included
- Anything on Bare's report list
