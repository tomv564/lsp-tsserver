#!/usr/bin/env node

"use strict";

import * as ts from "typescript/lib/tsserverlibrary";
import {
    createConnection, IConnection, StreamMessageReader, StreamMessageWriter,
} from "vscode-languageserver";
import { LSPLogger } from "./logger";
import { createSession, LSPSessionOptions } from "./session";

declare module "typescript/lib/tsserverlibrary" {
    function resolveJavaScriptModule(moduleName: string, initialDir: string, sys: ModuleResolutionHost): string;
    namespace server {
        // moved to jsTypings/shared.ts in typescript 3.0.1
        function findArgument(argumentName: string): string | undefined;
        function hasArgument(argumentName: string): boolean;
    }
}

// Create a connection for the server. The connection uses stdin/stdout as a transport
const connection: IConnection = createConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));

connection.onDidChangeWatchedFiles((_change) => {
    // Monitored files have change in VSCode
    connection.console.log("We received an file change event");
});

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
