import * as ts from "typescript/lib/tsserverlibrary";
import { uri2path, path2uri, mapDefined} from './util';
import { MultistepOperationHost, MultistepOperation, NextStep } from "./multistepoperation";
import {
    IConnection,
	Hover, InitializeResult, TextDocumentPositionParams, CompletionItem,
	Position, Location, CodeActionParams, Command, ExecuteCommandParams, TextEdit, WorkspaceEdit, RenameParams, ReferenceParams, TextDocumentSyncKind
} from 'vscode-languageserver';
import { convertTsDiagnostic, toHover, toLocation, toCompletionItem, toTextEdit } from "./protocol";
import { LSPLogger } from "./logger";

const host = {
	setTimeout: setTimeout,
	clearTimeout: clearTimeout,
	setImmediate: setImmediate,
	clearImmediate: clearImmediate,
	...ts.sys
}

export function configureSession(connection: IConnection): SessionOptions {
    return {
        host: host,
        cancellationToken: ts.server.nullCancellationToken,
        useSingleInferredProject: false,
        useInferredProjectPerProjectRoot: false,
        typingsInstaller: ts.server.nullTypingsInstaller,
        logger: new LSPLogger(connection),
        // globalPlugins: [],
        // pluginProbeLocations: [],
        // allowLocalPluginLoads: false
    }
}

export interface SessionOptions {
    host: ts.server.ServerHost;
    cancellationToken: ts.server.ServerCancellationToken;
    useSingleInferredProject: boolean;
    useInferredProjectPerProjectRoot: boolean;
    typingsInstaller: ITypingsInstaller;
    // byteLength: (buf: string, encoding?: string) => number;
    // hrtime: (start?: number[]) => number[];
    logger: ts.server.Logger;
    // canUseEvents: boolean;
    eventHandler?: ts.server.ProjectServiceEventHandler;
    throttleWaitMilliseconds?: number;

    globalPlugins?: ReadonlyArray<string>;
    pluginProbeLocations?: ReadonlyArray<string>;
    allowLocalPluginLoads?: boolean;
}

interface ProjectScriptInfoLocation {
    project: ts.server.Project,
    scriptInfo: ts.server.ScriptInfo,
    position: number
}

interface ProjectServiceWithInternals extends ts.server.ProjectService {
    applyChangesToFile(scriptInfo: ts.server.ScriptInfo, changes: ts.TextChange[]): void;
}

type ITypingsInstaller = any;
// type GcTimer = any;

export class Session {
    // private readonly gcTimer: GcTimer;
    protected projectService: ProjectServiceWithInternals;
    private changeSeq = 0;

    private currentRequestId: number;
    private errorCheck: MultistepOperation;

    private eventHandler: ts.server.ProjectServiceEventHandler;

    private host: ts.server.ServerHost;
    private cancellationToken: ts.server.ServerCancellationToken;
    protected typingsInstaller: ITypingsInstaller;
    // private byteLength: (buf: string, encoding?: string) => number;
    // private hrtime: (start?: number[]) => number[];
    protected logger: ts.server.Logger;
    // private canUseEvents: boolean;

    private openFiles = new Set<string>();
    private connection: IConnection;    

