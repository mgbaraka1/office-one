// backup.js — zero-dependency ZIP writer for the on-demand "Backup Projects"
// feature. Zips an entire directory tree (the userData/projects/ folder) into a
// single .zip file the user chooses from a save dialog.
//
// Why hand-rolled instead of `archiver`/`adm-zip`: this app deliberately ships
// ZERO native modules (only pure-JS bcryptjs) so a fresh clone "just works" with
// no Electron rebuild. A ZIP archive of a tree of small files is a small, well
// understood format, and Node's built-in `node:zlib` already gives us the two
// primitives it needs — `deflateRawSync` (the raw DEFLATE stream a ZIP entry
// stores, method 8) and a CRC-32. So we add no dependency and no build step.
//
// Scope: project documents are small PDFs/images, so we build the archive in
// memory and write it once. This is intentionally simple, not a streaming
// archiver — if project storage ever grows to hundreds of MB, revisit.

const fs   = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

// ── CRC-32 ────────────────────────────────────────────────────────────────
// ZIP stores a CRC-32 of each entry's *uncompressed* bytes. Use the built-in
// (Node ≥ 22.2 / the Node 24 inside Electron 42) when present, else a tiny
// table-based fallback so the file is self-contained and version-tolerant.
const crc32 = (function () {
  if (typeof zlib.crc32 === 'function') return (buf) => zlib.crc32(buf) >>> 0;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    table[n] = c >>> 0;
  }
  return (buf) => {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = table[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  };
})();

// Convert a JS Date to the packed DOS date/time fields ZIP headers use.
function dosDateTime(date) {
  const d = (date instanceof Date && !isNaN(date)) ? date : new Date();
  let year = d.getFullYear();
  if (year < 1980) year = 1980;          // DOS epoch floor
  const time = ((d.getHours()   & 0x1F) << 11)
             | ((d.getMinutes() & 0x3F) << 5)
             | ((d.getSeconds() >> 1)   & 0x1F);
  const dosDate = (((year - 1980) & 0x7F) << 9)
                | (((d.getMonth() + 1) & 0x0F) << 5)
                | (d.getDate() & 0x1F);
  return { time: time & 0xFFFF, date: dosDate & 0xFFFF };
}

// Recursively collect files under `dir`, each with a ZIP entry name relative to
// `dir` using forward slashes (so {projectId}/documents/{file} is preserved).
function walkFiles(dir, baseDir, out) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); }
  catch { return out; }                  // unreadable/missing — treat as empty
  // Stable, predictable order.
  entries.sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const abs = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      walkFiles(abs, baseDir, out);
    } else if (ent.isFile()) {
      const rel = path.relative(baseDir, abs).split(path.sep).join('/');
      out.push({ abs, name: rel });
    }
    // symlinks / sockets / etc. are skipped — project files are plain files
  }
  return out;
}

// Build one ZIP entry: returns { local, central } buffers + the byte length of
// the local record (so the caller can track central-directory offsets).
function buildEntry(name, data, offset) {
  const nameBuf = Buffer.from(name, 'utf8');
  const crc = crc32(data);
  const { time, date } = dosDateTime(new Date());

  // Deflate; if it doesn't actually shrink (tiny/already-compressed files),
  // store uncompressed (method 0) so we never inflate the archive.
  let method = 8;
  let body = zlib.deflateRawSync(data);
  if (body.length >= data.length) { method = 0; body = data; }

  // General-purpose bit 11 = filename is UTF-8.
  const flags = 0x0800;

  const local = Buffer.alloc(30 + nameBuf.length);
  local.writeUInt32LE(0x04034b50, 0);    // local file header signature
  local.writeUInt16LE(20, 4);            // version needed to extract (2.0)
  local.writeUInt16LE(flags, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(time, 10);
  local.writeUInt16LE(date, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(body.length, 18);  // compressed size
  local.writeUInt32LE(data.length, 22);  // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);            // extra field length
  nameBuf.copy(local, 30);

  const central = Buffer.alloc(46 + nameBuf.length);
  central.writeUInt32LE(0x02014b50, 0);  // central directory header signature
  central.writeUInt16LE(20, 4);          // version made by
  central.writeUInt16LE(20, 6);          // version needed to extract
  central.writeUInt16LE(flags, 8);
  central.writeUInt16LE(method, 10);
  central.writeUInt16LE(time, 12);
  central.writeUInt16LE(date, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(body.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt16LE(0, 30);          // extra field length
  central.writeUInt16LE(0, 32);          // file comment length
  central.writeUInt16LE(0, 34);          // disk number start
  central.writeUInt16LE(0, 36);          // internal file attributes
  central.writeUInt32LE(0, 38);          // external file attributes
  central.writeUInt32LE(offset, 42);     // offset of local header
  nameBuf.copy(central, 46);

  return { local, body, central, localSize: local.length + body.length };
}

// Zip the directory tree rooted at `srcDir` into a single file at `destPath`.
// A missing or empty `srcDir` still produces a valid (empty) ZIP and returns
// fileCount: 0, so callers can message the empty case without special-casing.
// Returns { fileCount, byteCount } — byteCount is total uncompressed bytes.
function zipDirectory(srcDir, destPath) {
  const files = walkFiles(srcDir, srcDir, []);

  const localParts = [];
  const centralParts = [];
  let offset = 0;
  let byteCount = 0;

  for (const f of files) {
    let data;
    try { data = fs.readFileSync(f.abs); }
    catch { continue; }                  // file vanished mid-backup — skip it
    byteCount += data.length;
    const entry = buildEntry(f.name, data, offset);
    localParts.push(entry.local, entry.body);
    centralParts.push(entry.central);
    offset += entry.localSize;
  }

  const centralBuf = Buffer.concat(centralParts);
  const centralSize = centralBuf.length;
  const centralOffset = offset;
  const fileCount = localParts.length / 2;  // two buffers pushed per file

  // End of central directory record.
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);     // EOCD signature
  eocd.writeUInt16LE(0, 4);              // number of this disk
  eocd.writeUInt16LE(0, 6);              // disk where central directory starts
  eocd.writeUInt16LE(fileCount, 8);      // central directory records on this disk
  eocd.writeUInt16LE(fileCount, 10);     // total central directory records
  eocd.writeUInt32LE(centralSize, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  eocd.writeUInt16LE(0, 20);             // comment length

  const archive = Buffer.concat([...localParts, centralBuf, eocd]);
  fs.writeFileSync(destPath, archive);

  return { fileCount, byteCount };
}

module.exports = { zipDirectory };
