import * as test from "tape";
import * as ts from "typescript/lib/tsserverlibrary";
import { ScriptElementKind } from "typescript/lib/tsserverlibrary";
import { CompletionItemKind, TextDocumentPositionParams } from "vscode-languageserver-protocol";
import {convertTsDiagnostic, toCompletionItem} from "../src/protocol";

test("toDiagnostic", t => {

    const sourceFile = ts.createSourceFile("asdf.ts", "", ts.ScriptTarget.ES2015);

    const tsDiag: ts.Diagnostic = {
        file: sourceFile,
        start: 44,
        length: 0,
        messageText: "message",
        category: ts.DiagnosticCategory.Error,
        code: 123
    };

    const diag = convertTsDiagnostic(tsDiag);
    t.isEqual(0, diag.range.start.line);
    t.isEqual(44, diag.range.start.character);
    t.isEqual(0, diag.range.end.line);
    t.isEqual(44, diag.range.end.character);

    t.end();

});

test("toCompletionItem", t => {
    const sourceFile = ts.createSourceFile("asdf.ts", "", ts.ScriptTarget.ES2015);

    const position: TextDocumentPositionParams = {
        textDocument: {
            uri: "path/to/file.ts",
        },
        position: {
            line: 1,
            character: 1
        }
    };

    const entry: ts.CompletionEntry = {
        name: "DocumentColorRequest",
        sortText: "DocumentColorRequest",
        kind: ScriptElementKind.classElement,
        source: "/Users/tomv/Projects/tomv564/lsp-tsserver/node_modules/vscode-languageserver-protocol/lib/protocol.colorProvider.proposed",
        hasAction: true,
    };

    const item = toCompletionItem(entry, position);

    t.isEqual(item.data.source, entry.source);
    t.end();

});
