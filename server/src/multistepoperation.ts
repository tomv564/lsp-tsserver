import * as ts from "typescript/lib/tsserverlibrary";

/**
 * Allows to schedule next step in multistep operation
 */
export interface NextStep {
    immediate(action: () => void): void;
    delay(ms: number, action: () => void): void;
}

/**
 * External capabilities used by multistep operation
 */
export interface MultistepOperationHost {
    getCurrentRequestId(): number;
    sendRequestCompletedEvent(requestId: number): void;
    getServerHost(): ts.server.ServerHost;
    isCancellationRequested(): boolean;
    executeWithRequestId(requestId: number, action: () => void): void;
    logError(error: Error, message: string): void;
}

/**
 * Represents operation that can schedule its next step to be executed later.
 * Scheduling is done via instance of NextStep. If on current step subsequent step was not scheduled - operation is assumed to be completed.
 */
export class MultistepOperation implements NextStep {
    private requestId: number | undefined;
    private timerHandle: any;
    private immediateId: number | undefined;

    constructor(private readonly operationHost: MultistepOperationHost) { }

    public startNew(action: (next: NextStep) => void) {
        this.complete();
        this.requestId = this.operationHost.getCurrentRequestId();
        this.executeAction(action);
    }

    private complete() {
        if (this.requestId !== undefined) {
            this.operationHost.sendRequestCompletedEvent(this.requestId);
            this.requestId = undefined;
        }
        this.setTimerHandle(undefined);
        this.setImmediateId(undefined);
    }

    public immediate(action: () => void) {
        const requestId = this.requestId;
        // TODO: re-enable 
        // Debug.assert(requestId === this.operationHost.getCurrentRequestId(), "immediate: incorrect request id");
        this.setImmediateId(this.operationHost.getServerHost().setImmediate(() => {
            this.immediateId = undefined;
            this.operationHost.executeWithRequestId(requestId, () => this.executeAction(action));
        }));
    }

    public delay(ms: number, action: () => void) {
        const requestId = this.requestId;
        // TODO: re-enable
        // Debug.assert(requestId === this.operationHost.getCurrentRequestId(), "delay: incorrect request id");
        this.setTimerHandle(this.operationHost.getServerHost().setTimeout(() => {
            this.timerHandle = undefined;
            this.operationHost.executeWithRequestId(requestId, () => this.executeAction(action));
        }, ms));
    }

    private executeAction(action: (next: NextStep) => void) {
        let stop = false;
        try {
            if (this.operationHost.isCancellationRequested()) {
                stop = true;
            }
            else {
                action(this);
            }
        }
        catch (e) {
            stop = true;
            // ignore cancellation request
            if (!(e instanceof ts.OperationCanceledException)) {
                this.operationHost.logError(e, `delayed processing of request ${this.requestId}`);
            }
        }
        if (stop || !this.hasPendingWork()) {
            this.complete();
        }
    }

    private setTimerHandle(timerHandle: any) {
        if (this.timerHandle !== undefined) {
            this.operationHost.getServerHost().clearTimeout(this.timerHandle);
        }
        this.timerHandle = timerHandle;
    }

    private setImmediateId(immediateId: number) {
        if (this.immediateId !== undefined) {
            this.operationHost.getServerHost().clearImmediate(this.immediateId);
        }
        this.immediateId = immediateId;
    }

    private hasPendingWork() {
        return !!this.timerHandle || !!this.immediateId;
    }
}