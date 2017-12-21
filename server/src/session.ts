import * as ts from "typescript/lib/tsserverlibrary";
import {
    CodeActionParams,
    Command, CompletionItem, DocumentFormattingParams, DocumentHighlight,
    DocumentOnTypeFormattingParams, DocumentRangeFormattingParams, DocumentSymbolParams, ExecuteCommandParams, Hover, IConnection, InitializeResult, Location, Position, ReferenceParams, RenameParams, SignatureHelp, SymbolInformation, TextDocumentIdentifier, TextDocumentPositionParams, TextDocumentSyncKind, TextEdit, WorkspaceEdit,
} from "vscode-languageserver";
import { MultistepOperation, MultistepOperationHost, NextStep } from "./multistepoperation";
import { convertTsDiagnostic, relevantDocumentSymbols, TextDocumentRangeParams, toCommand, toCompletionItem, toDocumentHighlight, toHover, toLocation, toSignatureHelp, toSymbolInformation, toTextEdit } from "./protocol";
import { mapDefined, path2uri, uri2path} from "./util";

declare module "typescript/lib/tsserverlibrary" {
    namespace server {
        class GcTimer {
            constructor(host: ServerHost, delay: number, logger: ts.server.Logger);
            public scheduleCollect(): void;
        }
    }
}

export interface LSPSessionOptions {
    host: ts.server.ServerHost;
    cancellationToken: ts.server.ServerCancellationToken;
    useSingleInferredProject: boolean;
    useInferredProjectPerProjectRoot: boolean;
    typingsInstaller: ITypingsInstaller;
    // byteLength: (buf: string, encoding?: string) => number;
    // hrtime: (start?: number[]) => number[];
    logger: ts.server.Logger;
    // canUseEvents: boolean;
    // // eventHandler?: ts.server.ProjectServiceEventHandler;
    throttleWaitMilliseconds?: number;

    globalPlugins?: ReadonlyArray<string>;
    pluginProbeLocations?: ReadonlyArray<string>;
    allowLocalPluginLoads?: boolean;
}

interface ProjectScriptInfo {
    project: ts.server.Project;
    scriptInfo: ts.server.ScriptInfo;
}

interface ProjectScriptInfoLocation extends ProjectScriptInfo {
    position: number;
}

interface ProjectScriptInfoRange extends ProjectScriptInfo {
    start: number;
    end: number;
}

interface ProjectServiceWithInternals extends ts.server.ProjectService {
    applyChangesToFile(scriptInfo: ts.server.ScriptInfo, changes: ts.TextChange[]): void;
}

type ITypingsInstaller = any;

interface FlattenedNavigationTree extends ts.NavigationTree {
    containerName: string;
}

export class Session {
    private readonly gcTimer: ts.server.GcTimer;
    // tslint:disable-next-line:member-ordering
    protected projectService: ProjectServiceWithInternals;
    private changeSeq = 0;

    private currentRequestId: number;
    private errorCheck: MultistepOperation;

    private eventHandler: ts.server.ProjectServiceEventHandler;

    // private host: ts.server.ServerHost;
    private cancellationToken: ts.server.ServerCancellationToken;
    // tslint:disable-next-line:member-ordering
    protected typingsInstaller: ITypingsInstaller;
    // private byteLength: (buf: string, encoding?: string) => number;
    // private hrtime: (start?: number[]) => number[];
    // tslint:disable-next-line:member-ordering
    protected logger: ts.server.Logger;
    // private canUseEvents: boolean;

    private openFiles = new Set<string>();
    private connection: IConnection;

