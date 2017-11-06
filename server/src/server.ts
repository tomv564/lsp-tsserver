/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	StreamMessageReader, StreamMessageWriter, createConnection, IConnection, TextDocuments, TextDocument,
	Diagnostic, DiagnosticSeverity, Hover, InitializeResult, TextDocumentPositionParams, CompletionItem,
	CompletionItemKind, Position, Location, Range, CodeActionParams, Command, ExecuteCommandParams, TextEdit, WorkspaceEdit
} from 'vscode-languageserver';
import * as ts from "typescript/lib/tsserverlibrary";
import { uri2path, path2uri, mapDefined} from './util';
import { MultistepOperation, MultistepOperationHost, NextStep } from './multistepoperation';

const cancellationToken = ts.server.nullCancellationToken;
const typingsInstaller = ts.server.nullTypingsInstaller;

const opts = {
	useSingleInferredProject: false,
	useInferredProjectPerProjectRoot: false,
	// globalPlugins: [],
	// pluginProbeLocations: [],
	// allowLocalPluginLoads: false
}

/**
 * Maps string-based CompletionEntry::kind to enum-based CompletionItemKind
 */
const completionKinds: { [name: string]: CompletionItemKind } = {
    class: CompletionItemKind.Class,
    constructor: CompletionItemKind.Constructor,
    enum: CompletionItemKind.Enum,
    field: CompletionItemKind.Field,
    file: CompletionItemKind.File,
    function: CompletionItemKind.Function,
    interface: CompletionItemKind.Interface,
    keyword: CompletionItemKind.Keyword,
    method: CompletionItemKind.Method,
    module: CompletionItemKind.Module,
    property: CompletionItemKind.Property,
    reference: CompletionItemKind.Reference,
    snippet: CompletionItemKind.Snippet,
    text: CompletionItemKind.Text,
    unit: CompletionItemKind.Unit,
    value: CompletionItemKind.Value,
    variable: CompletionItemKind.Variable
};

class Logger implements ts.server.Logger {
	close(): void {
		throw new Error("Method not implemented.");
	}
	hasLevel(level: ts.server.LogLevel): boolean {
		return true;
		// throw new Error("Method not implemented.");
	}
	loggingEnabled(): boolean {
		// throw new Error("Method not implemented.");
	}
	perftrc(s: string): void {
		throw new Error("Method not implemented.");
	}
	info(s: string): void {
		connection.console.info(s)
		// throw new Error("Method not implemented.");
	}
	startGroup(): void {
		// throw new Error("Method not implemented.");
	}
	endGroup(): void {
		// throw new Error("Method not implemented.");
	}
	msg(s: string, type?: ts.server.Msg.Types): void {
		connection.console.error(s)
	}
	getLogFileName(): string {
		throw new Error("Method not implemented.");
	}

}


// }
const host = {
	setTimeout: setTimeout,
	clearTimeout: clearTimeout,
	setImmediate: setImmediate,
	clearImmediate: clearImmediate,
	...ts.sys
}

const logger = new Logger();

const settings: ts.server.ProjectServiceOptions = {
	host: host,
	logger: logger,
	cancellationToken: cancellationToken,
	useSingleInferredProject: opts.useSingleInferredProject,
	useInferredProjectPerProjectRoot: opts.useInferredProjectPerProjectRoot,
	typingsInstaller: typingsInstaller,
	//throttleWaitMilliseconds,
	eventHandler: defaultEventHandler,
	// globalPlugins: opts.globalPlugins,
	// pluginProbeLocations: opts.pluginProbeLocations,
	// allowLocalPluginLoads: opts.allowLocalPluginLoads
};

interface ProjectServiceWithInternals extends ts.server.ProjectService {
	applyChangesToFile(scriptInfo: ts.server.ScriptInfo, changes: ts.TextChange[]): void;
}

const projectService = new ts.server.ProjectService(settings) as ProjectServiceWithInternals;

function getPosition(position: Position, scriptInfo: ts.server.ScriptInfo): number {
	return scriptInfo.lineOffsetToPosition(position.line, position.character);
}

