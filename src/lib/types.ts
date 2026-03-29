import { LixnetRequest } from "./util/request";
import { LixnetResponse } from "./util/response";

export type DebugLogger = ({
    error,
    message,
}: {
    error?: boolean;
    message: string;
}) => void;

export type FunctionInput<T> = T extends (input: infer TInput) => any
    ? TInput
    : { _TYPE_ERROR_: "Event definition must be a function type" };

export type FunctionOutput<T> = T extends (...args: any) => infer R
    ? Awaited<R>
    : { _TYPE_ERROR_: "Event definition must be a function type" };

export type LXNServerHandler<Input, Output> = (
    input: Input
) => Promise<Output> | Output;

export type LXN_ServerClient_EventType = object;

/** The inbound request passed to handlers (Next.js–style `cookies()` / `headers()`). */
export type { LixnetRequest as LXN_ServerClient_Request } from "./util/request";

export type LixnetServerInjections = {
    request: LixnetRequest;
    response: LixnetResponse;
}