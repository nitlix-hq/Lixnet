export type PeerEventInput<T> = T extends (input: infer TInput) => any
    ? TInput
    : never;

function createLixnetId() {
    return "LX-" + Math.random().toString(36).substring(2, 15);
}

type Caller<ThisToThereEvents extends Record<string, any>> = <
    K extends keyof ThisToThereEvents
>(
    event: K,
    input: PeerEventInput<ThisToThereEvents[K]>,
    options?: {
        callback:
        | ((data: Awaited<ReturnType<ThisToThereEvents[K]>>) => any)
        | null;
    }
) => Promise<void>;

export default class LixnetPeer<
    ThisToThereEvents extends Record<string, any>,
    ThereToThisEvents extends Record<string, any>,
    SocketType extends WebSocket = WebSocket
> {
    socket: SocketType | null = null;
    rb: {
        [key: string]: {
            method: keyof ThisToThereEvents;
            callback: (
                data: Awaited<
                    ReturnType<ThisToThereEvents[keyof ThisToThereEvents]>
                >
            ) => any;
        };
    } = {} as any;
    transmissionLimit: number = -1;
    transmissionChunksLimit: number = 20;

    public setTransmissionChunksLimit(limit: number) {
        this.transmissionChunksLimit = limit;
    }

    public call: Caller<ThisToThereEvents> = async (
        event,
        data,
        { callback } = { callback: null }
    ) => {
        if (!this.socket) throw new Error("LIXNET - Socket not set");

        let rf: string | null = null;

        if (typeof callback === "function") {
            rf = createLixnetId();

            this.rb[rf] = {
                method: event,
                callback: callback,
            };
        }

        let dataToSend: any = {
            event,
            data,
        };

        if (rf) dataToSend.rf = rf;

        dataToSend = JSON.stringify(dataToSend) as string;

        // No callback needed, just send
        if (
            this.transmissionLimit !== -1 &&
            dataToSend.length > this.transmissionLimit - 50
        ) {
            // Send in chunks
            let dataString = JSON.stringify(data);

            const tId = createLixnetId();

            const limits = this.getChunkLimits({
                tId,
                dataLength: dataString.length,
            });

            // Send transmission id and rf
            const sendData: any = {
                tId,
                event,
                chunkCount: limits.length,
            };

            if (rf) sendData.rf = rf;

            this.socket.send(JSON.stringify(sendData));

            const chunks: Record<number, string> = {};

            for (let i = 0; i < limits.length; i++) {
                if (i === limits.length - 1) {
                    chunks[i] = `${tId}.${i}.${dataString}`;
                    break;
                }
                chunks[i] = `${tId}.${i}.${dataString.slice(0, limits[i])}`;
                dataString = dataString.slice(limits[i]);
            }

            this.outgoingTransmissions[tId] = chunks;

            // Chunks sent. Complete.
            return;
        }

        this.socket.send(dataToSend);
    };

    private getChunkLimits({
        tId,
        dataLength,
    }: {
        tId: string;
        dataLength: number;
    }) {
        const limits: number[] = [];
        let chunkIndex = 0;
        while (dataLength > 0) {
            const overheadLength = `${tId}.${chunkIndex}.`.length;
            const requiredSize = this.transmissionLimit - overheadLength - 50;
            const chunkSize = Math.min(requiredSize, dataLength);
            limits.push(chunkSize);
            if (chunkSize < dataLength) {
                chunkIndex++;
                dataLength -= chunkSize;
            } else {
                dataLength = 0;
            }
        }
        return limits;
    }

    private eventHandlers: Record<
        keyof ThereToThisEvents,
        (
            input: PeerEventInput<
                ThereToThisEvents[keyof ThereToThisEvents] & {
                    socket: SocketType;
                }
            >
        ) => ReturnType<ThereToThisEvents[keyof ThereToThisEvents]>
    > = {} as any;

    public setSocket(socket: SocketType) {
        this.socket = socket;
    }

    public setTransmissionLimit(limit: number) {
        this.transmissionLimit = limit;
    }

    public on<K extends keyof ThereToThisEvents>(
        event: K,
        handler: (
            input: PeerEventInput<ThereToThisEvents[K]> & {
                socket: SocketType;
            }
        ) => ReturnType<ThereToThisEvents[K]>
    ) {
        this.eventHandlers[event] = handler as any;
    }

    transmissions: Record<
        string,
        {
            chunks: Record<number, string>;
            chunkTimes: Record<number, number>;
            chunkCount: number;
            event: keyof ThereToThisEvents;
            rf: string | null;
        }
    > = {};

    outgoingTransmissions: Record<string, Record<number, string>> = {};

    private transmissionSecurityCheck(tId: string) {
        const transmission = this.transmissions[tId];
        if (!transmission) return;

        const receivedChunks = Object.keys(transmission.chunks).length;
        const expectedChunks = transmission.chunkCount;

        // If transmission is complete, no security concern
        if (receivedChunks >= expectedChunks) {
            delete this.transmissions[tId];
            return;
        }

        // Check if transmission is likely abandoned
        const now = Date.now();
        const chunkTimes = Object.values(transmission.chunkTimes);
        const lastChunkTime = Math.max(...chunkTimes, 0);
        const timeSinceLastChunk = now - lastChunkTime;

        // If no chunks received or last chunk was more than 30 seconds ago, likely abandoned
        if (receivedChunks === 0 || timeSinceLastChunk > 30000) {
            delete this.transmissions[tId];
            return;
        }

        // Check for suspicious patterns - if chunks are coming too slowly
        if (chunkTimes.length > 1) {
            const timeIntervals = [];
            const sortedTimes = chunkTimes.sort((a, b) => a - b);

            for (let i = 1; i < sortedTimes.length; i++) {
                const current = sortedTimes[i];
                const previous = sortedTimes[i - 1];
                if (current !== undefined && previous !== undefined) {
                    timeIntervals.push(current - previous);
                }
            }

            const avgInterval =
                timeIntervals.reduce((a, b) => a + b, 0) / timeIntervals.length;
            const remainingChunks = expectedChunks - receivedChunks;
            const estimatedTimeToComplete = avgInterval * remainingChunks;

            // If estimated completion time is unreasonable (>5 minutes), likely abuse
            if (estimatedTimeToComplete > 300000) {
                delete this.transmissions[tId];
                return;
            }
        }

        // Schedule next check in 10 seconds
        setTimeout(() => {
            this.transmissionSecurityCheck(tId);
        }, 10000);
    }

    public handle({ data, socket }: { data: any; socket: SocketType }) {
        if (data.startsWith("LX-")) {
            // Transmission chunk
            const splits = data.split(".");
            const tId = splits[0];
            const chunkIndex = parseInt(splits[1]);
            const chunk = splits.slice(2).join(".");

            if (!this.transmissions[tId]) {
                // No transmission found
                return;
            }

            this.transmissions[tId].chunks[chunkIndex] = chunk;
            this.transmissions[tId].chunkTimes[chunkIndex] = Date.now();

            if (
                this.transmissions[tId].chunkCount ==
                Object.keys(this.transmissions[tId].chunks).length
            ) {
                // Transmission complete

                const transmission = this.transmissions[tId];
                if (!transmission) return;

                let assembledData = new Array(transmission.chunkCount)
                    .fill("")
                    .map((_, i) => transmission.chunks[i])
                    .join("");

                try {
                    this.handleEvent({
                        eventName: this.transmissions[tId].event,
                        data: JSON.parse(assembledData),
                        rf: this.transmissions[tId].rf,
                        socket,
                    });
                } catch (e) {
                    console.error(e);
                }

                delete this.transmissions[tId];
            }

            return;
        }

        try {
            data = JSON.parse(data);
        } catch (e) {
            // Not a JSON string
            return;
        }

        if (data.launch) {
            const outgoingChunks = this.outgoingTransmissions[data.tId];
            if (outgoingChunks) {
                // Launch the outgoing transmission
                const chunks = structuredClone(outgoingChunks);

                delete this.outgoingTransmissions[data.tId];

                Object.values(chunks).forEach((chunk) => {
                    socket.send(chunk);
                });
            }
            return;
        }

        // Normal event, not a transmission chunk

        if (data.tId) {
            // Starting transmission, allow the client to start sending chunks
            this.transmissions[data.tId] = {
                chunks: {},
                chunkTimes: {},
                chunkCount: data.chunkCount,
                event: data.event,
                rf: data.rf,
            };

            setTimeout(() => {
                this.transmissionSecurityCheck(data.tId);
            }, 30000);

            socket.send(
                JSON.stringify({
                    launch: true,
                    tId: data.tId,
                })
            );

            return;
        }

        if (data.rb) {
            // Receied callback
            const callback = this.rb[data.rb];

            if (callback) {
                callback.callback(data.data);
                delete this.rb[data.rb];
            }

            return;
        }

        // Not transmission starter or chunk, handle event
        this.handleEvent({
            eventName: data.event,
            data: data.data,
            rf: data.rf,
            socket,
        });
    }

    private async handleEvent({
        eventName,
        data,
        rf,
        socket,
    }: {
        eventName: keyof ThereToThisEvents;
        data: PeerEventInput<ThereToThisEvents[keyof ThereToThisEvents]>;
        rf: string | null;
        socket: SocketType;
    }) {
        const eventHandler = this.eventHandlers[eventName];

        if (!eventHandler) return;

        const result = await eventHandler({
            ...(typeof data === "object" ? data : {}),
            socket,
        } as any);

        if (rf) {
            socket.send(
                JSON.stringify({
                    rb: rf,
                    data: result,
                })
            );
        }
    }
}