// const options: ts.server.ProjectServiceOptions = {

// }

// Create a connection for the server. The connection uses Node's IPC as a transport
let connection: IConnection = createConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));

// Create a simple text document manager. The text document manager
// supports full document sync only
let documents: TextDocuments = new TextDocuments();
// Make the text document manager listen on the connection
// for open, change and close text document events
documents.listen(connection);

let changeSeq: number = 0

// After the server has started the client sends an initilize request. The server receives
// in the passed params the rootPath of the workspace plus the client capabilites.
let workspaceRoot: string;
connection.onInitialize((params): InitializeResult => {
	workspaceRoot = params.rootPath;
	return {
		capabilities: {
			// Tell the client that the server works in FULL text document sync mode
			textDocumentSync: documents.syncKind,
			// Tell the client that the server support code complete
			codeActionProvider: true,
			executeCommandProvider: {
				commands: []
			},
			completionProvider: {
				resolveProvider: true
			},
			definitionProvider: true,
			hoverProvider: true
		}
	}
});

// The content of a text document has changed. This event is emitted
// when the text document first opened or when its content has changed.
documents.onDidChangeContent((change) => {
	validateTextDocument(change.document);
});

// The settings interface describe the server relevant settings part
interface Settings {
	lspSample: ExampleSettings;
}

// These are the example settings we defined in the client's package.json
// file
interface ExampleSettings {
	maxNumberOfProblems: number;
}

// hold the maxNumberOfProblems setting
let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((change) => {
	let settings = <Settings>change.settings;
	maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
	// Revalidate any open text documents
	documents.all().forEach(validateTextDocument);
});

function validateTextDocument(textDocument: TextDocument): void {
	let diagnostics: Diagnostic[] = [];
	let lines = textDocument.getText().split(/\r?\n/g);
	let problems = 0;
	for (var i = 0; i < lines.length && problems < maxNumberOfProblems; i++) {
		let line = lines[i];
		let index = line.indexOf('typescript');
		if (index >= 0) {
			problems++;
			diagnostics.push({
				severity: DiagnosticSeverity.Warning,
				range: {
					start: { line: i, character: index },
					end: { line: i, character: index + 10 }
				},
				message: `${line.substr(index, 10)} should be spelled TypeScript`,
				source: 'ex'
			});
		}
	}
	// Send the computed diagnostics to VSCode.
	connection.sendDiagnostics({ uri: textDocument.uri, diagnostics });
}

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');
});



connection.onHover((_textDocumentPosition: TextDocumentPositionParams): Hover => {
	const filePath = uri2path(_textDocumentPosition.textDocument.uri);

	const scriptInfo = projectService.getScriptInfoForNormalizedPath(ts.server.toNormalizedPath(filePath));
	const position = getPosition(_textDocumentPosition.position, scriptInfo);

	connection.console.log('getting project');
	let project: ts.server.Project;
	try {
		project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false)
		// const scriptInfo = projectService.getScriptInfoEnsuringProjectsUptoDate(filePath)
		// project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(scriptInfo.path), true);
		// projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false);
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	// const project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false);
	const languageService = project.getLanguageService();

	// const sourceFile = program.getSourceFile(filePath);
	const info = languageService.getQuickInfoAtPosition(filePath, position)
	const declaration = ts.displayPartsToString(info.displayParts)

	return {
		contents: declaration
	};
});

// function getProgram(filePath: string): ts.Program | undefined {
// 	return ts.createProgram([filePath], {});
// }