    constructor(connection: IConnection, opts: LSPSessionOptions) {
        this.connection = connection;
        // this.host = opts.host;
        this.cancellationToken = opts.cancellationToken;
        this.typingsInstaller = opts.typingsInstaller;
        // this.byteLength = opts.byteLength;
        // this.hrtime = opts.hrtime;
        this.logger = opts.logger;
        // this.canUseEvents = opts.canUseEvents;
        // this.eventHandler = this.canUseEvents
        //     ? opts.eventHandler || (event => this.defaultEventHandler(event))
        //     : undefined;
        this.eventHandler = (event => this.defaultEventHandler(event));

        const settings: ts.server.ProjectServiceOptions = {
            host: opts.host,
            logger: opts.logger,
            cancellationToken: opts.cancellationToken,
            useSingleInferredProject: opts.useSingleInferredProject,
            useInferredProjectPerProjectRoot: opts.useInferredProjectPerProjectRoot,
            typingsInstaller: opts.typingsInstaller,
            // throttleWaitMilliseconds,
            eventHandler: this.eventHandler,
            globalPlugins: opts.globalPlugins,
            pluginProbeLocations: opts.pluginProbeLocations,
            allowLocalPluginLoads: opts.allowLocalPluginLoads,
        };

        const multistepOperationHost: MultistepOperationHost = {
            executeWithRequestId: (requestId, action) => this.executeWithRequestId(requestId, action),
            getCurrentRequestId: () => this.currentRequestId,
            getServerHost: () => opts.host,
            logError: (err, cmd) => this.logError(err, cmd),
            sendRequestCompletedEvent: requestId => this.sendRequestCompletedEvent(requestId),
            isCancellationRequested: () => this.cancellationToken.isCancellationRequested(),
        };

        this.errorCheck = new MultistepOperation(multistepOperationHost);
        this.projectService = new ts.server.ProjectService(settings) as ProjectServiceWithInternals;

        this.gcTimer = new ts.server.GcTimer(opts.host, /*delay*/ 7000, this.logger);

        connection.onDidOpenTextDocument((params) => {
            try {
                const fileName = uri2path(params.textDocument.uri);
                connection.console.log(`${fileName} opened.`);
                try {
                    this.projectService.openClientFile(fileName, params.textDocument.text);
                } catch (e) {
                    connection.console.error(e.message + "\n" + e.stack);
                    throw e;
                }
                this.openFiles.add(fileName);
                this.requestDiagnostics();
            } catch (e) {
                connection.console.error(e.message + "\n" + e.stack);
                throw e;
            }
        });
        connection.onDidChangeTextDocument((params) => {
            try {
                const filePath = uri2path(params.textDocument.uri);
                const scriptInfo = this.projectService.getScriptInfo(filePath);
                if (!scriptInfo) {
                    connection.console.error("No scriptInfo for file" + params.textDocument.uri);
                }
                const project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(scriptInfo.path), false);

                const sourceFile = project.getSourceFile(scriptInfo.path);
                if (!sourceFile) {
                    connection.console.info("no source file returned");
                }

                const changes: ts.TextChange[] = params.contentChanges.map(c => {
                    if (c.range) {
                        const start = this.getPosition(c.range.start, scriptInfo);
                        const end = this.getPosition(c.range.end, scriptInfo);
                        return {
                            span: { start, length: end - start },
                            newText: c.text,
                        };
                    } else {
                        const length = sourceFile.getEnd();
                        const newLen = c.text.length;
                        const changeSummary = `Replacing original (0-${length}) with new (0-${newLen}) to sourceFile ${scriptInfo.path} (${scriptInfo.getLatestVersion()}`;
                        connection.console.info(changeSummary);
                        return {
                            span: { start: 0, length: sourceFile.getEnd()},
                            newText: c.text,
                        };
                    }
                });

                // BOTH are internal :(
                // this.projectService.applyChangesInOpenFiles()
                this.changeSeq++;
                try {
                    this.projectService.applyChangesToFile(scriptInfo, changes);
                } catch (e) {
                    connection.console.error(`Failed to apply file changes because: ${e.message}`);
                }
                this.requestDiagnostics();
            } catch (e) {
                connection.console.error(e.message + "\n" + e.stack);
                throw e;
            }

        });
        connection.onDidCloseTextDocument((params) => {
            const fileName = uri2path(params.textDocument.uri);
            try {
                this.projectService.closeClientFile(fileName);
            } catch (e) {
                connection.console.error(e.message + "\n" + e.stack);
                throw e;
            }
            this.openFiles.delete(fileName);
            this.requestDiagnostics();
        });

