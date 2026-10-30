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
import { createHash } from 'node:crypto'

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

/** Relative path, size and mtime of every file under `root`, in a stable order. */
function listing(root, base = root, out = []) {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name)
    const stat = fs.statSync(full)
    if (stat.isDirectory()) listing(full, base, out)
    else out.push([path.relative(base, full), stat.size, stat.mtimeMs])
  }
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
}

const STAMP = '.win-pilot-stamp'

/**
 * Copy `source` to `target` only when it changed since the last sync.
 *
 * The fingerprint covers every source file's path, size and mtime plus a caller
 * `key` (the package version). npm extracts every file with the same fixed
 * mtime, so the size/mtime listing alone cannot see an upgrade whose files keep
 * their sizes; the version in `key` covers that, and local rebuilds change mtimes.
 * The stamp is written last, so an interrupted or failed copy is redone next time.
 * @returns true when files were copied, false when the target was already current.
 */
export function syncTree(source, target, key = '') {
  const files = listing(source)
  const fingerprint = createHash('sha256').update(JSON.stringify([key, files])).digest('hex')
  const stampPath = path.join(target, STAMP)
  try {
    if (fs.readFileSync(stampPath, 'utf8') === fingerprint &&
        files.every(([relative, size]) => fs.statSync(path.join(target, relative)).size === size)) return false
  } catch { /* no stamp or a missing file: copy */ }
  try { fs.unlinkSync(stampPath) } catch { /* first copy */ }
  copyTree(source, target)
  fs.writeFileSync(stampPath, fingerprint)
  return true
}
