import * as test from "tape";
import * as ts from "typescript/lib/tsserverlibrary";
import {convertTsDiagnostic} from "../src/protocol";

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
