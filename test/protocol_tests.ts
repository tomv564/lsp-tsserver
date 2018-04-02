import * as test from "tape";
import * as ts from "typescript/lib/tsserverlibrary";
import {convertTsDiagnostic} from "../src/protocol";

test("toDiagnostic", t => {

    const sourceFile = ts.createSourceFile("asdf.ts", "", ts.ScriptTarget.ES2015);
    // const sourceFile: ts.SourceFile = {
    //     fileName: "asdf.ts",
    //     kind: ts.SyntaxKind.SourceFile,
    //     statements: [],
    //     endOfFileToken: ts.createToken(ts.SyntaxKind.EndOfFileToken)
    // };

    const tsDiag: ts.Diagnostic = {
        file: sourceFile,
        start: 44,
        length: 0,
        messageText: "message",
        category: ts.DiagnosticCategory.Error,
        code: 123
    };
    const diag = convertTsDiagnostic(tsDiag);
    t.equals(0, diag.range.start);
    t.notEquals(0, diag.range.end);

    t.end();

});