// This handler provides the initial list of the completion items.
connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {

	const filePath = uri2path(_textDocumentPosition.textDocument.uri);

	const scriptInfo = projectService.getScriptInfoForNormalizedPath(ts.server.toNormalizedPath(filePath));
	const position = getPosition(_textDocumentPosition.position, scriptInfo);

	connection.console.log('getting project');
	let project: ts.server.Project;
	try {
		project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false)
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	const languageService = project.getLanguageService();

	const completions = languageService.getCompletionsAtPosition(filePath, position);
	connection.console.log('got completions:' + JSON.stringify(completions));
	const items = completions.entries.map(entry =>  {
		const item: CompletionItem = { label: entry.name }

		const kind = completionKinds[entry.kind]
		if (kind && typeof(kind) == 'number') {
			item.kind = kind
		}
		if (entry.sortText) {
			item.sortText = entry.sortText
		}

		// context for future resolve requests:
		// item.data = {
		// 	uri,
		// 	offset,
		// 	entryName: entry.name,
		// }
		return item;
	});

	return items;
});

connection.onDefinition((_textDocumentPosition: TextDocumentPositionParams): Location | Location[] => {
	const filePath = uri2path(_textDocumentPosition.textDocument.uri);

	const scriptInfo = projectService.getScriptInfoForNormalizedPath(ts.server.toNormalizedPath(filePath));
	const position = getPosition(_textDocumentPosition.position, scriptInfo);

	connection.console.log('getting project');
	let project: ts.server.Project;
	try {
		project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false)
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	const languageService = project.getLanguageService();

	let definitions: ts.DefinitionInfo[] = [];
	try {
		definitions = languageService.getDefinitionAtPosition(filePath, position);
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	connection.console.info('got defitions: ' + definitions.length)
	return definitions.map(d => {
		connection.console.info('getting source file' + d.fileName)
		const scriptInfo = project.getScriptInfo(d.fileName)
		connection.console.info('got script info' + scriptInfo.fileName)
		const sourceFile = project.getSourceFile(scriptInfo.path)
		if (!sourceFile) {
			connection.console.info('no source file returned');
		}

		const start = ts.getLineAndCharacterOfPosition(sourceFile, d.textSpan.start)
		const end = ts.getLineAndCharacterOfPosition(sourceFile, d.textSpan.start + d.textSpan.length)
		return {
			uri: path2uri(definitions[0].fileName),
			range: {start, end}
		}
	});

});


/**
 * Executes the `codeFix` command
 *
 * @return Observable of JSON Patches for `null` result
 */
function executeCodeFixCommand(fileTextChanges: ts.FileTextChanges[]): void {
	try {
		if (fileTextChanges.length === 0) {
			throw new Error('No changes supplied for code fix command')
		}
		// const unixFilePath = fileTextChanges[0].fileName
		// const firstChangedFile = /^[a-z]:\//i.test(unixFilePath) ?
		// 	unixFilePath.replace(/\//g, '\\') :
		// 	unixFilePath
	
		const changes: {[uri: string]: TextEdit[]} = {}
		for (const change of fileTextChanges) {
			const filePath = change.fileName;
			let project: ts.server.Project;
			try {
				project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false)
			} catch (e) {
				connection.console.error(e.message + '\n' + e.stack);
				throw e;
			}
	
			connection.console.info('getting source file' + filePath)
			const scriptInfo = project.getScriptInfo(filePath)
			connection.console.info('got script info' + scriptInfo.fileName)
			const sourceFile = project.getSourceFile(scriptInfo.path)
			if (!sourceFile) {
				connection.console.info('no source file returned');
			}
			
			const uri = path2uri(change.fileName)
			changes[uri] = change.textChanges.map(({ span, newText }): TextEdit => ({
				range: {
					start: ts.getLineAndCharacterOfPosition(sourceFile, span.start),
					end: ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length),
				},
				newText,
			}))
		}
		const edit: WorkspaceEdit = { changes }
		connection.workspace.applyEdit(edit).then(() => connection.console.log("aplied edit"))
		
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	
}


connection.onExecuteCommand((params: ExecuteCommandParams): any => {
	switch (params.command) {
		case 'codeFix':
			// if (!params.arguments || params.arguments.length < 1) {
			// 	return Observable.throw(new Error(`Command ${params.command} requires arguments`))
			// }
			return executeCodeFixCommand(params.arguments)
		default:
			throw new Error(`Unknown command ${params.command}`);
	}});

