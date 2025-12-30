import type { FunctionInput, LXN_ServerClient_EventType } from "./types";

export default class LixnetClient<Events extends LXN_ServerClient_EventType> {
    private rpcUrl: string;

    public constructor({ rpcUrl }: { rpcUrl: string }) {
        this.rpcUrl = rpcUrl;
    }

    public async call<K extends keyof Events>(
        event: K,
        input: FunctionInput<Events[K]>,
        options: RequestInit = {}
    ): Promise<Awaited<ReturnType<Events[K]>>> {
        const response = await fetch(this.rpcUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ event, input }),
            ...options,
        });

        const json = await response.json();

        if (json.error) {
            throw new Error(json.error);
        }

        return json.data;
    }
}
