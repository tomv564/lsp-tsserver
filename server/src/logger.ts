import * as ts from "typescript/lib/tsserverlibrary";
import { IConnection } from "vscode-languageserver";

export class LSPLogger implements ts.server.Logger {

    constructor(private connection: IConnection, private level: ts.server.LogLevel) {}

    public close(): void {
        // throw new Error("Method not implemented.");
    }
    public hasLevel(_level: ts.server.LogLevel): boolean {
        return this.level >= _level;
    }
    public loggingEnabled(): boolean {
        return true;
    }
    public perftrc(s: string): void {
        this.msg(s, ts.server.Msg.Perf);
    }
    public info(s: string): void {
        this.msg(s, ts.server.Msg.Info);
    }
    public err(s: string): void {
        this.msg(s, ts.server.Msg.Err);
    }

    public startGroup(): void {
        // throw new Error("Method not implemented.");
    }
    public endGroup(): void {
        // throw new Error("Method not implemented.");
    }
    public msg(s: string, _type: ts.server.Msg.Types = ts.server.Msg.Err): void {
        const line = _type + " " + s;
        if (_type === ts.server.Msg.Err) {
            this.connection.console.error(line);
        } else if (_type === ts.server.Msg.Info) {
            this.connection.console.info(line);
        } else if (_type === ts.server.Msg.Perf) {
            this.connection.console.log(line);
        }
    }
    public getLogFileName(): string {
        return "";
        // throw new Error("Method not implemented.");
    }

}