        // After the server has started the client sends an initilize request. The server receives
        // in the passed params the rootPath of the workspace plus the client capabilites.
        // let workspaceRoot: string;
        connection.onInitialize((_params): InitializeResult => {
            // workspaceRoot = params.rootPath;
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
                        resolveProvider: false
                    },
                    documentFormattingProvider: true,
                    documentRangeFormattingProvider: true,
                    documentOnTypeFormattingProvider: {
                        firstTriggerCharacter: "}",
                        moreTriggerCharacter: [";", "\n"]
                    },
                    documentSymbolProvider: true,
                    documentHighlightProvider: true,
                    definitionProvider: true,
                    renameProvider: true,
                    hoverProvider: true,
                    referencesProvider: true,
                    signatureHelpProvider: {
                        triggerCharacters: ["(", ","],
                    }
                },
            };
        });

        connection.onHover((_textDocumentPosition: TextDocumentPositionParams): Hover => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const info = project.getLanguageService().getQuickInfoAtPosition(scriptInfo.fileName, position);
                    return toHover(info);
                }).reduce((_prev, curr) => curr, { contents: [] });
        });

        connection.onReferences((_referenceParams: ReferenceParams): Location[] => {
            return this.getProjectScriptInfoAt(_referenceParams)
                .map(({project, scriptInfo, position}) => {
                    const referencedSymbols = project.getLanguageService().findReferences(scriptInfo.fileName, position);
                    if (referencedSymbols.length) {
                        return referencedSymbols[0].references.map(r => {
                            return toLocation(this.getSourceFile(project, r.fileName), r.textSpan);
                        });
                    } else {
                        return [];
                    }
                }).reduce((_prev, curr) => curr, []);
        });

        connection.onDocumentFormatting((_formattingParams: DocumentFormattingParams): TextEdit[] => {
            return this.getProjectScriptInfo(_formattingParams.textDocument)
                .map( ({project, scriptInfo}) => {
                    // _formattingParams.options. // tabSize, insertSpaces
                    const formatOptions = this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    // const formatOptions = _formattingParams.options ?
                    //     ts.server.convertFormatOptions(_formattingParams.options) :
                    //     this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    const changes = project.getLanguageService().getFormattingEditsForDocument(scriptInfo.fileName, formatOptions);
                    const sourceFile = this.getSourceFile(project, scriptInfo.fileName);
                    return changes.map(({span, newText}) => toTextEdit(sourceFile, span, newText));
                }).reduce((_prev, curr) => curr, []);
        });

        connection.onDocumentRangeFormatting((_formattingParams: DocumentRangeFormattingParams): TextEdit[] => {
            return this.getProjectScriptInfoFor(_formattingParams)
                .map( ({project, scriptInfo, start, end}) => {
                    // _formattingParams.options. // tabSize, insertSpaces
                    const formatOptions = this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    // const formatOptions = _formattingParams.options ?
                    //     ts.server.convertFormatOptions(_formattingParams.options) :
                    //     this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    const changes = project.getLanguageService().getFormattingEditsForRange(scriptInfo.fileName, start, end, formatOptions);
                    const sourceFile = this.getSourceFile(project, scriptInfo.fileName);
                    return changes.map(({span, newText}) => toTextEdit(sourceFile, span, newText));
                }).reduce((_prev, curr) => curr, []);
        });

        connection.onDocumentOnTypeFormatting((_onTypeFormattingParams: DocumentOnTypeFormattingParams): TextEdit[] => {
            return this.getProjectScriptInfoAt(_onTypeFormattingParams)
                .map( ({project, scriptInfo, position}) => {
                    const formatOptions = this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    // const formatOptions = _formattingParams.options ?
                    //     ts.server.convertFormatOptions(_formattingParams.options) :
                    //     this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    const changes = project.getLanguageService().getFormattingEditsAfterKeystroke(scriptInfo.fileName, position, _onTypeFormattingParams.ch, formatOptions);
                    const sourceFile = this.getSourceFile(project, scriptInfo.fileName);
                    return changes.map(({span, newText}) => toTextEdit(sourceFile, span, newText));
                }).reduce((_prev, curr) => curr, []);
        });

        function isNameableContainer(tree: ts.NavigationTree): boolean {
            switch (tree.kind) {
                case ts.ScriptElementKind.classElement:
                case ts.ScriptElementKind.interfaceElement:
                    return true;
                default:
                    return false;
            }
        }

        function* flatten(tree: ts.NavigationTree, containerName?: string): IterableIterator<FlattenedNavigationTree> {
            yield {containerName, ...tree};
            if (tree.childItems) {
                let nextContainerName = containerName;
                if (isNameableContainer(tree)) {
                    nextContainerName = containerName ? containerName + "." + tree.text : tree.text;
                }
                for (const childItem of tree.childItems) {
                    yield* flatten(childItem, nextContainerName);
                }
            }
        }

        connection.onDocumentSymbol((_documentSymbolParams: DocumentSymbolParams): SymbolInformation[] => {
            return this.getProjectScriptInfo(_documentSymbolParams.textDocument)
                .map(({project, scriptInfo}) => {
                    const tree = project.getLanguageService().getNavigationTree(scriptInfo.fileName);
                    const sourceFile = this.getSourceFile(project, scriptInfo.fileName);
                    const relevantTreeItems = Array.from(flatten(tree)).filter(i => relevantDocumentSymbols.includes(i.kind));
                    return relevantTreeItems.map(item => toSymbolInformation(sourceFile, item, item.containerName));
                    // return Array.from(flatten(tree), navigationItem => toSymbolInformation(sourceFile, navigationItem, undefined));
                }).reduce((_prev, curr) => curr, []);
        });

        connection.onDidChangeConfiguration((_configurationParams) => {
            /**
             * Information about the host, for example 'Emacs 24.4' or
             * 'Sublime Text version 3075'
             */
            // hostInfo?: string;
            /**
             * If present, tab settings apply only to this file.
             */
            // file?: string;
            /**
             * The format options to use during formatting and other code editing features.
             */
            // formatOptions?: FormatCodeSettings;
            /**
             * The host's additional supported .js file extensions
             */
            // extraFileExtensions?: JsFileExtensionInfo[];

            const configureRequest: ts.server.protocol.ConfigureRequestArguments = _configurationParams.settings;
            this.projectService.setHostConfiguration(configureRequest);
        });

        connection.onRenameRequest((_renameParams: RenameParams): WorkspaceEdit => {
            return this.getProjectScriptInfoAt(_renameParams)
                .map(({project, scriptInfo, position}) => {
                    const renameInfo = project.getLanguageService().getRenameInfo(scriptInfo.fileName, position);
                    if (!renameInfo.canRename) {
                        throw new Error("This symbol cannot be renamed");
                    }
                    const changes: {[uri: string]: TextEdit[]} = {};

                    project.getLanguageService().findRenameLocations(scriptInfo.fileName, position, false, true)
                        .forEach((location: ts.RenameLocation) => {
                            const edit = toTextEdit(this.getSourceFile(project, location.fileName), location.textSpan, _renameParams.newName);
                            const editUri = path2uri(location.fileName);
                            if (changes[editUri]) {
                                changes[editUri].push(edit);
                            } else {
                                changes[editUri] = [edit];
                            }
                        });

                    return {
                        changes,
                    };
                }).reduce((_prev, curr) => curr, { changes: {}});
        });

        // This handler provides the initial list of the completion items.
        connection.onCompletion((_textDocumentPosition: TextDocumentPositionParams): CompletionItem[] => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const options: ts.GetCompletionsAtPositionOptions = {
                        includeExternalModuleExports: false
                    };
                    const completions = project.getLanguageService().getCompletionsAtPosition(scriptInfo.fileName, position, options);
                    return completions ?
                        completions.entries.map(toCompletionItem) :
                        [];

                }).reduce((_prev, curr) => curr, []);
        });

        connection.onDefinition((_textDocumentPosition: TextDocumentPositionParams): Location | Location[] => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const definitions = project.getLanguageService().getDefinitionAtPosition(scriptInfo.fileName, position);
                    return definitions.map(d => {
                        return toLocation(this.getSourceFile(project, d.fileName), d.textSpan);
                    });
                }).reduce((_prev, curr) => curr, []);
        });

        connection.onDocumentHighlight((_textDocumentPosition: TextDocumentPositionParams): DocumentHighlight[] => {
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const highlights = project.getLanguageService().getDocumentHighlights(scriptInfo.fileName, position, []);
                    if (highlights) {
                        const fileHighlights = highlights.find(hl => hl.fileName === scriptInfo.fileName);
                        if (fileHighlights) {
                            const sourceFile = this.getSourceFile(project, scriptInfo.fileName);
                            return fileHighlights.highlightSpans.map( hs => toDocumentHighlight(sourceFile, hs));
                        }
                    }
                    return [];
                }).reduce((_prev, curr) => curr, []);
        });

        connection.onSignatureHelp((_textDocumentPosition: TextDocumentPositionParams): SignatureHelp => {
            const empty: SignatureHelp = { signatures: [], activeParameter: 0, activeSignature: 0 };
            return this.getProjectScriptInfoAt(_textDocumentPosition)
                .map(({project, scriptInfo, position}) => {
                    const signatures = project.getLanguageService().getSignatureHelpItems(scriptInfo.fileName, position);
                    return toSignatureHelp(signatures);
                }).reduce((_prev, curr) => curr, empty);
        });

        connection.onExecuteCommand((params: ExecuteCommandParams): any => {
            switch (params.command) {
                case "codeFix":
                    if (!params.arguments || params.arguments.length < 1) {
                        throw new Error(`Command ${params.command} requires arguments`);
                    }
                    return this.executeCodeFixCommand(params.arguments);
                default:
                    throw new Error(`Unknown command ${params.command}`);
            }});

        connection.onCodeAction((_codeActionParams: CodeActionParams): Command[] => {
            return this.getProjectScriptInfoFor(_codeActionParams)
                .map( ({project, scriptInfo, start, end}) => {
                    const errorCodes = _codeActionParams.context.diagnostics
                        .map(c => c.code)
                        .filter(c => typeof c === "number") as number[];
                    const formatOptions = this.projectService.getFormatCodeOptions(scriptInfo.fileName);
                    const actions = project.getLanguageService().getCodeFixesAtPosition(scriptInfo.fileName, start, end, errorCodes, formatOptions);
                    return actions.map(toCommand);
                }).reduce((_prev, curr) => curr, []);
        });
    }

    private getSourceFile(project: ts.server.Project, fileName: string): ts.SourceFile {
        const scriptInfo = project.getScriptInfo(fileName);
        const sourceFile = project.getSourceFile(scriptInfo.path);
        if (!sourceFile) {
            throw new Error(`Source file ${fileName} not found`);
        }
        return sourceFile;
    }

    private getProjectScriptInfo(textDocument: TextDocumentIdentifier): ProjectScriptInfo[] {
        this.gcTimer.scheduleCollect(); // tsserver runs this on every request.
        const filePath = uri2path(textDocument.uri);
        const scriptInfo = this.projectService.getScriptInfoForNormalizedPath(ts.server.toNormalizedPath(filePath));

        let project: ts.server.Project;
        try {
            project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false);
        } catch (e) {
            this.connection.console.error(e.message + "\n" + e.stack);
            throw e;
        }
        return [{project, scriptInfo}];
    }

    private getProjectScriptInfoAt(params: TextDocumentPositionParams): ProjectScriptInfoLocation[] {
        return this.getProjectScriptInfo(params.textDocument)
            .map( ({project, scriptInfo}) => {
                const position = this.getPosition(params.position, scriptInfo);
                return {project, scriptInfo, position};
            });
    }

    private getProjectScriptInfoFor(params: TextDocumentRangeParams): ProjectScriptInfoRange[] {
        return this.getProjectScriptInfo(params.textDocument)
        .map( ({project, scriptInfo}) => {
            const start = this.getPosition(params.range.start, scriptInfo);
            const end = this.getPosition(params.range.end, scriptInfo);
            return {project, scriptInfo, start, end};
        });
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

    private combinedCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
        const diags: ReadonlyArray<ts.Diagnostic> = project.getLanguageService().getSyntacticDiagnostics(file)
            .concat(project.getLanguageService().getSemanticDiagnostics(file));
        this.connection.sendDiagnostics({
            uri: path2uri(file),
            diagnostics: diags.map(convertTsDiagnostic),
        });
    }

    // private convertFormattingOptions(formattingOptions: FormattingOptions): ts.FormatCodeOptions {
    //     return {
    //         TabSize: formatOptions.tabSize,
    //         ConvertTabsToSpaces: formatOptions.insertSpaces
    //     };
    // }

    // private semanticCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
    //     try {
    //         // let diags: ReadonlyArray<Diagnostic> = [];
    //         //TODO: re-enable
    //         // if (!isDeclarationFileInJSOnlyNonConfiguredProject(project, file)) {
    //         //   diags = project.getLanguageService().getSemanticDiagnostics(file);
    //         // }
    //         // TODO: combine these two.
    //         const diags: ReadonlyArray<ts.Diagnostic> = project.getLanguageService().getSemanticDiagnostics(file);
    //         this.connection.sendDiagnostics({
    //             uri: path2uri(file),
    //             diagnostics: diags.map(convertTsDiagnostic)
    //         });
    //     }
    //     catch (err) {
    //         this.logError(err, "semantic check");
    //     }
    // }

    // private syntacticCheck(file: ts.server.NormalizedPath, project: ts.server.Project) {
    //     try {
    //         const diags = project.getLanguageService().getSyntacticDiagnostics(file);
    //         if (diags) {
    //             this.connection.sendDiagnostics({
    //                 uri: path2uri(file),
    //                 diagnostics: diags.map(convertTsDiagnostic)
    //             });
    //             // const bakedDiags = diags.map((diag) => formatDiag(file, project, diag));
    //             // this.event<protocol.DiagnosticEventBody>({ file, diagnostics: bakedDiags }, "syntaxDiag");
    //         }
    //     }
    //     catch (err) {
    //         this.logError(err, "syntactic check");
    //     }
    // }

    private updateErrorCheck(next: NextStep, checkList: ts.server.PendingErrorCheck[], ms: number, requireOpen = true) {
        const seq = this.changeSeq;
        const followMs = Math.min(ms, 200);

        let index = 0;
        const checkOne = () => {
            if (this.changeSeq === seq) {
                const checkSpec = checkList[index];
                index++;
                if (checkSpec.project.containsFile(checkSpec.fileName, requireOpen)) {
                    this.combinedCheck(checkSpec.fileName, checkSpec.project);
                    if (checkList.length > index) {
                        next.delay(followMs, checkOne);
                    }

                    // this.syntacticCheck(checkSpec.fileName, checkSpec.project);
                    // if (this.changeSeq === seq) {
                    //     next.immediate(() => {
                    //         this.semanticCheck(checkSpec.fileName, checkSpec.project);
                    //         if (checkList.length > index) {
                    //             next.delay(followMs, checkOne);
                    //         }
                    //     });
                    // }
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
            case ts.server.ConfigFileDiagEvent:
                // TODO: send config file diagnostics
                this.connection.console.log("Received config file diagnostics: " + event.data.diagnostics.map(d => d.messageText).join(", "));
                // const { triggerFile, configFileName: configFile, diagnostics } = event.data;
                // const bakedDiags = map(diagnostics, diagnostic => formatConfigFileDiag(diagnostic, /*includeFileName*/ true));
                // this.event<protocol.ConfigFileDiagnosticEventBody>({
                //  triggerFile,
                //  configFile,
                //  diagnostics: bakedDiags
                // }, "configFileDiag");
                break;
            case ts.server.ProjectLanguageServiceStateEvent:
                const projectName = event.data.project.getProjectName();
                const isEnabled = event.data.languageServiceEnabled;
                this.connection.console.log(`Received lang service state event: project ${projectName} is ${isEnabled}`);
                // const eventName: protocol.ProjectLanguageServiceStateEventName = "projectLanguageServiceState";
                // this.event<protocol.ProjectLanguageServiceStateEventBody>({
                //  projectName: event.data.project.getProjectName(),
                //  languageServiceEnabled: event.data.languageServiceEnabled
                // }, eventName);
                break;
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

    // tslint:disable-next-line:no-empty
    private sendRequestCompletedEvent(_requestId: number): void {
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

    private executeCodeFixCommand(fileTextChanges: ts.FileTextChanges[]): void {
        if (fileTextChanges.length === 0) {
            throw new Error("No changes supplied for code fix command");
        }

        const changes: {[uri: string]: TextEdit[]} = {};
        for (const change of fileTextChanges) {
            const filePath = change.fileName;
            const project = this.projectService.getDefaultProjectForFile(ts.server.toNormalizedPath(filePath), false);
            const sourceFile = this.getSourceFile(project, filePath);
            const uri = path2uri(change.fileName);
            changes[uri] = change.textChanges.map(({span, newText}) => toTextEdit(sourceFile, span, newText));
        }
        const edit: WorkspaceEdit = { changes };
        this.connection.workspace.applyEdit(edit)
            .then(() => this.connection.console.log("aplied edit"));
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
        } finally {
            this.resetCurrentRequest(requestId);
        }
    }

    private logError(err: Error, cmd: string) {
        let msg = "Exception on executing command " + cmd;
        if (err.message) {
            msg += ":\n" + err.message; // + indent(err.message);
            if (err.stack) {
                msg += "\n" + err.stack; // indent((<StackTraceError>err).stack);
            }
        }
        this.logger.msg(msg, ts.server.Msg.Err);
    }
}

export function createSession(connection: IConnection, options: LSPSessionOptions): Session {
    return new Session(connection, options);
}
