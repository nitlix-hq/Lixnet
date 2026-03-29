type CookieOptions = {
    domain?: string;
    path?: string;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
};

export default class LixnetResponse {
    public responseData: any;
    public responseError: string | null = null;
    public responseCode: number = 200;
    public responseHeaders: Record<string, string> = {};
    public responseCookies: Record<string, {
        type: "value" | "delete";
        value?: string;
        options?: CookieOptions;
    }> = {};

    public constructor({ formatter }: { formatter?: (this: LixnetResponse) => Response }) {
        this.responseData = null;
        this.format = formatter ?? (() => {
            const headers = new Headers();
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

            return Response.json(this.responseError ? { error: this.responseError } : { data: this.responseData }, {
                status: this.responseCode ? this.responseCode : this.responseError ? 400 : 200,
                headers: headers
            });
        })
    }

    public data(data: any): void {
        this.responseData = data;
    }

    public header(headerName: string, headerValue: string): void {
        this.responseHeaders[headerName] = headerValue;
    }

    public error(error: string): void {
        this.responseError = error;
    }

    public code(code: number): void {
        this.responseCode = code;
    }

    public headers(headers: Record<string, string>): void {
        for (const [headerName, headerValue] of Object.entries(headers)) {
            this.header(headerName, headerValue);
        }
    }

    public cookie(cookieName: string, cookieValue: string, cookieOptions: CookieOptions): void {
        this.responseCookies[cookieName] = {
            type: "value",
            value: cookieValue,
            options: cookieOptions,
        };
    }

    public deleteCookie(cookieName: string): void {
        this.responseCookies[cookieName] = {
            type: "delete",
        };
    }

    public format: (this: LixnetResponse) => Response;

    public setFormatter(formatter: (this: LixnetResponse) => Response): void {
        this.format = formatter;
    }
}