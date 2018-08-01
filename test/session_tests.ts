// import * as sinon from "sinon";
import * as test from "tape";
import * as ts from "typescript/lib/tsserverlibrary";
// import {DidChangeTextDocumentParams, DidOpenTextDocumentParams, IConnection} from "vscode-languageserver";
// import {createSession, LSPSessionOptions} from "../src/session";

// const logger: ts.server.Logger = {
//     close: () => { /* nop */},
//     hasLevel: (_level: ts.server.LogLevel) => false,
//     loggingEnabled: () => false,
//     perftrc: (_s: string) => { /* nop */},
//     info: (_s: string) => {  /* nop | console.log(_s);*/},
//     startGroup: () => { /* nop */},
//     endGroup: () => { /* nop */},
//     msg: (_s: string, _type?: ts.server.Msg.Types) => { /* console.log(_s); */ /* nop */},
//     getLogFileName: () => ""
// };

const sys =  ts.sys as ts.server.ServerHost;
sys.setTimeout = setTimeout;
sys.clearTimeout = clearTimeout;
sys.setImmediate = setImmediate;
sys.clearImmediate = clearImmediate;
if (typeof global !== "undefined" && global.gc) {
    sys.gc = () => global.gc();
}

sys.require = (initialDir: string, moduleName: string): ts.server.RequireResult => {
    try {
        return { module: require(ts.resolveJavaScriptModule(moduleName, initialDir, sys)), error: undefined };
    } catch (error) {
        return { module: undefined, error };
    }
};

// const useSingleInferredProject = false;
// const useInferredProjectPerProjectRoot = false;
// // import * as ts from "typescript/lib/tsserverlibrary";
// // import {convertTsDiagnostic} from "../src/protocol";

// const cancellationToken = ts.server.nullCancellationToken;
// const typingsInstaller = ts.server.nullTypingsInstaller;

// const options: LSPSessionOptions = {
//     host: sys,
//     cancellationToken,
//     // installerEventPort: eventPort,
//     // canUseEvents: eventPort === undefined,
//     useSingleInferredProject,
//     useInferredProjectPerProjectRoot,
//     typingsInstaller,
//     // disableAutomaticTypingAcquisition,
//     // globalTypingsCacheLocation: getGlobalTypingsCacheLocation(),
//     // typingSafeListLocation,
//     // typesMapLocation,
//     // npmLocation,
//     // telemetryEnabled,
//     logger,
//     // globalPlugins,
//     // pluginProbeLocations,
//     // allowLocalPluginLoads
// };

// diagnostics code from session.ts

// TODO: shutdown session on exit?

// Listen on the connection
// connection.listen();

test("onDidDocumentChange", t => {

    t.skip("not implemented");

    // let content = "console.log('yo');";
    // const append = "\nconsole.error('wut');";

    // const openParams: DidOpenTextDocumentParams = {
    //     textDocument: {
    //         uri: "file:///testfile.ts",
    //         languageId: "ts",
    //         version: 0,
    //         text: content
    //     }
    // };
    // const testConnection = {} as IConnection;
    // // testConnection.sendDiagnostics = sinon.spy();

    // const session = createSession(testConnection, options);
    // session.didOpenTextDocument(openParams);

    // // const contentChange: TextDocumentContentChangeEvent = {
    // //     ,
    // // }
    // for (let i = 1; i < 15; i++) {
    //     content += append;
    //     const changeParam: DidChangeTextDocumentParams = {
    //         textDocument: {
    //             version: i,
    //             uri: "file:///testfile.ts"
    //         },
    //         contentChanges: [
    //             {text: content}
    //         ]
    //     };
    //     // debugger;
    //     session.didChangeTextDocument(changeParam);

    // }
    // testConnection.sendDiagnostics = (_diags) => {
    //     // console.log("diags gotten");
    //     t.end();
    //     // debugger;
    // };
    // console.log("yo");
    t.end();
});

test("onReferences", t => {

    t.skip("not implemented");
    // const sourceFile = ts.createSourceFile("asdf.ts", "", ts.ScriptTarget.ES2015);
    // // const sourceFile: ts.SourceFile = {
    // //     fileName: "asdf.ts",
    // //     kind: ts.SyntaxKind.SourceFile,
    // //     statements: [],
    // //     endOfFileToken: ts.createToken(ts.SyntaxKind.EndOfFileToken)
    // // };

    // const tsDiag: ts.Diagnostic = {
    //     file: sourceFile,
    //     start: 44,
    //     length: 0,
    //     messageText: "message",
    //     category: ts.DiagnosticCategory.Error,
    //     code: 123
    // };
    // const diag = convertTsDiagnostic(tsDiag);
    // t.equals(0, diag.range.start);
    // t.notEquals(0, diag.range.end);

    t.end();

});
