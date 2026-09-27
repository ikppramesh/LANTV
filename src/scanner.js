const fs = require("fs");
const path = require("path");

function isExcludedDir(name, excludeDirNames) {
  if (name.startsWith(".")) return true;
  return excludeDirNames.some((ex) => ex.toLowerCase() === name.toLowerCase());
}

function walk(dir, extensions, excludeDirNames, out) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    console.warn(`[scanner] cannot read ${dir}: ${err.message}`);
    return;
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (isExcludedDir(entry.name, excludeDirNames)) continue;
      walk(full, extensions, excludeDirNames, out);
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (extensions.includes(ext)) out.push(full);
    }
  }
}

function scanLibraries(libraries, extensions, excludeDirNames) {
  const out = [];
  for (const lib of libraries) {
    if (!fs.existsSync(lib)) {
      console.warn(`[scanner] library path not found (skipping): ${lib}`);
      continue;
    }
    walk(lib, extensions, excludeDirNames, out);
  }
  return out;
}

function cleanTitle(filePath) {
  const base = path.basename(filePath, path.extname(filePath));
  return base.replace(/[._]/g, " ").replace(/\s+/g, " ").trim();
}

module.exports = { scanLibraries, cleanTitle };
