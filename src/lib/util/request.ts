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
    private readonly mut?: {
        setCookie: (name: string, value: string, options?: unknown) => void;
        deleteCookie: (name: string, options?: unknown) => void;
        getStaged: () => Record<
            string,
            { type: "value" | "delete"; value?: string; options?: unknown }
        >;
    };

    constructor(
        cookieHeader: string | null,
        mut?: {
            setCookie: (name: string, value: string, options?: unknown) => void;
            deleteCookie: (name: string, options?: unknown) => void;
            getStaged: () => Record<
                string,
                { type: "value" | "delete"; value?: string; options?: unknown }
            >;
        }
    ) {
        this.map = parseCookieHeader(cookieHeader);
        this.mut = mut;
    }

    get size(): number {
        return this.map.size;
    }

    get(name: string): RequestCookie | undefined {
        const staged = this.mut?.getStaged()?.[name];
        if (staged) {
            if (staged.type === "delete") return undefined;
            return { name, value: staged.value ?? "" };
        }
        const value = this.map.get(name);
        if (value === undefined) return undefined;
        return { name, value };
    }

    getAll(): RequestCookie[];
    getAll(name: string): RequestCookie[];
    getAll(name?: string): RequestCookie[] {
        if (name === undefined) {
            const base = [...this.map.entries()].map(([n, value]) => ({
                name: n,
                value,
            }));
            const staged = this.mut?.getStaged?.();
            if (!staged) return base;
            const out = new Map(base.map((c) => [c.name, c.value]));
            for (const [n, v] of Object.entries(staged)) {
                if (v.type === "delete") out.delete(n);
                else out.set(n, v.value ?? "");
            }
            return [...out.entries()].map(([n, value]) => ({ name: n, value }));
        }
        const staged = this.mut?.getStaged()?.[name];
        if (staged) {
            if (staged.type === "delete") return [];
            return [{ name, value: staged.value ?? "" }];
        }
        const value = this.map.get(name);
        if (value === undefined) return [];
        return [{ name, value }];
    }

    has(name: string): boolean {
        const staged = this.mut?.getStaged()?.[name];
        if (staged) return staged.type !== "delete";
        return this.map.has(name);
    }

    set(name: string, value: string, options?: unknown): void {
        if (!this.mut) {
            throw new Error("cookies().set is not available in this context");
        }
        this.mut.setCookie(name, value, options);
    }

    delete(name: string, options?: unknown): void {
        if (!this.mut) {
            throw new Error("cookies().delete is not available in this context");
        }
        this.mut.deleteCookie(name, options);
    }

    [Symbol.iterator](): IterableIterator<[string, RequestCookie]> {
        const map = new Map(this.map);
        const staged = this.mut?.getStaged?.();
        if (staged) {
            for (const [n, v] of Object.entries(staged)) {
                if (v.type === "delete") map.delete(n);
                else map.set(n, v.value ?? "");
            }
        }
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
    private readonly mut?: {
        setHeader: (name: string, value: string) => void;
        appendHeader: (name: string, value: string) => void;
        deleteHeader: (name: string) => void;
        getStaged: () => Record<string, string>;
    };

    constructor(
        headers: Headers,
        mut?: {
            setHeader: (name: string, value: string) => void;
            appendHeader: (name: string, value: string) => void;
            deleteHeader: (name: string) => void;
            getStaged: () => Record<string, string>;
        }
    ) {
        this.h = new Headers(headers);
        this.mut = mut;
    }

    get(name: string): string | null {
        const staged = this.mut?.getStaged?.();
        if (staged && name in staged) return staged[name] ?? null;
        return this.h.get(name);
    }

    has(name: string): boolean {
        const staged = this.mut?.getStaged?.();
        if (staged && name in staged) return true;
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
        const merged = new Headers(this.h);
        const staged = this.mut?.getStaged?.();
        if (staged) {
            for (const [k, v] of Object.entries(staged)) merged.set(k, v);
        }
        return merged.entries();
    }

    keys(): IterableIterator<string> {
        const merged = new Headers(this.h);
        const staged = this.mut?.getStaged?.();
        if (staged) {
            for (const [k, v] of Object.entries(staged)) merged.set(k, v);
        }
        return merged.keys();
    }

    values(): IterableIterator<string> {
        const merged = new Headers(this.h);
        const staged = this.mut?.getStaged?.();
        if (staged) {
            for (const [k, v] of Object.entries(staged)) merged.set(k, v);
        }
        return merged.values();
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
        return this.entries();
    }

    set(name: string, value: string): void {
        if (!this.mut) throw new Error("headers().set is not available in this context");
        this.mut.setHeader(name, value);
    }

    append(name: string, value: string): void {
        if (!this.mut) throw new Error("headers().append is not available in this context");
        this.mut.appendHeader(name, value);
    }

    delete(name: string): void {
        if (!this.mut) throw new Error("headers().delete is not available in this context");
        this.mut.deleteHeader(name);
    }
}


export type LixnetRequest = Omit<Request, "headers"> & {
    cookies(): ReadonlyRequestCookies;
    headers(): ReadonlyHeaders;
};

/** Used by the server only; not part of the public package API. */
export function wrapLixnetRequest(
    request: Request,
    response: {
        header: (name: string, value: string) => void;
        deleteHeader: (name: string) => void;
        cookie: (name: string, value: string, options?: any) => void;
        deleteCookie: (name: string, options?: any) => void;
        responseHeaders: Record<string, string>;
        responseHeaderDeletes: Set<string>;
        responseCookies: Record<
            string,
            { type: "value" | "delete"; value?: string; options?: unknown }
        >;
    }
): LixnetRequest {
    const snapshot = new Headers(request.headers);
    const cookieMut = {
        setCookie: (name: string, value: string, options?: unknown) =>
            response.cookie(name, value, options),
        deleteCookie: (name: string, options?: unknown) =>
            response.deleteCookie(name, options),
        getStaged: () => response.responseCookies,
    };
    const headerMut = {
        setHeader: (name: string, value: string) => response.header(name, value),
        appendHeader: (name: string, value: string) => {
            if (response.responseHeaderDeletes.has(name.toLowerCase())) {
                response.responseHeaderDeletes.delete(name.toLowerCase());
            }
            const existing =
                response.responseHeaders[name] ??
                response.responseHeaders[name.toLowerCase()] ??
                "";
            response.header(name, existing ? `${existing}, ${value}` : value);
        },
        deleteHeader: (name: string) => response.deleteHeader(name),
        getStaged: () => {
            const out: Record<string, string> = { ...response.responseHeaders };
            for (const k of response.responseHeaderDeletes) {
                delete out[k];
            }
            return out;
        },
    };
    return new Proxy(request, {
        get(target, prop, receiver) {
            if (prop === "cookies") {
                return function cookies() {
                    return new ReadonlyRequestCookies(
                        snapshot.get("cookie"),
                        cookieMut
                    );
                };
            }
            if (prop === "headers") {
                return function headers() {
                    return new ReadonlyHeaders(snapshot, headerMut);
                };
            }
            return Reflect.get(target, prop, receiver);
        },
    }) as unknown as LixnetRequest;
}