import { LixnetResponse } from "./response";

export default function (defaultHeaders: Record<string, string>) {
    function formatter(this: LixnetResponse) {
        const headers = new Headers({
            "Content-Type": "application/json",
            ...defaultHeaders,
        });
        for (const [headerName, headerValue] of Object.entries(this.responseHeaders)) {
            headers.set(headerName, headerValue);
        }
        for (const headerName of this.responseHeaderDeletes) {
            headers.delete(headerName);
        }
        for (const [cookieName, cookie] of Object.entries(this.responseCookies)) {
            if (cookie.type === "value") {
                const opts = cookie.options ?? {};
                //detect value escapes
                if (cookie.value?.includes(";") || cookie.value?.includes("=") || cookie.value?.includes("\n") || cookie.value?.includes("\r")) {
                    throw new Error("Cookie value contains invalid characters");
                }
                const parts: string[] = [`${cookieName}=${cookie.value ?? ""}`];
                if (opts.domain) parts.push(`Domain=${opts.domain}`);
                if (opts.path) parts.push(`Path=${opts.path}`);
                if ("maxAge" in opts && typeof (opts as any).maxAge === "number") {
                    parts.push(`Max-Age=${(opts as any).maxAge}`);
                }
                if (opts.httpOnly) parts.push("HttpOnly");
                if (opts.secure) parts.push("Secure");
                if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
                headers.append("Set-Cookie", parts.join("; "));
            }
            else if (cookie.type === "delete") {
                const opts = (cookie.options ?? {}) as any;
                const parts: string[] = [`${cookieName}=`,"Max-Age=0"];
                parts.push(`Path=${opts.path ?? "/"}`);
                if (opts.domain) parts.push(`Domain=${opts.domain}`);
                if (opts.httpOnly) parts.push("HttpOnly");
                if (opts.secure) parts.push("Secure");
                if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
                headers.append("Set-Cookie", parts.join("; "));
            }
            else {
                throw new Error(`Unknown cookie type: ${cookie.type}`);
            }
        }

        return Response.json({
            data: this.responseData,
        }, {
            status: this.responseCode ?? 200,
            headers: headers,
        });
    };

    return formatter;
} 