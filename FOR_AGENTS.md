# Lixnet: usage guide for agents

This file is a **complete, standalone usage guide** intended for AI agents (and humans) consuming Lixnet from npm.

When Lixnet is installed, you typically see built `*.js` + `*.d.ts`, not the source `*.ts`. The goal here is that an agent can **read only this markdown** and immediately:

- implement a new RPC server + client
- add new endpoints safely
- wire Lixnet into Bun / Next.js / Workers
- use `request.cookies()` / `request.headers()` and `response.*` correctly
- use `LixnetPeer` over WebSockets (including callbacks + large payload chunking)

All examples are written for **TypeScript** and assume a Fetch-compatible runtime.

## Goals (implicit contract)

- **Fetch-first**: everything is `Request`/`Response` compatible (Bun/Node/Next/Workers).
- **Type-first**: users bring their own `Events` type; Lixnet only derives `input`/`output` from function types.
- **Stable wire shapes**:
    - HTTP request body: `{ event, input }`
    - HTTP response body: `{ data }` or `{ error }`
    - WS messages: event/callback/transmission shapes described below

## What Lixnet is

Lixnet provides two related primitives:

- **HTTP RPC**: `LixnetServer` + `LixnetClient` for request/response RPC over HTTP (JSON).
- **WebSocket RPC**: `LixnetPeer` for event-based messaging over a `WebSocket`, with optional callbacks and an optional chunking layer for large payloads.

The package entrypoint exports these primitives and a small request/response helper layer.

## Quickstart (HTTP RPC)

Install:

```sh
bun add lixnet zod
```

### 1) Define your contract (`Events`)

Define an `Events` type where each key is an RPC name and each value is a **function type** describing input and output.

```ts
export type Events = {
    greet: (input: { name: string }) => Promise<string>;
    add: (input: { a: number; b: number }) => number;
};
```

### 2) Create the RPC server (`LixnetServer`)

```ts
import { z } from "zod";
import { LixnetServer } from "lixnet";
import type { Events } from "./events";

export const server = new LixnetServer<Events>({
    debugLog: false,
    defaultHeaders: {
        // example defaults; you can remove these
        "x-powered-by": "lixnet",
    },
});

server.on([
    {
        event: "greet",
        schema: z.object({ name: z.string().min(1) }),
        handler: async ({ name, request, response }) => {
            // Read inbound headers/cookies (Next-like APIs)
            const ua = request.headers().get("user-agent");
            if (ua) response.header("x-user-agent", ua);

            // Stage cookies/headers/status
            response.cookie("lastGreeting", name, { path: "/", maxAge: 60 });

            return `Hello, ${name}!`;
        },
    },
    {
        event: "add",
        schema: z.object({ a: z.number(), b: z.number() }),
        handler: ({ a, b }) => a + b,
    },
]);
```

### 3) Wire the endpoint (Bun / Next.js / Workers)

#### Bun (`Bun.serve`)

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

#### Next.js Route Handler (`app/api/rpc/route.ts`)

```ts
import { server } from "@/rpc/server";

export async function POST(req: Request) {
    return server.handle(req);
}
```

#### Cloudflare Workers / standard Fetch handler

```ts
import { server } from "./rpc/server";

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

### 4) Create the client (`LixnetClient`)

```ts
import { LixnetClient } from "lixnet";
import type { Events } from "./events";

const client = new LixnetClient<Events>({
    rpcUrl: "http://localhost:3000/rpc",
});

