import * as ts from "typescript/lib/tsserverlibrary";
import { CodeAction, Command, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, DocumentHighlight, DocumentHighlightKind, Hover, Location, MarkedString, ParameterInformation, Range, SignatureHelp, SignatureInformation, SymbolInformation, SymbolKind, TextDocumentIdentifier, TextDocumentPositionParams, TextEdit } from "vscode-languageserver-protocol";
import {path2uri} from "./util";

/**
 * Maps string-based CompletionEntry::kind to enum-based CompletionItemKind
 */
export const completionKinds: { [name: string]: CompletionItemKind } = {
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

export enum CommandNames {
    CodeFix = "codeFix",
    Refactor = "refactor"
}

// should be global functions and classes + members + ctors
export const relevantDocumentSymbols: ts.ScriptElementKind[] = [
    ts.ScriptElementKind.classElement,
    ts.ScriptElementKind.interfaceElement,
    ts.ScriptElementKind.functionElement,
    // ts.ScriptElementKind.constElement, // TODO: only if module-level!
    // ts.ScriptElementKind.letElement,
    ts.ScriptElementKind.memberFunctionElement,
    // ts.ScriptElementKind.localFunctionElement,
    ts.ScriptElementKind.memberGetAccessorElement,
    ts.ScriptElementKind.memberSetAccessorElement,
    ts.ScriptElementKind.memberVariableElement
];

function getSymbolKind(scriptElementKind: ts.ScriptElementKind): SymbolKind {
    switch (scriptElementKind) {
        case ts.ScriptElementKind.classElement:
        case ts.ScriptElementKind.localClassElement:
            return SymbolKind.Class;
        case ts.ScriptElementKind.moduleElement:
            return SymbolKind.Module;
        case ts.ScriptElementKind.interfaceElement:
            return SymbolKind.Interface;
        case ts.ScriptElementKind.enumElement:
            return SymbolKind.Enum;
        case ts.ScriptElementKind.enumMemberElement:
            return SymbolKind.Field;
        case ts.ScriptElementKind.functionElement:
        case ts.ScriptElementKind.localFunctionElement:
            return SymbolKind.Function;
        case ts.ScriptElementKind.variableElement:
        case ts.ScriptElementKind.localVariableElement:
        case ts.ScriptElementKind.constElement:
        case ts.ScriptElementKind.letElement:
            return SymbolKind.Variable;
        case ts.ScriptElementKind.constructorImplementationElement:
            return SymbolKind.Constructor;
        case ts.ScriptElementKind.memberFunctionElement:
            return SymbolKind.Method;
        case ts.ScriptElementKind.memberGetAccessorElement:
        case ts.ScriptElementKind.memberSetAccessorElement:
            return SymbolKind.Property;
        case ts.ScriptElementKind.memberVariableElement:
            return SymbolKind.Field;
    }

    return SymbolKind.Variable;
}

/**
 * Common structural base for range-based text document commands like Code Actions.
 */
export interface TextDocumentRangeParams {
   /**
    * The document in which the command was invoked.
    */
   textDocument: TextDocumentIdentifier;
   /**
    * The range for which the command was invoked.
    */
   range: Range;
}

/**
 * Converts a TypeScript Diagnostic to an LSP Diagnostic
 */
export function convertTsDiagnostic(diagnostic: ts.Diagnostic): Diagnostic {
    const text = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    let range: Range = { start: {character: 0, line: 0}, end: {character: 0, line: 0} };
    if (diagnostic.file) {
        if (diagnostic.start != null && diagnostic.length != null) {
            range = {
                start: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start),
                end: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length),
            };
        }
    }
    return {
        range,
        message: text,
        severity: convertDiagnosticCategory(diagnostic.category),
        code: diagnostic.code,
        source: diagnostic.source || "ts",
    };
}

