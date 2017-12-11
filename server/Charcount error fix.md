Cannot read property 'charCount' of undefined
TypeError: Cannot read property 'charCount' of undefined
    at LineNode.walk (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:99740:68)
    at LineIndex.edit (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:99621:31)
    at ScriptVersionCache._getSnapshot (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:99417:47)
    at ScriptVersionCache.getSnapshot (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:99410:82)
    at ScriptVersionCache.edit (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:99407:26)
    at TextStorage.edit (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:99951:51)
    at ScriptInfo.editContent (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:100247:34)
    at ProjectService.applyChangesToFile (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\typescript\lib\tsserverlibrary.js:103891:32)
    at Session.connection.onDidChangeTextDocument (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\build\session.js:99:37)
    at handleNotification (c:\Users\tvanommeren\Projects\tomv564\lsp-tsserver\server\node_modules\vscode-jsonrpc\lib\main.js:476:43):
Notification handler 'textDocument/didChange' failed with message: Cannot read property 'charCount' of undefined:

In case II of

childCharCount = this.children[childIndex].charCount();




ScriptVersionCache.getSnapshot - how many changes does it have (all with full content replacements?)
private static readonly changeNumberThreshold = 8;
private static readonly changeLengthThreshold = 256;
(easily busted)


What is LineIndex vs LineNode?
LineIndex.edit(pos: = 0, deleteLength: len(originalText), newText?: string))

this.root.walk(pos, deleteLength, walker: EditWalker) <- after deletions, put the walker at insert start (should be 0)
walker.insertLines(..)


action plan:
add logging of didChange (the whole file or sections of diff only?)
try different versions of TS (add as peer dependency?)

Fix in TS js directly:
avoid the first skipChild when adjustedStart (0) >= childCharCount (0?)


review changes:

Removed check around walk code if pos < this.root.charCount()
https://github.com/Microsoft/TypeScript/commit/e29b2106e9545fddb5f185e42810499d4caa8abc#diff-45850e2688313eda8f8c5ed552960ae3

