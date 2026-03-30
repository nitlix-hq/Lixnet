import { z } from "zod";
import LixnetLog from "./util/log";
import type {
    DebugLogger,
    FunctionInput,
    FunctionOutput,
    LXNServerHandler,
    LXN_ServerClient_EventType,
} from "./types";
import { LixnetResponse } from "./util/response";
import { LixnetRequest, wrapLixnetRequest } from "./util/request";
import getDefaultFormatter from "./util/getDefaultFormatter";

type LXNServerEventInput<
    Events extends LXN_ServerClient_EventType,
    TName extends keyof Events
> = {
    event: TName;
    handler: LXNServerHandler<
        FunctionInput<Events[TName]> & { request: LixnetRequest, response: LixnetResponse },
        FunctionOutput<Events[TName]>
    >;
    schema?: z.ZodSchema<any>;
};

export default class LixnetServer<Events extends LXN_ServerClient_EventType> {
    private events: Record<string, LXNServerEventInput<Events, keyof Events>> =
        {};
    private logger: DebugLogger = LixnetLog;
    private debugLog: boolean = false;
    private formatter: (this: LixnetResponse) => Response;

    public constructor({
        debugLog = false,
        logger,
        formatter,
        defaultHeaders = {},
    }: {
        debugLog?: boolean;
        logger?: DebugLogger;
        formatter?: (this: LixnetResponse) => Response;
        defaultHeaders?: Record<string, string>
    }) {
        this.debugLog = debugLog;
        logger ? (this.logger = logger) : "";
        this.formatter = formatter ?? getDefaultFormatter(defaultHeaders);
    }

    public on<K extends keyof Events & string>(
        input: LXNServerEventInput<Events, K> | LXNServerEventInput<Events, K>[]
    ) {
        if (Array.isArray(input)) {
            input.forEach((event) => {
                this.events[event.event] = event;
            });
        } else {
            this.events[input.event] = input;
        }
    }

    public async handle(request: Request) {
        const requestClone = request.clone();

        const response = new LixnetResponse({ formatter: this.formatter });

        let jsonData;
        try {
            jsonData = (await request.json()) as any;
        } catch (error) {
            this.debugLog
                ? this.logger({
                    error: true,
                    message: "Invalid JSON",
                })
                : "";

            response.error("Invalid JSON");
            return response.format();
        }

        if (
            jsonData === null ||
            typeof jsonData !== "object" ||
            Array.isArray(jsonData)
        ) {
            response.error("Invalid request body");
            return response.format();
        }

        if (!jsonData.event) {
            response.error("Event not found");
            return response.format();
        }

        if (!("input" in jsonData)) {
            response.error("Input not found");
            return response.format();
        }

        const event = this.events[jsonData.event];
        if (!event) {
            response.error("Event not found");
            return response.format();
        }

        try {
            const validatedInput = event.schema
                ? event.schema.parse(jsonData.input)
                : jsonData.input;

            try {
                const newRequest: LixnetRequest =
                    wrapLixnetRequest(requestClone, {
                        header: response.header.bind(response),
                        deleteHeader: response.deleteHeader.bind(response),
                        cookie: response.cookie.bind(response),
                        deleteCookie: response.deleteCookie.bind(response),
                        responseHeaders: response.responseHeaders,
                        responseHeaderDeletes: response.responseHeaderDeletes,
                        responseCookies: response.responseCookies,
                    });


                const data = await event.handler({
                    ...validatedInput,
                    request: newRequest,
                    response: response,
                });

                //check data isnt void/null/undefined
                if (!(data === undefined || data === null)) {
                    response.data(data);
                }

                return response.format();
            } catch (error) {
                response.error("Handler error");
                return response.format();
            }
        } catch (error) {
            if (error instanceof z.ZodError) {
                response.error("Invalid input");
                return response.format();
            }
            response.error("Invalid input");
            return response.format();
        }
    }
}
