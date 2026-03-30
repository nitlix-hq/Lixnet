export type CookieOptions = {
    domain?: string;
    path?: string;
    maxAge?: number;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
};

export type CookieDeleteOptions = {
    domain?: string;
    path?: string;
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: 'lax' | 'strict' | 'none';
};

export class LixnetResponse {
    public responseData: any;
    public responseError: string | null = null;
    public responseCode: number = 200;
    public responseHeaders: Record<string, string> = {};
    public responseHeaderDeletes: Set<string> = new Set();
    public responseCookies: Record<string, {
        type: "value" | "delete";
        value?: string;
        options?: CookieOptions | CookieDeleteOptions;
    }> = {};

    public constructor({ formatter }: { formatter: (this: LixnetResponse) => Response }) {
        this.responseData = null;
        this.format = formatter;
    }

    public data(data: any): void {
        this.responseData = data;
    }

    public header(headerName: string, headerValue: string): void {
        this.responseHeaders[headerName] = headerValue;
        this.responseHeaderDeletes.delete(headerName.toLowerCase());
    }

    public deleteHeader(headerName: string): void {
        delete this.responseHeaders[headerName];
        delete this.responseHeaders[headerName.toLowerCase()];
        this.responseHeaderDeletes.add(headerName.toLowerCase());
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

    public cookie(cookieName: string, cookieValue: string, cookieOptions?: CookieOptions): void {
        this.responseCookies[cookieName] = {
            type: "value",
            value: cookieValue,
            options: cookieOptions,
        };
    }

    public deleteCookie(cookieName: string, options?: CookieDeleteOptions): void {
        this.responseCookies[cookieName] = {
            type: "delete",
            options,
        };
    }

    public format: (this: LixnetResponse) => Response;

    public setFormatter(formatter: (this: LixnetResponse) => Response): void {
        this.format = formatter;
    }
}