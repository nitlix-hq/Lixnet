export type RequestCookie = {
    name: string;
    value: string;
};

function decodeCookieValue(raw: string): string {
    try {
        return decodeURIComponent(raw.replace(/\+/g, " "));
    } catch {
        return raw;
    }
}

function parseCookieHeader(header: string | null): Map<string, string> {
    const map = new Map<string, string>();
    if (!header) return map;
    const segments = header.split(";");
    for (const segment of segments) {
        const trimmed = segment.trim();
        if (!trimmed) continue;
        const eq = trimmed.indexOf("=");
        if (eq === -1) {
            map.set(trimmed, "");
        } else {
            const name = trimmed.slice(0, eq).trim();
            const value = decodeCookieValue(trimmed.slice(eq + 1).trim());
            map.set(name, value);
        }
    }
    return map;
}

/**
 * Read-only view of request cookies (Next.js `ReadonlyRequestCookies`).
 */
export class ReadonlyRequestCookies {
    private readonly map: Map<string, string>;

    constructor(cookieHeader: string | null) {
        this.map = parseCookieHeader(cookieHeader);
    }

    get size(): number {
        return this.map.size;
    }

    get(name: string): RequestCookie | undefined {
        const value = this.map.get(name);
        if (value === undefined) return undefined;
        return { name, value };
    }

    getAll(): RequestCookie[];
    getAll(name: string): RequestCookie[];
    getAll(name?: string): RequestCookie[] {
        if (name === undefined) {
            return [...this.map.entries()].map(([n, value]) => ({
                name: n,
                value,
            }));
        }
        const value = this.map.get(name);
        if (value === undefined) return [];
        return [{ name, value }];
    }

    has(name: string): boolean {
        return this.map.has(name);
    }

    [Symbol.iterator](): IterableIterator<[string, RequestCookie]> {
        const map = this.map;
        function* iter(): IterableIterator<[string, RequestCookie]> {
            for (const [n, value] of map.entries()) {
                yield [n, { name: n, value }];
            }
        }
        return iter();
    }
}

/**
 * Read-only `Headers` view (Next.js `ReadonlyHeaders`).
 * Wraps a cloned `Headers` instance so callers cannot mutate the snapshot.
 */
export class ReadonlyHeaders {
    private readonly h: Headers;

    constructor(headers: Headers) {
        this.h = new Headers(headers);
    }

    get(name: string): string | null {
        return this.h.get(name);
    }

    has(name: string): boolean {
        return this.h.has(name);
    }

    getSetCookie(): string[] {
        const anyHeaders = this.h as Headers & {
            getSetCookie?: () => string[];
        };
        if (typeof anyHeaders.getSetCookie === "function") {
            return anyHeaders.getSetCookie();
        }
        const single = this.h.get("set-cookie");
        return single ? [single] : [];
    }

    entries(): IterableIterator<[string, string]> {
        return this.h.entries();
    }

    keys(): IterableIterator<string> {
        return this.h.keys();
    }

    values(): IterableIterator<string> {
        return this.h.values();
    }

    forEach(
        callbackfn: (
            value: string,
            name: string,
            parent: ReadonlyHeaders
        ) => void,
        thisArg?: unknown
    ): void {
        const self = this;
        this.h.forEach(function (value, name) {
            callbackfn.call(thisArg ?? self, value, name, self);
        });
    }

    [Symbol.iterator](): IterableIterator<[string, string]> {
        return this.h[Symbol.iterator]();
    }
}


export type LixnetRequest = Omit<Request, "headers"> & {
    cookies(): ReadonlyRequestCookies;
    headers(): ReadonlyHeaders;
};

/** Used by the server only; not part of the public package API. */
export function wrapLixnetRequest(request: Request): LixnetRequest {
    const snapshot = new Headers(request.headers);
    return new Proxy(request, {
        get(target, prop, receiver) {
            if (prop === "cookies") {
                return function cookies() {
                    return new ReadonlyRequestCookies(snapshot.get("cookie"));
                };
            }
            if (prop === "headers") {
                return function headers() {
                    return new ReadonlyHeaders(snapshot);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    }) as unknown as LixnetRequest;
}