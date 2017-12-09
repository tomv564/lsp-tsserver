#!/usr/bin/env node

"use strict";

import * as ts from "typescript/lib/tsserverlibrary";
import {
    createConnection, IConnection, StreamMessageReader, StreamMessageWriter,
} from "vscode-languageserver";
import { createSession, LSPSessionOptions } from "./session";

declare module "typescript/lib/tsserverlibrary" {
    function resolveJavaScriptModule(moduleName: string, initialDir: string, sys: ModuleResolutionHost): string;
}

// const options: ts.server.ProjectServiceOptions = {

// }

// Create a connection for the server. The connection uses stdin/stdout as a transport
const connection: IConnection = createConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));

// // Create a simple text document manager. The text document manager
// // supports full document sync only
// let documents: TextDocuments = new TextDocuments();
// // Make the text document manager listen on the connection
// // for open, change and close text document events
// documents.listen(connection);

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
// documents.onDidChangeContent((change) => {
    // validateTextDocument(change.document);
// });

// The settings interface describe the server relevant settings part
// interface Settings {
//  lspSample: ExampleSettings;
// }

// These are the example settings we defined in the client's package.json
// file
// interface ExampleSettings {
//  maxNumberOfProblems: number;
// }

// hold the maxNumberOfProblems setting
// let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((_change) => {
    connection.console.log("We recevied an config change event");

    // let settings = <Settings>change.settings;
    // maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
    // Revalidate any open text documents
    // documents.all().forEach(validateTextDocument);
});

connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log("We recevied an file change event");
});

import { LSPLogger } from "./logger";

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

const cancellationToken = ts.server.nullCancellationToken;

// let eventPort: number;
// {
//  const str = ts.server.findArgument("--eventPort");
//  const v = str && parseInt(str);
//  if (!isNaN(v)) {
//      eventPort = v;
//  }
// }

const localeStr = ts.server.findArgument("--locale");
if (localeStr) {
    ts.validateLocaleAndSetLanguage(localeStr, sys);
}

// TODO: what is this?
// setStackTraceLimit();

// const typingSafeListLocation = ts.server.findArgument(ts.server.Arguments.TypingSafeListLocation);
// const typesMapLocation = ts.server.findArgument(ts.server.Arguments.TypesMapLocation)
//  || combinePaths(sys.getExecutingFilePath(), "../typesMap.json");
// const npmLocation = ts.server.findArgument(ts.server.Arguments.NpmLocation);

function getLogLevel(level: string): ts.server.LogLevel {
    if (level) {
        const l = level.toLowerCase();
        if (l === "terse") {
            return ts.server.LogLevel.terse;
        } else if (l === "requesttime") {
            return ts.server.LogLevel.requestTime;
        } else if (l === "verbose") {
            return ts.server.LogLevel.verbose;
        } else if (l === "normal") {
            return ts.server.LogLevel.normal;
        }
    }
    return ts.server.LogLevel.terse;
}

function parseStringArray(argName: string): ReadonlyArray<string> {
    const arg = ts.server.findArgument(argName);
    if (arg === undefined) {
        return ts.server.emptyArray;
    }
    return arg.split(",").filter(name => name !== "");
}
const typingsInstaller = ts.server.nullTypingsInstaller;

const globalPlugins = parseStringArray("--globalPlugins");
const pluginProbeLocations = parseStringArray("--pluginProbeLocations");
const allowLocalPluginLoads = ts.server.hasArgument("--allowLocalPluginLoads");

const useSingleInferredProject = ts.server.hasArgument("--useSingleInferredProject");
const useInferredProjectPerProjectRoot = ts.server.hasArgument("--useInferredProjectPerProjectRoot");

// const logFileName = ts.server.findArgument("--logFile");
const logVerbosity = getLogLevel(ts.server.findArgument("--logVerbosity"));

// normally as -traceToConsole in TSS_LOG
const traceToConsoleValue = ts.server.findArgument("--traceToConsole");
const traceToConsole = traceToConsoleValue && traceToConsoleValue.toLowerCase() === "true";
const logger = new LSPLogger(connection, traceToConsole, logVerbosity);

// const disableAutomaticTypingAcquisition = ts.server.hasArgument("--disableAutomaticTypingAcquisition");
// const telemetryEnabled = ts.server.hasArgument(ts.server.Arguments.EnableTelemetry);

const options: LSPSessionOptions = {
    host: sys,
    cancellationToken,
    // installerEventPort: eventPort,
    // canUseEvents: eventPort === undefined,
    useSingleInferredProject,
    useInferredProjectPerProjectRoot,
    typingsInstaller,
    // disableAutomaticTypingAcquisition,
    // globalTypingsCacheLocation: getGlobalTypingsCacheLocation(),
    // typingSafeListLocation,
    // typesMapLocation,
    // npmLocation,
    // telemetryEnabled,
    logger,
    globalPlugins,
    pluginProbeLocations,
    allowLocalPluginLoads
};

// diagnostics code from session.ts
createSession(connection, options);

// TODO: shutdown session on exit?

// Listen on the connection
connection.listen();
