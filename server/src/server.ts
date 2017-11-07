/* --------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License. See License.txt in the project root for license information.
 * ------------------------------------------------------------------------------------------ */
'use strict';

import {
	StreamMessageReader, StreamMessageWriter, createConnection, IConnection,
} from 'vscode-languageserver';
import { createSession } from './session';

// const options: ts.server.ProjectServiceOptions = {

// }

// Create a connection for the server. The connection uses stdin/stdout as a transport
let connection: IConnection = createConnection(new StreamMessageReader(process.stdin), new StreamMessageWriter(process.stdout));

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
// 	lspSample: ExampleSettings;
// }

// These are the example settings we defined in the client's package.json
// file
// interface ExampleSettings {
// 	maxNumberOfProblems: number;
// }

// hold the maxNumberOfProblems setting
// let maxNumberOfProblems: number;
// The settings have changed. Is send on server activation
// as well.
connection.onDidChangeConfiguration((_change) => {
	connection.console.log('We recevied an config change event');

	// let settings = <Settings>change.settings;
	// maxNumberOfProblems = settings.lspSample.maxNumberOfProblems || 100;
	// Revalidate any open text documents
	// documents.all().forEach(validateTextDocument);
});

connection.onDidChangeWatchedFiles((_change) => {
	// Monitored files have change in VSCode
	connection.console.log('We recevied an file change event');
});

// diagnostics code from session.ts
createSession(connection)

// TODO: shutdown session on exit?

// Listen on the connection
connection.listen();
