<div align="center">
  <h1>Lixnet</h1>
  <h3>Lightweight, type-safe RPC over HTTP and WebSockets.<br />The tRPC and Next.js Server Actions, but for everyone.</h3>

  <a href="https://github.com/Nitlix/Lixnet">
    <img alt="GitHub Repo stars" src="https://img.shields.io/github/stars/Nitlix/Lixnet?style=social">
  </a>

  <a href="https://www.npmjs.com/package/lixnet">
    <img alt="npm version" src="https://img.shields.io/npm/v/lixnet.svg">
  </a>
  <a href="https://www.npmjs.com/package/lixnet">
    <img alt="weekly downloads" src="https://img.shields.io/npm/dm/lixnet.svg">
  </a>
</div>

<br />

## Intro

Lixnet is a tiny yet powerful TypeScript-first RPC library for teams who want a **small, explicit RPC layer** with excellent typing, without codegen or framework lock-in.

If you like the ergonomics of **tRPC** or **Next.js Server Actions**, but want something that:

- stays close to the **Fetch** platform (`Request`/`Response`)
- works in **Bun / Next.js / Workers**
- keeps the protocol simple and inspectable

Lixnet is a good fit.

It gives you:

- **HTTP RPC** via `fetch` (`LixnetServer` + `LixnetClient`)
- **WebSocket events + callbacks** (`LixnetPeer`)
- **Optional Zod validation** on the server
- **Next.js-like** `request.cookies()` / `request.headers()` ergonomics inside handlers (without pulling in Next)

It’s designed to be minimal: no codegen, no schema registry, no client bundler magic.

## Table of contents

