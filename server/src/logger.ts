import { IConnection } from "vscode-languageserver/lib/main";

export class LSPLogger implements ts.server.Logger {
    
    constructor(private connection: IConnection) {}

	close(): void {
		throw new Error("Method not implemented.");
	}
	hasLevel(_level: ts.server.LogLevel): boolean {
		return true;
		// throw new Error("Method not implemented.");
	}
	loggingEnabled(): boolean {
		return true;
		// throw new Error("Method not implemented.");
	}
	perftrc(_s: string): void {
		throw new Error("Method not implemented.");
	}
	info(s: string): void {
		this.connection.console.info(s)
		// throw new Error("Method not implemented.");
	}
	startGroup(): void {
		// throw new Error("Method not implemented.");
	}
	endGroup(): void {
		// throw new Error("Method not implemented.");
	}
	msg(s: string, _type?: ts.server.Msg.Types): void {
		this.connection.console.error(s)
	}
	getLogFileName(): string {
		throw new Error("Method not implemented.");
	}

}