connection.onCodeAction((_codeActionParams: CodeActionParams): Command[] => {
	try
	{
		const filePath = uri2path(_codeActionParams.textDocument.uri);
		const normalizedFilePath = ts.server.toNormalizedPath(filePath);
		let project: ts.server.Project;
		try {
			project = projectService.getDefaultProjectForFile(normalizedFilePath, false)
		} catch (e) {
			connection.console.error(e.message + '\n' + e.stack);
			throw e;
		}
		const scriptInfo = project.getScriptInfoForNormalizedPath(normalizedFilePath);
		const startPosition = getPosition(_codeActionParams.range.start, scriptInfo);
		const endPosition = getPosition(_codeActionParams.range.end, scriptInfo);
		
		// const { startPosition, endPosition } = this.getStartAndEndPosition(args, scriptInfo);
		const formatOptions = projectService.getFormatCodeOptions(normalizedFilePath);
		const errorCodes: number[] = _codeActionParams.context.diagnostics.map(d => d.code).filter(c => typeof c === 'number') as number[]
		
		const codeActions = project.getLanguageService().getCodeFixesAtPosition(normalizedFilePath, startPosition, endPosition, errorCodes, formatOptions);
		if (!codeActions) {
			return undefined;
		}
		return codeActions.map(action => {
			return {
				title: action.description,
				command: 'codeFix',
				arguments: action.changes,
			} as Command
		})
	}
	catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	
});

// diagnostics code from session.ts

let currentRequestId: number;

function setCurrentRequest(requestId: number): void {
	// Debug.assert(this.currentRequestId === undefined);
	currentRequestId = requestId;
	cancellationToken.setRequest(requestId);
}

function resetCurrentRequest(requestId: number): void {
	// Debug.assert(this.currentRequestId === requestId);
	currentRequestId = undefined;
	cancellationToken.resetRequest(requestId);
}

function executeWithRequestId<T>(requestId: number, f: () => T) {
	try {
		setCurrentRequest(requestId);
		return f();
	}
	finally {
		resetCurrentRequest(requestId);
	}
}

function logError(err: Error, cmd: string) {
	let msg = "Exception on executing command " + cmd;
	if (err.message) {
		msg += ":\n" + err.message//+ indent(err.message);
		if (err.stack) {
			msg += "\n"; + err.stack //indent((<StackTraceError>err).stack);
		}
	}
	logger.msg(msg, ts.server.Msg.Err);
}

function sendRequestCompletedEvent(requestId: number): void {
	// const event: protocol.RequestCompletedEvent = {
	// 	seq: 0,
	// 	type: "event",
	// 	event: "requestCompleted",
	// 	body: { request_seq: requestId }
	// };
	// this.send(event);
}

// rewrite using promise?

const multistepOperationHost: MultistepOperationHost = {
	executeWithRequestId: (requestId, action) => executeWithRequestId(requestId, action),
	getCurrentRequestId: () => currentRequestId,
	getServerHost: () => host,
	logError: (err, cmd) => logError(err, cmd),
	sendRequestCompletedEvent: requestId => sendRequestCompletedEvent(requestId),
	isCancellationRequested: () => cancellationToken.isCancellationRequested()
};
const errorCheck = new MultistepOperation(multistepOperationHost);

function createCheckList(fileNames: string[], defaultProject?: ts.server.Project): ts.server.PendingErrorCheck[] {
	return mapDefined<string, ts.server.PendingErrorCheck>(fileNames, uncheckedFileName => {
		const fileName = ts.server.toNormalizedPath(uncheckedFileName);
		const project = defaultProject || projectService.getDefaultProjectForFile(fileName, /*ensureProject*/ false);
		return project && { fileName, project };
	});
}

function semanticCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
	try {
		// let diags: ReadonlyArray<Diagnostic> = [];
		//TODO: re-enable
		// if (!isDeclarationFileInJSOnlyNonConfiguredProject(project, file)) {
		// 	diags = project.getLanguageService().getSemanticDiagnostics(file);
		// }
		// TODO: combine these two.
		const diags: ReadonlyArray<ts.Diagnostic> = project.getLanguageService().getSemanticDiagnostics(file);
		connection.sendDiagnostics({
			uri: path2uri(file),
			diagnostics: diags.map(convertTsDiagnostic)
		});
		// const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
		// this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "semanticDiag");
	}
	catch (err) {
		logError(err, "semantic check");
	}
}

function syntacticCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
	try {
		const diags = project.getLanguageService().getSyntacticDiagnostics(file);
		if (diags) {
			connection.sendDiagnostics({
				uri: path2uri(file),
				diagnostics: diags.map(convertTsDiagnostic)
			});
			// const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
			// this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "syntaxDiag");
		}
	}
	catch (err) {
		logError(err, "syntactic check");
	}
}

function updateErrorCheck(next: NextStep, checkList: ts.server.PendingErrorCheck[], ms: number, requireOpen = true) {
	const seq = changeSeq;
	const followMs = Math.min(ms, 200);

	let index = 0;
	const checkOne = () => {
		if (changeSeq === seq) {
			const checkSpec = checkList[index];
			index++;
			if (checkSpec.project.containsFile(checkSpec.fileName, requireOpen)) {
				syntacticCheck(checkSpec.fileName, checkSpec.project);
				if (changeSeq === seq) {
					next.immediate(() => {
						semanticCheck(checkSpec.fileName, checkSpec.project);
						if (checkList.length > index) {
							next.delay(followMs, checkOne);
						}
					});
				}
			}
		}
	};

	if (checkList.length > index && changeSeq === seq) {
		next.delay(ms, checkOne);
	}
}

function defaultEventHandler(event: ts.server.ProjectServiceEvent) {
	switch (event.eventName) {
		case ts.server.ProjectsUpdatedInBackgroundEvent:
			const { openFiles } = event.data;
			projectsUpdatedInBackgroundEvent(openFiles);
			break;
		// case ts.server.ConfigFileDiagEvent:
		// 	const { triggerFile, configFileName: configFile, diagnostics } = event.data;
		// 	const bakedDiags = map(diagnostics, diagnostic => formatConfigFileDiag(diagnostic, /*includeFileName*/ true));
		// 	this.event<protocol.ConfigFileDiagnosticEventBody>({
		// 		triggerFile,
		// 		configFile,
		// 		diagnostics: bakedDiags
		// 	}, "configFileDiag");
		// 	break;
		// case ts.server.ProjectLanguageServiceStateEvent: {
		// 	const eventName: protocol.ProjectLanguageServiceStateEventName = "projectLanguageServiceState";
		// 	this.event<protocol.ProjectLanguageServiceStateEventBody>({
		// 		projectName: event.data.project.getProjectName(),
		// 		languageServiceEnabled: event.data.languageServiceEnabled
		// 	}, eventName);
		// 	break;
		// }
		// case ts.server.ProjectInfoTelemetryEvent: {
		// 	const eventName: protocol.TelemetryEventName = "telemetry";
		// 	this.event<protocol.TelemetryEventBody>({
		// 		telemetryEventName: event.eventName,
		// 		payload: event.data,
		// 	}, eventName);
		// 	break;
		// }
	}
}

function projectsUpdatedInBackgroundEvent(openFiles: string[]): void {
	projectService.logger.info(`got projects updated in background, updating diagnostics for ${openFiles}`);
	if (openFiles.length) {
		const checkList = createCheckList(openFiles);

		// For now only queue error checking for open files. We can change this to include non open files as well
		errorCheck.startNew(next => updateErrorCheck(next, checkList, 100, /*requireOpen*/ true));
	}
}


/**
 * Converts a TypeScript Diagnostic to an LSP Diagnostic
 */
function convertTsDiagnostic(diagnostic: ts.Diagnostic): Diagnostic {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')
    let range: Range = { start: {character: 0, line: 0}, end: {character: 0, line: 0} }
    if (diagnostic.file && diagnostic.start && diagnostic.length) {
        range = {
            start: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start),
            end: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length),
        }
    }
    return {
        range,
        message: text,
        severity: convertDiagnosticCategory(diagnostic.category),
        code: diagnostic.code,
        source: diagnostic.source || 'ts',
    }
}

