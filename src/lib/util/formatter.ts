import LixnetResponse from "./response";

export default function jsonFormatter(this: LixnetResponse) {
    const headers = new Headers({
        "Content-Type": "application/json",
    });
    for (const [headerName, headerValue] of Object.entries(this.responseHeaders)) {
        headers.set(headerName, headerValue);
    }
    for (const [cookieName, cookie] of Object.entries(this.responseCookies)) {
        if (cookie.type === "value") {
            const opts = cookie.options ?? {};
            headers.set('Set-Cookie', `${cookieName}=${cookie.value}; ${Object.entries(opts).map(([key, value]) => `${key}=${value}`).join('; ')}`);
        }
        else if (cookie.type === "delete") {
            headers.set('Set-Cookie', `${cookieName}=; Max-Age=0; Path=/; HttpOnly; Secure; SameSite=Strict`);
        }
        else {
            throw new Error(`Unknown cookie type: ${cookie.type}`);
        }
    }

    return Response.json({
        data: this.responseData,
    }, {
        status: 200,
        headers: headers,
    });
} 