- [Quickstart (HTTP RPC)](#quickstart-http-rpc)
- [Framework adapters (server wiring)](#framework-adapters-server-wiring)
- [Server: `LixnetServer`](#server-lixnetserver)
- [Client: `LixnetClient`](#client-lixnetclient)
- [Handlers: `request` and `response`](#handlers-request-and-response)
- [WebSockets: `LixnetPeer`](#websockets-lixnetpeer)
- [API reference](#api-reference)
- [Contributor docs](#contributor-docs)
- [License](#license)

## Quickstart (HTTP RPC)

Install:

```sh
bun add lixnet zod
```

Other package managers:

```sh
pnpm add lixnet zod
npm i lixnet zod
```

### 1) Define an `Events` type

This is the contract shared by server and client.

```ts
type Events = {
    greet: (input: { name: string }) => Promise<string>;
};
```

### 2) Create the RPC server

Register handlers with optional Zod schemas, then expose an HTTP endpoint that forwards the incoming `Request` to `server.handle(...)`.

```ts
import { z } from "zod";
import { LixnetServer } from "lixnet";

type Events = {
    greet: (input: { name: string }) => Promise<string>;
};

export const server = new LixnetServer<Events>({
    debugLog: false,
});

server.on({
    event: "greet",
    schema: z.object({ name: z.string() }),
    handler: async ({ name, request, response }) => {
        // Optional: read request cookies/headers (Next-like API)
        const userAgent = request.headers().get("user-agent");
        if (userAgent) response.header("x-user-agent", userAgent);

        return `Hello, ${name}!`;
    },
});
```

### 3) Wire the HTTP endpoint

Lixnet uses the Fetch standard `Request`/`Response`, so wiring is always “forward `Request` into `server.handle(...)`”.

## Framework adapters (server wiring)

### Bun

```ts
import { server } from "./rpc/server";

Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/rpc") {
            return server.handle(req);
        }
        return new Response("Not found", { status: 404 });
    },
});
```

### Next.js Route Handler

```ts
export async function POST(req: Request) {
    return server.handle(req);
}
```

### Cloudflare Workers / standard Fetch handler

```ts
export default {
    async fetch(req: Request) {
        const url = new URL(req.url);
        if (req.method === "POST" && url.pathname === "/rpc") {
            return server.handle(req);
        }
        return new Response("Not found", { status: 404 });
    },
};
```

### 4) Create the RPC client

```ts
import { LixnetClient } from "lixnet";

type Events = {
    greet: (input: { name: string }) => Promise<string>;
};

const client = new LixnetClient<Events>({ rpcUrl: "/api/rpc" });

const message = await client.call("greet", { name: "World" });
```

If you need auth/cookies, pass `fetch` options:

```ts
await client.call(
    "greet",
    { name: "World" },
    { credentials: "include", headers: { Authorization: "Bearer ..." } },
);
```

## Server: `LixnetServer`

### Registering events

`server.on(...)` accepts either one registration object or an array.

- **`event`**: string key matching your `Events` type
- **`schema`** (optional): Zod schema to validate `input`
- **`handler`**: receives validated input plus `{ request, response }` injections

Example registering multiple events:

```ts
server.on([
    {
        event: "greet",
        schema: z.object({ name: z.string() }),
        handler: async ({ name }) => `Hello, ${name}!`,
    },
    {
        event: "health",
        handler: async () => ({ ok: true as const }),
    },
]);
```

### Handling requests

`server.handle(request)` expects the request body to be JSON:

```json
{ "event": "someEvent", "input": { "...": "..." } }
```

Responses are JSON and shaped as either:

```json
{ "data": "..." }
```

or

```json
{ "error": "..." }
```

### Server configuration

`new LixnetServer({ ... })` supports:

- **`defaultHeaders`**: headers included on every response (unless deleted later)
- **`formatter`**: customize how `LixnetResponse` becomes a `Response`
- **`logger`** + **`debugLog`**: currently used for invalid JSON logging

Example:

```ts
const server = new LixnetServer<Events>({
    debugLog: true,
    defaultHeaders: {
        "access-control-allow-origin": "*",
    },
});
```

## Client: `LixnetClient`

`client.call(event, input, options?)`:

- sends a `POST` with `{ event, input }`
- throws `Error(...)` when the response contains `{ error }`
- otherwise returns `{ data }`’s value

### Client creation

```ts
const client = new LixnetClient<Events>({
    rpcUrl: "https://api.example.com/rpc",
});
```

## Handlers: `request` and `response`

Handler signature is:

- your validated input fields
- plus:
    - `request`: a `Request` enhanced with `request.cookies()` and `request.headers()`
    - `response`: a `LixnetResponse` you can use to stage headers/cookies/status

Common operations:

- **Set status**: `response.code(201)`
- **Set header**: `response.header("X-Foo", "bar")`
- **Delete header**: `response.deleteHeader("x-foo")`
- **Set cookie**: `response.cookie("session", "abc", { httpOnly: true, path: "/" })`
- **Delete cookie**: `response.deleteCookie("session", { path: "/" })`

`request.cookies()` / `request.headers()` also support “read your writes” inside the handler because they merge staged response mutations.

## WebSockets: `LixnetPeer`

`LixnetPeer` is a typed event dispatcher for WebSockets with:

- **fire-and-forget events**
- **optional callbacks** (request/response style over WS)
- **optional chunking** for large payloads (see contributor docs for protocol details)

Minimal sketch:

```ts
import { LixnetPeer } from "lixnet";

type ClientToServer = {
    ping: (input: { t: number }) => Promise<{ ok: true }>;
};

type ServerToClient = {
    notify: (input: { message: string }) => void;
};

const peer = new LixnetPeer<ServerToClient, ClientToServer>();

peer.on("ping", async ({ t, socket }) => {
    return { ok: true };
});

// In your WS message handler:
// peer.handle({ data: event.data, socket: ws });
```

### WebSocket setup (typical pattern)

```ts
const peer = new LixnetPeer<ServerToClient, ClientToServer>();
peer.setSocket(ws);

ws.addEventListener("message", (event) => {
    peer.handle({ data: event.data, socket: ws });
});
```

### Callbacks (request/response over WS)

```ts
await peer.call(
    "ping",
    { t: Date.now() },
    {
        callback: (result) => {
            // result is typed as Awaited<ReturnType<ClientToServer["ping"]>>
            console.log(result.ok);
        },
    },
);
```

### Large payloads (chunking)

If messages can exceed your runtime’s WS frame limits, enable chunking:

```ts
peer.setTransmissionLimit(64_000); // bytes-ish (string length)
peer.setTransmissionChunksLimit(20); // currently stored, not enforced by sender
```

## API reference

### Exports

From `src/exports.ts`:

- **`LixnetServer`**
- **`LixnetClient`**
- **`LixnetPeer`**
- **`LixnetResponse`**

Types:

- **`LXN_ServerClient_EventType`**
- **`LXNServerHandler`**
- **`FunctionInput`**
- **`LXN_ServerClient_Request`** (alias of `LixnetRequest`)
- **`LixnetRequest`**, **`LixnetCookies`**, **`LixnetHeaders`**

## Contributor docs

- **Implementation + extension guide**: [`FOR_AGENTS.md`](FOR_AGENTS.md)

## License

MIT