    constructor(connection: IConnection, opts: SessionOptions) {
        this.connection = connection;
        this.host = opts.host;
        this.cancellationToken = opts.cancellationToken;
        this.typingsInstaller = opts.typingsInstaller;
        // this.byteLength = opts.byteLength;
        // this.hrtime = opts.hrtime;
        this.logger = opts.logger;
        // this.canUseEvents = opts.canUseEvents;
        // this.eventHandler = this.canUseEvents
        //     ? opts.eventHandler || (event => this.defaultEventHandler(event))
        //     : undefined;
        this.eventHandler = (event => this.defaultEventHandler(event))

        const settings: ts.server.ProjectServiceOptions = {
            host: host,
            logger: opts.logger,
            cancellationToken: opts.cancellationToken,
            useSingleInferredProject: opts.useSingleInferredProject,
            useInferredProjectPerProjectRoot: opts.useInferredProjectPerProjectRoot,
            typingsInstaller: opts.typingsInstaller,
            //throttleWaitMilliseconds,
            eventHandler: this.eventHandler,
            // globalPlugins: opts.globalPlugins,
            // pluginProbeLocations: opts.pluginProbeLocations,
            // allowLocalPluginLoads: opts.allowLocalPluginLoads
        };

        const multistepOperationHost: MultistepOperationHost = {
            executeWithRequestId: (requestId, action) => this.executeWithRequestId(requestId, action),
            getCurrentRequestId: () => this.currentRequestId,
            getServerHost: () => host,
            logError: (err, cmd) => this.logError(err, cmd),
            sendRequestCompletedEvent: requestId => this.sendRequestCompletedEvent(requestId),
            isCancellationRequested: () => this.cancellationToken.isCancellationRequested()
        };

        this.errorCheck = new MultistepOperation(multistepOperationHost);
        this.projectService = new ts.server.ProjectService(settings) as ProjectServiceWithInternals;

        // this.gcTimer = new ts.server.GcTimer(this.host, /*delay*/ 7000, this.logger);
        // TODO: on every message:
        // this.gcTimer.scheduleCollect();

        connection.onDidOpenTextDocument((params) => {
            // A text document got opened in VSCode.
            // params.uri uniquely identifies the document. For documents store on disk this is a file URI.
            // params.text the initial full content of the document.
            try {
                const fileName = uri2path(params.textDocument.uri);
                connection.console.log(`${fileName} opened.`);
                try {
                    this.projectService.openClientFile(fileName, params.textDocument.text);
                } catch (e) {
                    connection.console.error(e.message + '\n' + e.stack);
                    throw e;
                }
                this.openFiles.add(fileName)
                this.requestDiagnostics();
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
                // this.projectService.(uri2path(params.textDocument.uri), params.textDocument.text);
            // } catch (e) {
            // 	connection.console.error(e.message + '\n' + e.stack);
            // 	throw e;
            // }
            try {
                const filePath = uri2path(params.textDocument.uri)
                const scriptInfo = this.projectService.getScriptInfo(filePath);
                if (!scriptInfo) {
                    connection.console.error("No scriptInfo for file" + params.textDocument.uri)
                }
                const project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(scriptInfo.path), false)
    
                const sourceFile = project.getSourceFile(scriptInfo.path)
                if (!sourceFile) {
                    connection.console.info('no source file returned');
                }
    
                const changes: ts.TextChange[] = params.contentChanges.map(c => {
                    if (c.range) {
                        const start = this.getPosition(c.range.start, scriptInfo);
                        const end = this.getPosition(c.range.end, scriptInfo);
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
                //this.projectService.applyChangesInOpenFiles()
                this.changeSeq++;
                this.projectService.applyChangesToFile(scriptInfo, changes);
                this.requestDiagnostics();
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
                this.projectService.closeClientFile(fileName);
            } catch (e) {
                connection.console.error(e.message + '\n' + e.stack);
                throw e;
            }
            this.openFiles.delete(fileName);
            this.requestDiagnostics();
        });
    
    
        // After the server has started the client sends an initilize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilites.
        let workspaceRoot: string;
        connection.onInitialize((params): InitializeResult => {
            workspaceRoot = params.rootPath;
            return {
                capabilities: {
                    // Tell the client that the server works in FULL text document sync mode
                    textDocumentSync: TextDocumentSyncKind.Full,
                    // Tell the client that the server support code complete
                    codeActionProvider: true,
                    executeCommandProvider: {
                        commands: []
                    },
                    completionProvider: {
                        resolveProvider: true
                    },
                    definitionProvider: true,
                    renameProvider: true,
                    hoverProvider: true,
                    referencesProvider: true
                }
            }
        });
    
        connection.onHover((_textDocumentPosition: TextDocumentPositionParams): Hover => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const info = project.getLanguageService().getQuickInfoAtPosition(scriptInfo.fileName, position)
                    return toHover(info);
                }).reduce((_prev, curr) => curr, { contents: [] })
        });
    
        connection.onReferences((_referenceParams: ReferenceParams): Location[] => {
            return this.getProjectScriptInfoAt(_referenceParams)
                .map(({project, scriptInfo, position}) => {
                    const referencedSymbols = project.getLanguageService().findReferences(scriptInfo.fileName, position);
                    if (referencedSymbols.length) {
                        return referencedSymbols[0].references.map(r => {
                            return toLocation(this.getSourceFile(project, r.fileName), r.textSpan)
                        });
                    } else {
                        return []
                    }
                }).reduce((_prev, curr) => curr, [])
        });
    
        connection.onRenameRequest((_renameParams: RenameParams): WorkspaceEdit => {
            return this.getProjectScriptInfoAt(_renameParams)
                .map(({project, scriptInfo, position}) => {
                    const renameInfo = project.getLanguageService().getRenameInfo(scriptInfo.fileName, position)
                    if (!renameInfo.canRename) {
                        throw new Error('This symbol cannot be renamed')
                    }
                    const changes: {[uri: string]: TextEdit[]} = {};
        
                    project.getLanguageService().findRenameLocations(scriptInfo.fileName, position, false, true)
                        .forEach((location: ts.RenameLocation) => {
                            const edit = toTextEdit(this.getSourceFile(project, location.fileName), location, _renameParams.newName)
                            const editUri = path2uri(location.fileName)
                            if (changes[editUri]) {
                                changes[editUri].push(edit);
                            } else {
                                changes[editUri] = [edit];
                            }
                        });

                    return {
                        changes
                    };
                }).reduce((_prev, curr) => curr, { changes: {}})
        });
    
        // This handler provides the initial list of the completion items.
        connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const completions = project.getLanguageService().getCompletionsAtPosition(scriptInfo.fileName, position);
                    return completions.entries.filter(e => !e.hasAction).map(toCompletionItem)
                }).reduce((_prev, curr) => curr, [])
        });
    
        connection.onDefinition((_textDocumentPosition: TextDocumentPositionParams): Location | Location[] => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const definitions = project.getLanguageService().getDefinitionAtPosition(scriptInfo.fileName, position);
                    return definitions.map(d => {
                        return toLocation(this.getSourceFile(project, d.fileName), d.textSpan)
                    });
                }).reduce((_prev, curr) => curr, [])
        });
    
    
    
        connection.onExecuteCommand((params: ExecuteCommandParams): any => {
            switch (params.command) {
                case 'codeFix':
                    // if (!params.arguments || params.arguments.length < 1) {
                    // 	return Observable.throw(new Error(`Command ${params.command} requires arguments`))
                    // }
                    return this.executeCodeFixCommand(params.arguments)
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
                    project = this.projectService.getDefaultProjectForFile(normalizedFilePath, false)
                } catch (e) {
                    connection.console.error(e.message + '\n' + e.stack);
                    throw e;
                }
                const scriptInfo = project.getScriptInfoForNormalizedPath(normalizedFilePath);
                const startPosition = this.getPosition(_codeActionParams.range.start, scriptInfo);
                const endPosition = this.getPosition(_codeActionParams.range.end, scriptInfo);
    
                // const { startPosition, endPosition } = this.getStartAndEndPosition(args, scriptInfo);
                const formatOptions = this.projectService.getFormatCodeOptions(normalizedFilePath);
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
    }

    private getSourceFile(project: ts.server.Project, fileName: string): ts.SourceFile {

        this.connection.console.info('getting source file' + fileName)
        const scriptInfo = project.getScriptInfo(fileName)
        this.connection.console.info('got script info' + scriptInfo.fileName)
        const sourceFile = project.getSourceFile(scriptInfo.path)
        if (!sourceFile) {
            throw new Error(`Source file ${fileName} not found`);
        }
        return sourceFile;
    }

    private getProjectScriptInfoAt(params: TextDocumentPositionParams): ProjectScriptInfoLocation[] {
        const filePath = uri2path(params.textDocument.uri);        
        const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(ts.server.toNormalizedPath(filePath));
        const position = this.getPosition(params.position, scriptInfo);

        this.connection.console.log('getting project');
        let project: ts.server.Project;
        try {
            project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false)
            // const scriptInfo = this.projectService.getScriptInfoEnsuringProjectsUptoDate(filePath)
            // project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(scriptInfo.path), true);
            // this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false);
        } catch (e) {
            this.connection.console.error(e.message + '\n' + e.stack);
            throw e;
        }
        // const project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false);
        // const languageService = project.getLanguageService();
        return [{project, scriptInfo, position}];

    }


    private getPosition(position: Position, scriptInfo: ts.server.ScriptInfo): number {
        return scriptInfo.lineOffsetToPosition(position.line + 1, position.character + 1);
    }

    private createCheckList(fileNames: string[], defaultProject?: ts.server.Project): ts.server.PendingErrorCheck[] {
        return mapDefined<string, ts.server.PendingErrorCheck>(fileNames, uncheckedFileName => {
            const fileName = ts.server.toNormalizedPath(uncheckedFileName);
            const project = defaultProject || this.projectService.getDefaultProjectForFile(fileName, /*ensureProject*/ false);
            return project && { fileName, project };
        });
    }

    private semanticCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
        try {
            // let diags: ReadonlyArray<Diagnostic> = [];
            //TODO: re-enable
            // if (!isDeclarationFileInJSOnlyNonConfiguredProject(project, file)) {
            // 	diags = project.getLanguageService().getSemanticDiagnostics(file);
            // }
            // TODO: combine these two.
            const diags: ReadonlyArray<ts.Diagnostic> = project.getLanguageService().getSemanticDiagnostics(file);
            this.connection.sendDiagnostics({
                uri: path2uri(file),
                diagnostics: diags.map(convertTsDiagnostic)
            });
            // const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
            // this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "semanticDiag");
        }
        catch (err) {
            this.logError(err, "semantic check");
        }
    }

    private syntacticCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
        try {
            const diags = project.getLanguageService().getSyntacticDiagnostics(file);
            if (diags) {
                this.connection.sendDiagnostics({
                    uri: path2uri(file),
                    diagnostics: diags.map(convertTsDiagnostic)
                });
                // const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
                // this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "syntaxDiag");
            }
        }
        catch (err) {
            this.logError(err, "syntactic check");
        }
    }

    private updateErrorCheck(next: NextStep, checkList: ts.server.PendingErrorCheck[], ms: number, requireOpen = true) {
        const seq = this.changeSeq;
        const followMs = Math.min(ms, 200);

        let index = 0;
        const checkOne = () => {
            if (this.changeSeq === seq) {
                const checkSpec = checkList[index];
                index++;
                if (checkSpec.project.containsFile(checkSpec.fileName, requireOpen)) {
                    this.syntacticCheck(checkSpec.fileName, checkSpec.project);
                    if (this.changeSeq === seq) {
                        next.immediate(() => {
                            this.semanticCheck(checkSpec.fileName, checkSpec.project);
                            if (checkList.length > index) {
                                next.delay(followMs, checkOne);
                            }
                        });
                    }
                }
            }
        };

        if (checkList.length > index && this.changeSeq === seq) {
            next.delay(ms, checkOne);
        }
    }

    private defaultEventHandler(event: ts.server.ProjectServiceEvent) {
        switch (event.eventName) {
            case ts.server.ProjectsUpdatedInBackgroundEvent:
                const { openFiles } = event.data;
                this.projectsUpdatedInBackgroundEvent(openFiles);
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
        }
    }

    private projectsUpdatedInBackgroundEvent(openFiles: string[]): void {
        this.projectService.logger.info(`got projects updated in background, updating diagnostics for ${openFiles}`);
        if (openFiles.length) {
            const checkList = this.createCheckList(openFiles);

            // For now only queue error checking for open files. We can change this to include non open files as well
            this.errorCheck.startNew(next => this.updateErrorCheck(next, checkList, 100, /*requireOpen*/ true));
        }
    }


    private sendRequestCompletedEvent(_requestId: number): void {
        // const event: protocol.RequestCompletedEvent = {
        // 	seq: 0,
        // 	type: "event",
        // 	event: "requestCompleted",
        // 	body: { request_seq: requestId }
        // };
        // this.send(event);
    }


    
    private getDiagnostics(next: NextStep, delay: number, fileNames: string[]): void {
        const checkList = this.createCheckList(fileNames);
        if (checkList.length > 0) {
            this.updateErrorCheck(next, checkList, delay);
        }
    }

    private requestDiagnostics() {
        this.errorCheck.startNew(next => this.getDiagnostics(next, 200, Array.from(this.openFiles)));
    }




    /**
     * Executes the `codeFix` command
     *
     * @return Observable of JSON Patches for `null` result
     */
    private executeCodeFixCommand(fileTextChanges: ts.FileTextChanges[]): void {
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
                    project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false)
                } catch (e) {
                    this.connection.console.error(e.message + '\n' + e.stack);
                    throw e;
                }

                this.connection.console.info('getting source file' + filePath)
                const scriptInfo = project.getScriptInfo(filePath)
                this.connection.console.info('got script info' + scriptInfo.fileName)
                const sourceFile = project.getSourceFile(scriptInfo.path)
                if (!sourceFile) {
                    this.connection.console.info('no source file returned');
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
            this.connection.workspace.applyEdit(edit).then(() => this.connection.console.log("aplied edit"))

        } catch (e) {
            this.connection.console.error(e.message + '\n' + e.stack);
            throw e;
        }

    }

    private setCurrentRequest(requestId: number): void {
        // Debug.assert(this.currentRequestId === undefined);
        this.currentRequestId = requestId;
        this.cancellationToken.setRequest(requestId);
    }

    private resetCurrentRequest(requestId: number): void {
        // Debug.assert(this.currentRequestId === requestId);
        this.currentRequestId = undefined;
        this.cancellationToken.resetRequest(requestId);
    }

    private executeWithRequestId<T>(requestId: number, f: () => T) {
        try {
            this.setCurrentRequest(requestId);
            return f();
        }
        finally {
            this.resetCurrentRequest(requestId);
        }
    }

    private logError(err: Error, cmd: string) {
        let msg = "Exception on executing command " + cmd;
        if (err.message) {
            msg += ":\n" + err.message//+ indent(err.message);
            if (err.stack) {
                msg += "\n"; + err.stack //indent((<StackTraceError>err).stack);
            }
        }
        this.logger.msg(msg, ts.server.Msg.Err);
    }
}

export function createSession(connection: IConnection): Session {
    const options = configureSession(connection);
    return new Session(connection, options);
}
