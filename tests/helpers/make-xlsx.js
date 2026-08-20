// Builds a real .xlsx in memory, so the xlsx reader is tested against the
// structure Excel actually writes rather than a hand-rolled stand-in.
//
// A binary fixture would have been less code and worth less: it is opaque in
// review, it can only ever be the one workbook I happened to save, and the
// interesting cases here are the ones that are awkward to produce by hand. A
// date is a serial number whose meaning lives in a style; a string is an index
// into a shared table; a row with a gap in it skips the cell entirely. All of
// those are one argument away here.
const zlib = require("node:zlib");

const crc32 = zlib.crc32 || (() => {
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[i] = c;
  }
  return (buf) => {
    let c = -1;
    for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ -1) >>> 0;
  };
})();

/** Days since 1899-12-30, the way Excel counts them. */
function toSerial(iso, time) {
  const [y, m, d] = iso.split("-").map(Number);
  const days = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
  if (!time) return days;
  const [hh, mm, ss] = time.split(":").map(Number);
  return days + (hh * 3600 + mm * 60 + (ss || 0)) / 86400;
}

function zip(files) {
  const chunks = [], central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const body = Buffer.isBuffer(data) ? data : Buffer.from(data, "utf8");
    const deflated = zlib.deflateRawSync(body);
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(body);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);            // version needed
    local.writeUInt16LE(8, 8);             // deflate
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(deflated.length, 18);
    local.writeUInt32LE(body.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    chunks.push(local, nameBuf, deflated);

    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(8, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(deflated.length, 20);
    dir.writeUInt32LE(body.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    central.push(dir, nameBuf);

    offset += local.length + nameBuf.length + deflated.length;
  }
  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...chunks, centralBuf, eocd]);
}

const esc = (s) => String(s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const colName = (i) => {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
};

/**
 * grid: rows of cells. A cell is a plain string or number, or:
 *   { date: "2026-08-12", time: "08:18:17" }  a date cell (serial + date style)
 *   { time: "08:18:17" }                      a time-only cell
 *   { inline: "text" }                        an inline string, not shared
 *   null                                      the cell is absent from the row
 * opts.date1904 writes a Mac workbook.
 */
function makeXlsx(grid, opts = {}) {
  const shared = [];
  const sharedIndex = new Map();
  const intern = (s) => {
    if (!sharedIndex.has(s)) { sharedIndex.set(s, shared.length); shared.push(s); }
    return sharedIndex.get(s);
  };

  const rowsXml = grid.map((cells, r) => {
    const cellsXml = cells.map((cell, c) => {
      if (cell == null) return "";
      const ref = `${colName(c)}${r + 1}`;
      if (typeof cell === "object" && cell.inline != null) {
        return `<c r="${ref}" t="inlineStr"><is><t>${esc(cell.inline)}</t></is></c>`;
      }
      if (typeof cell === "object" && (cell.date || cell.time)) {
        const style = cell.date ? 1 : 2;                 // see cellXfs below
        const serial = cell.date ? toSerial(cell.date, cell.time) : toSerial("1899-12-30", cell.time);
        return `<c r="${ref}" s="${style}"><v>${serial}</v></c>`;
      }
      if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
      return `<c r="${ref}" t="s"><v>${intern(String(cell))}</v></c>`;
    }).join("");
    return `<row r="${r + 1}">${cellsXml}</row>`;
  }).join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<sheetData>${rowsXml}</sheetData></worksheet>`;

  const sst = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${shared.length}" uniqueCount="${shared.length}">` +
    shared.map((s) => `<si><t>${esc(s)}</t></si>`).join("") + `</sst>`;

  // xf 0 general, xf 1 numFmtId 14 (m/d/yyyy), xf 2 numFmtId 21 (h:mm:ss).
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<cellXfs count="3"><xf numFmtId="0"/><xf numFmtId="14" applyNumberFormat="1"/>` +
    `<xf numFmtId="21" applyNumberFormat="1"/></cellXfs></styleSheet>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    (opts.date1904 ? `<workbookPr date1904="1"/>` : "") +
    `<sheets><sheet name="${esc(opts.sheetName || "Sheet1")}" sheetId="1" r:id="rId1"/></sheets></workbook>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
    `<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" ` +
    `Target="worksheets/${opts.sheetFile || "sheet1.xml"}"/></Relationships>`;

  return zip([
    { name: "[Content_Types].xml", data: `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>` },
    { name: "_rels/.rels", data: `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>` },
    { name: "xl/workbook.xml", data: workbook },
    { name: "xl/_rels/workbook.xml.rels", data: wbRels },
    { name: "xl/sharedStrings.xml", data: sst },
    { name: "xl/styles.xml", data: styles },
    { name: `xl/worksheets/${opts.sheetFile || "sheet1.xml"}`, data: sheet },
  ]);
}

/** The same bytes as an ArrayBuffer, which is what the reader takes. */
function makeXlsxBuffer(grid, opts) {
  const b = makeXlsx(grid, opts);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
}

module.exports = { makeXlsx, makeXlsxBuffer, toSerial, zip };
