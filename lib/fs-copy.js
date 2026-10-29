// Directory copy that survives localized profile paths.
//
// `fs.cpSync` cannot be used on Windows: when the source path contains non-ASCII
// characters it terminates the process with 0xC0000409 instead of throwing, so a
// `try`/`catch` cannot keep the host alive. Reproduced on Node 22.22 and 25.2 with
// a directory named 工作, and the fix matters because the package lives under
// `C:\Users\<name>\.dsh` where <name> is often Chinese.
//
// `readdirSync` + `mkdirSync` + `copyFileSync` handle those paths on every Node
// version this project supports, so the walk is explicit. A symlink is followed
// (copyFileSync always writes the target contents), which matches the previous
// `dereference: true` behaviour for the trees copied here.
import fs from 'node:fs'
import path from 'node:path'

export function copyTree(source, target) {
  fs.mkdirSync(target, { recursive: true })
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    const from = path.join(source, entry.name), to = path.join(target, entry.name)
    // A directory link must be walked, not copied as a file.
    const directory = entry.isDirectory() || (entry.isSymbolicLink() && fs.statSync(from).isDirectory())
    if (directory) copyTree(from, to)
    else fs.copyFileSync(from, to)
  }
}