const msg = await client.call("greet", { name: "World" });
const sum = await client.call("add", { a: 1, b: 2 });
```

If you need cookies/auth, pass `RequestInit` (example):

```ts
await client.call(
    "greet",
    { name: "World" },
    { credentials: "include", headers: { Authorization: "Bearer ..." } },
);
```

## Agent playbook (how to “act”)

- **Add a new HTTP RPC**:
    - Add a new key to your `Events` type.
    - Register it via `server.on({ event: "...", schema?, handler })`.
    - Call it with `client.call("...", input)`.
- **Validate inputs**: always provide `schema` for anything exposed publicly.
- **Set headers/cookies/status**: use `response.header(...)`, `response.cookie(...)`, `response.code(...)`.
- **Read request headers/cookies**: use `request.headers().get(...)` and `request.cookies().get(...)`.
- **Avoid breaking changes**:
    - Do not change existing event names or input shapes without coordinating with the client.
    - Keep the HTTP endpoint stable (`POST` JSON body `{ event, input }`).

## Package surface (exports)

From the package entrypoint:

- **Classes**
    - `LixnetServer`
    - `LixnetClient`
    - `LixnetPeer`
    - `LixnetResponse`
- **Types**
    - `LXN_ServerClient_EventType`
    - `LXNServerHandler`
    - `FunctionInput`
    - `LXN_ServerClient_Request` (alias of `LixnetRequest`)
    - `LixnetRequest`, `LixnetCookies`, `LixnetHeaders`

## HTTP RPC: mental model

### The “events” type

Both the server and client are generic over an `Events` object type (`LXN_ServerClient_EventType` is just `object`).

Each key is an event name and each value is a **function type** describing the RPC signature:

- Input type is `FunctionInput<Events[K]>` (the function’s first parameter type).
- Output type is `Awaited<ReturnType<Events[K]>>`.

This is how Lixnet achieves end-to-end typing without codegen: you define an `Events` type in your app and use it for both server and client.

### Handler input shape (important)

Internally, the server calls the user’s handler with:

- **validated user input** (spread from `input`)
- plus injections:
    - `request: LixnetRequest` (a proxied Request)
    - `response: LixnetResponse` (the mutable accumulator)

This is encoded in `src/lib/server.ts` as:

- `FunctionInput<Events[TName]> & { request: LixnetRequest, response: LixnetResponse }`

If you ever change injection names/types, it’s a breaking change.

### Handler examples (common patterns)

#### Returning data vs “void”

If your handler returns `undefined`/`null`, Lixnet will not set `.data(...)` automatically. If you want an explicit `data`, return it.

```ts
server.on({
    event: "noOp",
    handler: async ({ response }) => {
        response.code(204);
        // return undefined; // no {data} payload
    },
});
```

#### Setting status codes

```ts
server.on({
    event: "createUser",
    schema: z.object({ email: z.string().email() }),
    handler: async ({ email, response }) => {
        response.code(201);
        return { id: "user_123", email };
    },
});
```

#### Cookies

```ts
server.on({
    event: "login",
    schema: z.object({ token: z.string() }),
    handler: async ({ token, request, response }) => {
        const existing = request.cookies().get("session")?.value;
        if (existing) response.deleteCookie("session", { path: "/" });
        response.cookie("session", token, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
        });
        return { ok: true as const };
    },
});
```

#### Headers (including append/delete)

```ts
server.on({
    event: "corsPing",
    handler: async ({ response }) => {
        response.header("access-control-allow-origin", "*");
        response.header("access-control-allow-methods", "POST, OPTIONS");
        return { ok: true as const };
    },
});
```

### Request flow

`LixnetServer.handle(request: Request)`:

1. Clones the incoming `Request` (`request.clone()`) because parsing consumes the body.
2. Creates a `LixnetResponse` instance, which accumulates:
    - `data` or `error`
    - status code
    - staged headers to set/delete
    - staged cookies to set/delete
3. Parses JSON body and validates it’s an object shaped like:
    - `event` (required)
    - `input` (required; can be any JSON)
4. Looks up the registered event handler by `event` name.
5. If a Zod schema was provided at registration time, parses `input` using `schema.parse(...)`.
6. Wraps the cloned `Request` into a `LixnetRequest` proxy via `wrapLixnetRequest(...)`:
    - `request.cookies()` gives a Next.js-like cookie API backed by the request snapshot plus staged response mutations.
    - `request.headers()` gives a Next.js-like headers API backed by the request snapshot plus staged response mutations.
7. Calls the handler with:
    - validated input fields spread into the handler input object
    - `request` (the wrapped request)
    - `response` (the same `LixnetResponse` used to build the final Response)
8. If the handler returns a non-`null`/non-`undefined` value, it is set as `data`.
9. Returns `response.format()` which produces a real `Response`.

### HTTP wire format (must stay stable)

Inbound:

```json
{ "event": "string", "input": {} }
```

Outbound:

- Success:

```json
{ "data": {} }
```

- Error:

```json
{ "error": "string" }
```

### Response formatting

Formatting is intentionally pluggable:

- `LixnetServer` accepts an optional `formatter` in its constructor.
- If not provided, it uses `getDefaultFormatter(defaultHeaders)` which:
    - Ensures JSON content type.
    - Applies staged header sets and deletes.
    - Converts staged cookie operations into one or more `Set-Cookie` headers.
    - Serializes response as:
        - `{ error: string }` with status `responseCode || 500` when `.error(...)` was called.
        - `{ data: any }` with status `responseCode || 200` otherwise.

Cookie values are validated to reject `;`, `=`, CR, or LF to reduce header injection risk.

### Error behavior (important for compatibility)

`LixnetServer.handle(...)` currently uses a small set of string errors:

- `"Invalid JSON"`
- `"Invalid request body"`
- `"Event not found"`
- `"Input not found"`
- `"Invalid input"` (Zod schema failure)
- `"Handler error"` (thrown handler or unexpected errors)

If you change these strings, you may break downstream consumers that match on them. Prefer adding structured error codes later (new field) rather than changing the existing `error` string.

### Observability caveat

At the moment, `debugLog` only logs “Invalid JSON” (see `src/lib/server.ts`). Handler errors are mapped to `"Handler error"` without logging the original exception. If you improve this, do it additively (e.g. optional logger hook) to avoid leaking sensitive details by default.

### Default headers

`LixnetServer` accepts `defaultHeaders` which are included in every formatted response (unless deleted later by the handler).

## HTTP Client: mental model

`LixnetClient` is a minimal fetch wrapper:

- Constructed with `{ rpcUrl }`.
- `call(event, input, options?)` sends:
    - method `POST`
    - JSON body `{ event, input }`
    - header `Content-Type: application/json`
    - spreads user-provided `RequestInit` `options` last (so callers can override headers/mode/etc.)
- Expects JSON response shaped like:
    - `{ error: string }` OR `{ data: any }`
- Throws `Error(json.error)` when `error` exists, otherwise returns `data`.

Notes:

- There is no built-in retry, timeout, or streaming.
- If you add additional fields to the server response, keep `{ error }` / `{ data }` stable.

### Client examples

#### Absolute vs relative `rpcUrl`

- In browsers, `"/rpc"` targets the current origin.
- In server-side scripts, prefer a full URL like `"http://localhost:3000/rpc"`.

```ts
const browserClient = new LixnetClient<Events>({ rpcUrl: "/rpc" });
const nodeClient = new LixnetClient<Events>({
    rpcUrl: "http://localhost:3000/rpc",
});
```

#### Error handling

`client.call(...)` throws `Error(json.error)` when the server responds with `{ error }`.

```ts
try {
    await client.call("greet", { name: "" });
} catch (e) {
    // e is Error("Invalid input") (when schema fails)
    console.error(e);
}
```

## Request/Response helpers

### `LixnetResponse`

`LixnetResponse` is a mutable accumulator used during request handling:

- `.data(...)` sets the payload.
- `.error(...)` sets an error string (and toggles formatted shape to `{ error }`).
- `.code(...)` sets the status code used by the formatter.
- `.header(...)`, `.deleteHeader(...)`, `.headers(...)` stage header operations.
- `.cookie(...)`, `.deleteCookie(...)` stage cookie operations.
- `.format()` produces a `Response` (by calling the configured formatter).

### `LixnetRequest` / `wrapLixnetRequest`

`wrapLixnetRequest(...)` returns a `Proxy` over the `Request` which:

- Adds `cookies()` returning `LixnetCookies`.
- Adds `headers()` returning `LixnetHeaders`.

Both wrappers are “read from request snapshot, write into response staging”:

- Reading comes from a snapshot copy (so handler mutations do not alter the inbound request).
- Writing uses callbacks that call into `LixnetResponse` staging stores.

This emulates the ergonomic parts of Next.js’ server runtime without importing Next.js.

## WebSocket peer: mental model

`LixnetPeer<ThisToThereEvents, ThereToThisEvents, SocketType>` provides:

- **Outgoing calls**: `peer.call(event, input, { callback? })`
    - Sends `{ event, data, rf? }` over the socket (JSON string).
    - If `callback` is provided, it stores it in `rb` keyed by a generated id (`rf`), and expects the remote to reply with `{ rb: <id>, data: <result> }`.
- **Incoming handlers**: `peer.on(event, handler)`
    - Stores handler functions in `eventHandlers`.
- **Inbound dispatch**: `peer.handle({ data, socket })`
    - Accepts incoming `data` (typically `event.data` from a WS message).
    - Supports:
        - Normal events: JSON string → `{ event, data, rf? }`
        - Callback responses: `{ rb, data }`
        - Chunked transmissions (see below)

### WebSocket wire formats (must stay stable)

Normal outbound event (no callback):

```json
{ "event": "name", "data": {} }
```

Normal outbound event (with callback id):

```json
{ "event": "name", "data": {}, "rf": "LX-..." }
```

Callback response:

```json
{ "rb": "LX-...", "data": {} }
```

## WebSockets: complete example (`LixnetPeer`)

Define two contracts:

- `ThisToThereEvents`: what _this_ side can send
- `ThereToThisEvents`: what _this_ side can receive/handle

### Server-side example (Bun WebSocket)

```ts
import { LixnetPeer } from "lixnet";