function getHighlightKind(tsKind: ts.HighlightSpanKind): DocumentHighlightKind {
    switch (tsKind) {
        case ts.HighlightSpanKind.reference:
            return DocumentHighlightKind.Read;
        case ts.HighlightSpanKind.writtenReference:
            return DocumentHighlightKind.Write;
        default:
            return DocumentHighlightKind.Text;
    }
}

export function toDocumentHighlight(sourceFile: ts.SourceFile, span: ts.HighlightSpan): DocumentHighlight {
    return {
        range: toRange(sourceFile, span.textSpan),
        kind: getHighlightKind(span.kind)
    };
}

export function toCompletionItem(sourceFile: ts.SourceFile, entry: ts.CompletionEntry, textDocumentPosition: TextDocumentPositionParams): CompletionItem {
    const item: CompletionItem = { label: entry.name };
    const completionKind = completionKinds[entry.kind];
    if (completionKind && typeof(completionKind) === "number") {
        item.kind = completionKind;
    }
    if (entry.insertText) {
        item.insertText = entry.insertText;
    }
    if (entry.replacementSpan) {
        // TODO: make a textEdit, need sourceFile
        item.textEdit = toTextEdit(sourceFile, entry.replacementSpan, entry.insertText);
    }
    if (entry.sortText) {
        item.sortText = entry.sortText;
    }

    // context for future resolve requests:
    item.data = {
        textDocument: textDocumentPosition.textDocument,
        position: textDocumentPosition.position,
        source: entry.source
    };
    return item;
}

export function applyCompletionEntryDetails(sourceFile: ts.SourceFile, entryDetails: ts.CompletionEntryDetails, item: CompletionItem): void {
    if (entryDetails.codeActions) {
        item.additionalTextEdits = [];
        entryDetails.codeActions.forEach(action => {
            action.changes.forEach(change => {
                // only support additional edits on current file.
                if (change.fileName === sourceFile.fileName) {
                    const edits = change.textChanges.map(tc => toTextEdit(sourceFile, tc.span, tc.newText));
                    item.additionalTextEdits.push(...edits);
                }
            });
        });
    }
}

export function itemToSymbolInformation(sourceFile: ts.SourceFile, treeItem: ts.NavigateToItem): SymbolInformation {
    const symbolKind: SymbolKind = getSymbolKind(treeItem.kind);
    const {range, uri} = toLocation(sourceFile, treeItem.textSpan);

    return SymbolInformation.create(`${treeItem.name} (${treeItem.kind})`, symbolKind, range, uri);
}

export function treeToSymbolInformation(sourceFile: ts.SourceFile, treeItem: ts.NavigationTree, containerName?: string): SymbolInformation {
    const symbolKind: SymbolKind = getSymbolKind(treeItem.kind);
    const {range, uri} = toLocation(sourceFile, treeItem.spans[0]);

    return SymbolInformation.create(`${treeItem.text} (${treeItem.kind})`, symbolKind, range, uri, containerName);
}

export function actionToCommand(action: ts.CodeAction): Command {
    return {
        title: action.description,
        command: CommandNames.CodeFix,
        arguments: action.changes,
    };
}

export interface RefactorCommand {
    fileName: string;
    positionOrRange: number | ts.TextRange;
    refactorName: string;
    actionName: string;
}

export function refactorToCodeActions(refactor: ts.ApplicableRefactorInfo, fileName: string, positionOrRange: number | ts.TextRange): CodeAction[] {

    return refactor.actions.map( action => {
        const args: RefactorCommand = {
            fileName,
            positionOrRange,
            refactorName: refactor.name,
            actionName: action.name
        };

        return {
            title: action.description,
            command: {
                title: action.description,
                command: CommandNames.Refactor,
                arguments: [args]
            }
        };
    });
}

export function refactorToCommands(refactor: ts.ApplicableRefactorInfo, fileName: string, positionOrRange: number | ts.TextRange): Command[] {

    return refactor.actions.map( action => {
        const args: RefactorCommand = {
            fileName,
            positionOrRange,
            refactorName: refactor.name,
            actionName: action.name
        };

        return {
            title: action.description,
            command: CommandNames.Refactor,
            arguments: [args]
        };
    });
}

