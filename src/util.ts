import * as url from "url";

/**
 * Converts an abolute path to a file:// uri
 *
 * @param path an absolute path
 */
export function path2uri(path: string): string {
    // Require a leading slash, on windows prefixed with drive letter
    if (!/^(?:[a-z]:)?[\\\/]/i.test(path)) {
        throw new Error(`${path} is not an absolute path`);
    }

    const parts = path.split(/[\\\/]/);

    // If the first segment is a Windows drive letter, prefix with a slash and skip encoding
    let head = parts.shift()!;
    if (head !== "") {
        head = "/" + head;
    } else {
        head = encodeURIComponent(head);
    }

    return `file://${head}/${parts.map(encodeURIComponent).join("/")}`;
}

/**
 * Converts a uri to an absolute path.
 * The OS style is determined by the URI. E.g. `file:///c:/foo` always results in `c:\foo`
 *
 * @param uri a file:// uri
 */
export function uri2path(uri: string): string {
    const parts = url.parse(uri);
    if (parts.protocol !== "file:") {
        throw new Error("Cannot resolve non-file uri to path: " + uri);
    }

    let filePath = parts.pathname || "";

    // If the path starts with a drive letter, return a Windows path
    if (/^\/[a-z]:\//i.test(filePath)) {
        filePath = filePath.substr(1).replace(/\//g, "\\");
    }

    return decodeURIComponent(filePath);
}

// from compiler/core.ts

export function mapDefined<T, U>(array: ReadonlyArray<T> | undefined, mapFn: (x: T, i: number) => U | undefined): U[] {
    const result: U[] = [];
    if (array) {
        for (let i = 0; i < array.length; i++) {
            const item = array[i];
            const mapped = mapFn(item, i);
            if (mapped !== undefined) {
                result.push(mapped);
            }
        }
    }
    return result;
}
