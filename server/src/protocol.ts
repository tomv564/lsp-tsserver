import * as ts from "typescript/lib/tsserverlibrary";
import { Command, CompletionItem, CompletionItemKind, Diagnostic, DiagnosticSeverity, Hover, Location, MarkedString, ParameterInformation, Range, SignatureHelp, SignatureInformation, TextDocumentIdentifier, TextEdit, SymbolInformation, SymbolKind } from "vscode-languageserver-protocol";
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
    if (diagnostic.file && diagnostic.start && diagnostic.length) {
        range = {
            start: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start),
            end: diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start + diagnostic.length),
        };
    }
    return {
        range,
        message: text,
        severity: convertDiagnosticCategory(diagnostic.category),
        code: diagnostic.code,
        source: diagnostic.source || "ts",
    };
}

export function toCompletionItem(entry: ts.CompletionEntry): CompletionItem {
    const item: CompletionItem = { label: entry.name };

    const kind = completionKinds[entry.kind];
    if (kind && typeof(kind) === "number") {
        item.kind = kind;
    }
    if (entry.sortText) {
        item.sortText = entry.sortText;
    }

    // context for future resolve requests:
    // item.data = {
    //  uri,
    //  offset,
    //  entryName: entry.name,
    // }
    return item;
}

export function toSymbolInformation(navigationItem: ts.NavigationTree): SymbolInformation {
    return SymbolInformation.create(navigationItem.text, SymbolKind.Class, Range.create(0, 0, 0, 0))
}

export function toCommand(action: ts.CodeAction): Command {
    return {
        title: action.description,
        command: "codeFix",
        arguments: action.changes,
    };
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
            // unmapped: DiagnosticSeverity.Hint
    }
}