function toRange(sourceFile: ts.SourceFile, span: ts.TextSpan) {
    const start = ts.getLineAndCharacterOfPosition(sourceFile, span.start);
    const end = ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length);
    return {start, end};
}

export function toLocation(sourceFile: ts.SourceFile, span: ts.TextSpan): Location {
    const start = ts.getLineAndCharacterOfPosition(sourceFile, span.start);
    const end = ts.getLineAndCharacterOfPosition(sourceFile, span.start + span.length);
    return {
        uri: path2uri(sourceFile.fileName),
        range: {start, end}
    };
}

export function toTextEdit(sourceFile: ts.SourceFile, textSpan: ts.TextSpan, newName: string): TextEdit {
    const start = ts.getLineAndCharacterOfPosition(sourceFile, textSpan.start);
    const end = ts.getLineAndCharacterOfPosition(sourceFile, textSpan.start + textSpan.length);
    return { range: { start, end }, newText: newName };
}

export function toSignatureHelp(signatures: ts.SignatureHelpItems): SignatureHelp {
    const signatureInformations = signatures.items.map((item): SignatureInformation => {
        const prefix = ts.displayPartsToString(item.prefixDisplayParts);
        const params = item.parameters.map((p) => ts.displayPartsToString(p.displayParts)).join(", ");
        const suffix = ts.displayPartsToString(item.suffixDisplayParts);
        const parameters = item.parameters.map((p): ParameterInformation => ({
            label: ts.displayPartsToString(p.displayParts),
            documentation: ts.displayPartsToString(p.documentation),
        }));
        return {
            label: prefix + params + suffix,
            documentation: ts.displayPartsToString(item.documentation),
            parameters,
        };
    });

    return {
        signatures: signatureInformations,
        activeSignature: signatures.selectedItemIndex,
        activeParameter: signatures.argumentIndex,
    };
}

export function toHover(info: ts.QuickInfo): Hover {
    const contents: Array<MarkedString | string> = [];
    // Add declaration without the kind
    const declaration = ts.displayPartsToString(info.displayParts).replace(/^\(.+?\)\s+/, "");
    contents.push({ language: "typescript", value: declaration });
    // Add kind with modifiers, e.g. "method (private, ststic)", "class (exported)"
    if (info.kind) {
        let kind = "**" + info.kind + "**";
        const modifiers = info.kindModifiers
            .split(",")
            // Filter out some quirks like "constructor (exported)"
            .filter((mod) => mod && (
                mod !== ts.ScriptElementKindModifier.exportedModifier
                || info.kind !== ts.ScriptElementKind.constructorImplementationElement
            ))
            // Make proper adjectives
            .map((mod) => {
                switch (mod) {
                    case ts.ScriptElementKindModifier.ambientModifier: return "ambient";
                    case ts.ScriptElementKindModifier.exportedModifier: return "exported";
                    default: return mod;
                }
            });
        if (modifiers.length > 0) {
            kind += " _(" + modifiers.join(", ") + ")_";
        }
        contents.push(kind);
    }
    // Add documentation
    const documentation = ts.displayPartsToString(info.documentation);
    if (documentation) {
        contents.push(documentation);
    }

    return {
        contents
    };
}

/**
 * Converts a diagnostic category to an LSP DiagnosticSeverity
 *
 * @param category The Typescript DiagnosticCategory
 */
export function convertDiagnosticCategory(category: ts.DiagnosticCategory): DiagnosticSeverity {
    switch (category) {
        case ts.DiagnosticCategory.Error:
            return DiagnosticSeverity.Error;
        case ts.DiagnosticCategory.Warning:
            return DiagnosticSeverity.Warning;
        case ts.DiagnosticCategory.Message:
            return DiagnosticSeverity.Information;
        case ts.DiagnosticCategory.Suggestion:
            return DiagnosticSeverity.Hint;
    }
}