type ServerToClient = {
    notify: (input: { message: string }) => void;
};

type ClientToServer = {
    ping: (input: { t: number }) => Promise<{ ok: true }>;
};

const peer = new LixnetPeer<ServerToClient, ClientToServer>();

peer.on("ping", async ({ t, socket }) => {
    // socket is whatever you pass into peer.handle(...)
    return { ok: true };
});

// Example wiring: you must set the socket and forward messages into peer.handle(...)
peer.setSocket(ws);
ws.addEventListener("message", (event) => {
    peer.handle({ data: event.data, socket: ws });
});
```

### Client-side example (browser WebSocket)

```ts
import { LixnetPeer } from "lixnet";

type ClientToServer = {
    ping: (input: { t: number }) => Promise<{ ok: true }>;
};

type ServerToClient = {
    notify: (input: { message: string }) => void;
};

const ws = new WebSocket("ws://localhost:3000/ws");
const peer = new LixnetPeer<ClientToServer, ServerToClient>();

peer.setSocket(ws);
ws.addEventListener("message", (event) => {
    peer.handle({ data: event.data, socket: ws });
});

peer.on("notify", ({ message }) => {
    console.log("notify:", message);
});

await peer.call(
    "ping",
    { t: Date.now() },
    {
        callback: (result) => {
            console.log("pong:", result.ok);
        },
    },
);
```

### Chunking / large payload transmissions

If `transmissionLimit !== -1` and the outgoing JSON would exceed the limit, `call(...)` switches to a chunked protocol:

1. Sender emits a “starter” message `{ tId, event, chunkCount, rf? }`.
2. Receiver stores an entry in `transmissions[tId]` and replies `{ launch: true, tId }`.
3. Sender then sends chunk messages as strings shaped like:
    - `"${tId}.${chunkIndex}.${chunkPayload}"`
4. Receiver collects chunks, assembles them in order, parses JSON, then dispatches to the registered handler.

There is a basic “abandoned transmission” / “slow transmission abuse” cleanup mechanism via `transmissionSecurityCheck`.

If you touch this protocol, keep it backwards compatible or bump major version (it’s wire-level behavior).

### Chunking protocol details

- **Starter** (JSON string):
    - `{ tId: "LX-...", event: "name", chunkCount: number, rf?: "LX-..." }`
- **Launch** (JSON string):
    - `{ launch: true, tId: "LX-..." }`
- **Chunk** (raw string, not JSON):
    - `"LX-....<dot><chunkIndex>.<chunkData>"`

Security/cleanup notes:

- Receiver schedules `transmissionSecurityCheck` after 30s on starter receipt.
- The check prunes:
    - abandoned transmissions (no chunks or last chunk > 30s ago)
    - very slow transmissions (estimated completion > 5 minutes)

## How to extend safely

- **Adding new features**:
    - Prefer additive changes (new fields) over changing existing shapes/strings.
    - Keep `LixnetServer.handle(...)` accepting `{ event, input }` unchanged.
    - Keep `LixnetClient.call(...)` returning `data` and throwing on `error`.
- **Changing cookie/header behavior**:
    - Be careful: `wrapLixnetRequest` merges staged response headers/cookies into the read APIs; this is relied upon for “read your writes” inside a handler.
    - Ensure header delete semantics remain case-insensitive (uses `toLowerCase()`).
- **Changing formatter**:
    - Default formatter must remain usable in any Fetch-compatible runtime (Node/Next/Bun/Workers).
    - Preserve multiple `Set-Cookie` support (uses `headers.append`).
- **Versioning**:
    - Wire protocol changes (HTTP response shape, WS messages/chunking) should be treated as breaking.

## Where to look first

- `src/lib/server.ts`: HTTP RPC, Zod validation, request/response injection.
- `src/lib/util/request.ts`: request wrappers (cookies/headers), and the `wrapLixnetRequest` proxy.
- `src/lib/util/response.ts`: response accumulator.
- `src/lib/util/getDefaultFormatter.ts`: default serialization, headers/cookies.
- `src/lib/client.ts`: HTTP client.
- `src/lib/peer.ts`: WebSocket peer + chunking protocol.
