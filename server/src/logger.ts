import { IConnection } from "vscode-languageserver";

export class LSPLogger implements ts.server.Logger {

    constructor(private connection: IConnection) {}

    public close(): void {
        throw new Error("Method not implemented.");
    }
    public hasLevel(_level: ts.server.LogLevel): boolean {
        return true;
        // throw new Error("Method not implemented.");
    }
    public loggingEnabled(): boolean {
        return true;
        // throw new Error("Method not implemented.");
    }
    public perftrc(_s: string): void {
        throw new Error("Method not implemented.");
    }
    public info(s: string): void {
        this.connection.console.info(s);
        // throw new Error("Method not implemented.");
    }
    public startGroup(): void {
        // throw new Error("Method not implemented.");
    }
    public endGroup(): void {
        // throw new Error("Method not implemented.");
    }
    public msg(s: string, _type?: ts.server.Msg.Types): void {
        this.connection.console.error(s);
    }
    public getLogFileName(): string {
        throw new Error("Method not implemented.");
    }

}