/**
 * Converts a diagnostic category to an LSP DiagnosticSeverity
 *
 * @param category The Typescript DiagnosticCategory
 */
function convertDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
        case ts.DiagnosticCategory.Error:
            return DiagnosticSeverity.Error
        case ts.DiagnosticCategory.Warning:
            return DiagnosticSeverity.Warning
        case ts.DiagnosticCategory.Message:
            return DiagnosticSeverity.Information
            // unmapped: DiagnosticSeverity.Hint
    }
}


// This handler resolve additional information for the item selected in
// the completion list.
connection.onCompletionResolve((item: CompletionItem): CompletionItem => {
	if (item.data === 1) {
		item.detail = 'TypeScript details',
			item.documentation = 'TypeScript documentation'
	} else if (item.data === 2) {
		item.detail = 'JavaScript details',
			item.documentation = 'JavaScript documentation'
	}
	return item;
});

const openFiles = new Set<string>();

function getDiagnostics(next: NextStep, delay: number, fileNames: string[]): void {
	const checkList = createCheckList(fileNames);
	if (checkList.length > 0) {
		updateErrorCheck(next, checkList, delay);
	}
}

function requestDiagnostics() {
	errorCheck.startNew(next => getDiagnostics(next, 200, Array.from(openFiles)));
}

connection.onDidOpenTextDocument((params) => {
	// A text document got opened in VSCode.
	// params.uri uniquely identifies the document. For documents store on disk this is a file URI.
	// params.text the initial full content of the document.
	try {
		const fileName = uri2path(params.textDocument.uri);
		connection.console.log(`${fileName} opened.`);
		try {
			projectService.openClientFile(fileName, params.textDocument.text);
		} catch (e) {
			connection.console.error(e.message + '\n' + e.stack);
			throw e;
		}
		openFiles.add(fileName)
		requestDiagnostics();
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
});
connection.onDidChangeTextDocument((params) => {
	// The content of a text document did change in VSCode.
	// params.uri uniquely identifies the document.
	// params.contentChanges describe the content changes to the document.
	// connection.console.log(`${params.textDocument.uri} changed: ${JSON.stringify(params.contentChanges)}`);
	// try {
		// projectService.(uri2path(params.textDocument.uri), params.textDocument.text);
	// } catch (e) {
	// 	connection.console.error(e.message + '\n' + e.stack);
	// 	throw e;
	// }
	try {
		const filePath = uri2path(params.textDocument.uri)
		const scriptInfo = projectService.getScriptInfo(filePath);
		if (!scriptInfo) {
			connection.console.error("No scriptInfo for file" + params.textDocument.uri)
		}
		const project = projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(scriptInfo.path), false)

		const sourceFile = project.getSourceFile(scriptInfo.path)
		if (!sourceFile) {
			connection.console.info('no source file returned');
		}

		const changes: ts.TextChange[] = params.contentChanges.map(c => {
			if (c.range) {
				const start = getPosition(c.range.start, scriptInfo);
				const end = getPosition(c.range.end, scriptInfo);
				return {
					span: { start, length: end - start },
					newText: c.text
				}
			} else {
				return {
					span: { start: 0, length: sourceFile.getEnd()},
					newText: c.text
				}
			}

		});

		// BOTH are internal :(
		//projectService.applyChangesInOpenFiles()
		changeSeq++;
		projectService.applyChangesToFile(scriptInfo, changes);
		requestDiagnostics();
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}

});
connection.onDidCloseTextDocument((params) => {
	// A text document got closed in VSCode.
	// params.uri uniquely identifies the document.
	// connection.console.log(`${params.textDocument.uri} closed.`);
	const fileName = uri2path(params.textDocument.uri);
	try {
		projectService.closeClientFile(fileName);
	} catch (e) {
		connection.console.error(e.message + '\n' + e.stack);
		throw e;
	}
	openFiles.delete(fileName);
	requestDiagnostics();
});

// Listen on the connection
connection.listen();
