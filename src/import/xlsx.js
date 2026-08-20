// Reading an .xlsx, with no library.
//
// Every importer in this app takes CSV, and every time somebody opens a CSV on
// a phone to look at it, it comes back as a spreadsheet. Telling the coach to
// Save As CSV works and is a bad answer: on a phone that is four screens of
// fiddling, and the file he was sent is right there.
//
// An .xlsx is a ZIP holding XML. Two things make this cheap enough to do by
// hand rather than shipping a megabyte of SheetJS into a PWA that has to work
// offline:
//
//   * Browsers inflate for us now. DecompressionStream("deflate-raw") is the
//     entire decompression story (Chrome 103+, Safari 16.4+, Firefox 113+).
//   * The XML is machine-written and regular, so it is scanned rather than
//     DOM-parsed. That also keeps this file runnable in Node, which is what
//     lets tests/xlsx-import.spec.js run it against real Excel output.
//
// The output is CSV TEXT, deliberately. Nothing downstream learns a new shape:
// parseScaleCsv and the nutrition importer keep taking a string, and every
// tolerance they have already earned for odd dates and missing readings keeps
// applying. See [[the header of parseScaleCsv in app.js]].
//
// What it does NOT do: formulas (the cached value is read, which is what was
// on screen), charts, multiple sheets (the first one, in workbook order),
// merged cell fill-down, or anything about formatting beyond working out
// whether a number is a date.
(function () {
  "use strict";

  const te = new TextDecoder("utf-8");

  // ---- ZIP ----

  /** "PK\x03\x04". Cheap enough to run on every import. */
  function looksLikeZip(bytes) {
    return !!bytes && bytes.length > 3 &&
      bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
  }

  /**
   * The central directory, read backwards from the end.
   *
   * The end-of-central-directory record is last, but a zip may carry a comment
   * after it, so it has to be searched for rather than assumed. 22 bytes is the
   * record with an empty comment; scanning back 64KB covers any real comment.
   */
  function centralDirectory(buf) {
    const dv = new DataView(buf);
    const bytes = new Uint8Array(buf);
    let eocd = -1;
    const from = Math.max(0, bytes.length - 65558);
    for (let i = bytes.length - 22; i >= from; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) return null;
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const out = new Map();
    for (let i = 0; i < count; i++) {
      if (dv.getUint32(p, true) !== 0x02014b50) return null; // not a central header
      const method = dv.getUint16(p + 10, true);
      const compSize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const localOff = dv.getUint32(p + 42, true);
      const name = te.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      out.set(name, { method, compSize, localOff });
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return out;
  }

  /**
   * One entry's bytes.
   *
   * The local header repeats the name and extra fields with DIFFERENT lengths
   * from the central one (writers pad the local extra field), so the data
   * offset must be computed from the local header and never from the central
   * directory's copy. Getting that wrong reads a few bytes of XML late and the
   * inflate fails with nothing to say about why.
   */
  async function readEntry(buf, entry) {
    const dv = new DataView(buf);
    const p = entry.localOff;
    if (dv.getUint32(p, true) !== 0x04034b50) return null;
    const nameLen = dv.getUint16(p + 26, true);
    const extraLen = dv.getUint16(p + 28, true);
    const start = p + 30 + nameLen + extraLen;
    const raw = new Uint8Array(buf, start, entry.compSize);
    if (entry.method === 0) return te.decode(raw);      // stored
    if (entry.method !== 8) return null;                 // not deflate: unsupported
    const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return te.decode(await new Response(stream).arrayBuffer());
  }

  // ---- XML ----

  const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  function unescapeXml(s) {
    return s.replace(/&(#x?[0-9a-f]+|amp|lt|gt|quot|apos);/gi, (m, e) => {
      if (e[0] === "#") {
        const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
  }

  const attr = (tag, name) => {
    const m = tag.match(new RegExp(`\\s${name}="([^"]*)"`));
    return m ? unescapeXml(m[1]) : null;
  };

  /** Every <t> inside a fragment, joined. Rich text splits one string across runs. */
  function textOf(xml) {
    let out = "";
    for (const m of xml.matchAll(/<t(?:\s[^>]*)?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += unescapeXml(m[1] || "");
    return out;
  }

  function sharedStrings(xml) {
    if (!xml) return [];
    const out = [];
    for (const m of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>|<si\s*\/>/g)) out.push(textOf(m[1] || ""));
    return out;
  }

  // ---- Dates ----

  // Excel's built-in date and time formats. Anything else numeric is a number.
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 45, 46, 47]);
  const BUILTIN_TIME_ONLY = new Set([18, 19, 20, 21, 45, 46, 47]);

  /**
   * Which style indexes are dates.
   *
   * A cell carries s="N" into cellXfs; that xf carries a numFmtId; ids under
   * 164 are built in and anything at or above it is spelled out in numFmts.
   * A custom format is a date if what is left after the quoted literals and
   * the [$-409] locale junk still contains y, d, h or s, or a lone m.
   */
  function dateStyles(xml) {
    const isDate = new Map(); // numFmtId -> boolean
    const timeOnly = new Map();
    if (xml) {
      for (const m of xml.matchAll(/<numFmt\s[^>]*\/>/g)) {
        const id = Number(attr(m[0], "numFmtId"));
        const code = (attr(m[0], "formatCode") || "")
          .replace(/"[^"]*"/g, "").replace(/\[[^\]]*\]/g, "");
        if (!Number.isFinite(id)) continue;
        isDate.set(id, /[ydhs]/i.test(code) || /m{3,}/i.test(code));
        timeOnly.set(id, !/[yd]/i.test(code) && /[hs]/i.test(code));
      }
    }
    const styles = [];
    const cellXfs = xml && xml.match(/<cellXfs[\s\S]*?<\/cellXfs>/);
    if (cellXfs) {
      for (const m of cellXfs[0].matchAll(/<xf\s[^>]*?(?:\/>|>)/g)) {
        const id = Number(attr(m[0], "numFmtId") || 0);
        styles.push({
          date: BUILTIN_DATE.has(id) || isDate.get(id) === true,
          timeOnly: BUILTIN_TIME_ONLY.has(id) || timeOnly.get(id) === true,
        });
      }
    }
    return styles;
  }

  const pad = (n) => String(n).padStart(2, "0");

  /**
   * An Excel serial as text the CSV parsers already understand.
   *
   * Day 0 is 1899-12-30 rather than 12-31 because Excel believes 1900 was a
   * leap year. That is only wrong for serial 60 (an imaginary 29 Feb 1900) and
   * right for everything after it, which is every date anyone is importing.
   * Mac workbooks count from 1904 instead and say so in workbook.xml.
   */
  function serialToText(n, style, date1904) {
    const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(n * 86400000);
    const d = new Date(ms);
    if (!Number.isFinite(d.getTime())) return String(n);
    const date = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    const time = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
    if (style.timeOnly) return time;
    // A whole number is a date with no clock on it; saying "00:00:00" would
    // invent a weigh-in time of midnight.
    return n % 1 === 0 ? date : `${date} ${time}`;
  }

  // ---- Sheet ----

  /** "A" -> 0, "Z" -> 25, "AA" -> 26. The row part of the ref is ignored. */
  function colIndex(ref) {
    let n = 0;
    for (const ch of String(ref || "")) {
      const c = ch.toUpperCase().charCodeAt(0);
      if (c < 65 || c > 90) break;
      n = n * 26 + (c - 64);
    }
    return n - 1;
  }

  function sheetRows(xml, strings, styles, date1904) {
    const rows = [];
    for (const rowM of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cellM of rowM[1].matchAll(/<c(\s[^>]*?)?(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const tag = `<c${cellM[1] || ""}>`;
        const body = cellM[2] || "";
        const type = attr(tag, "t") || "n";
        const ref = attr(tag, "r");
        let value = "";
        if (type === "inlineStr") {
          value = textOf(body);
        } else {
          const v = body.match(/<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/);
          const raw = v ? unescapeXml(v[1]) : "";
          if (type === "s") value = strings[Number(raw)] ?? "";
          else if (type === "b") value = raw === "1" ? "TRUE" : "FALSE";
          else if (type === "e") value = "";           // an error cell has no value to import
          else if (type === "str") value = raw;        // cached formula result
          else if (raw === "") value = "";
          else {
            const style = styles[Number(attr(tag, "s") || 0)] || { date: false, timeOnly: false };
            const num = Number(raw);
            value = style.date && Number.isFinite(num) ? serialToText(num, style, date1904) : raw;
          }
        }
        // Sparse sheets skip empty cells entirely, so the column has to come
        // from the cell's own reference or every row after a gap shifts left.
        const at = ref ? colIndex(ref) : cells.length;
        while (cells.length < at) cells.push("");
        cells[at] = value;
      }
      rows.push(cells);
    }
    return rows;
  }

  /** The first sheet in WORKBOOK order, which is not always sheet1.xml. */
  function firstSheetPath(workbookXml, relsXml, dir) {
    const sheet = workbookXml && workbookXml.match(/<sheet\s[^>]*\/?>/);
    const rid = sheet && attr(sheet[0], "r:id");
    if (rid && relsXml) {
      for (const m of relsXml.matchAll(/<Relationship\s[^>]*\/>/g)) {
        if (attr(m[0], "Id") !== rid) continue;
        const target = (attr(m[0], "Target") || "").replace(/^\/?xl\//, "").replace(/^\//, "");
        if (dir.has(`xl/${target}`)) return `xl/${target}`;
      }
    }
    if (dir.has("xl/worksheets/sheet1.xml")) return "xl/worksheets/sheet1.xml";
    for (const name of dir.keys()) if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) return name;
    return null;
  }

  // ---- CSV out ----

  function toCsvText(rows) {
    return rows.map((cells) => cells.map((c) => {
      const s = String(c ?? "");
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(",")).join("\r\n");
  }

  /**
   * An .xlsx ArrayBuffer to CSV text.
   *
   * Never throws: the callers are import buttons, and every failure here has to
   * come back as a sentence somebody can act on rather than a console error
   * behind a toast that says nothing.
   */
  async function toCsv(buf) {
    try {
      if (typeof DecompressionStream === "undefined") {
        return { csv: "", error: "This browser cannot open Excel files. Save the sheet as CSV and upload that." };
      }
      const dir = centralDirectory(buf);
      if (!dir) return { csv: "", error: "That file is not a readable spreadsheet." };
      if (!dir.has("xl/workbook.xml")) {
        // A zip, but not an xlsx: .numbers and .ods land here.
        return { csv: "", error: "That is a spreadsheet this app cannot read. Export it as .xlsx or CSV and upload that." };
      }
      const [workbook, rels, strings, styles] = await Promise.all([
        readEntry(buf, dir.get("xl/workbook.xml")),
        dir.has("xl/_rels/workbook.xml.rels") ? readEntry(buf, dir.get("xl/_rels/workbook.xml.rels")) : null,
        dir.has("xl/sharedStrings.xml") ? readEntry(buf, dir.get("xl/sharedStrings.xml")) : null,
        dir.has("xl/styles.xml") ? readEntry(buf, dir.get("xl/styles.xml")) : null,
      ]);
      const path = firstSheetPath(workbook, rels, dir);
      if (!path) return { csv: "", error: "That workbook has no sheets in it." };
      const sheetXml = await readEntry(buf, dir.get(path));
      if (!sheetXml) return { csv: "", error: "That file is compressed in a way this app cannot open." };
      const date1904 = /date1904="(1|true)"/i.test(workbook || "");
      const rows = sheetRows(sheetXml, sharedStrings(strings), dateStyles(styles), date1904);
      // Trailing blank rows are what Excel leaves behind after a delete, and
      // they would read as data rows with no date.
      while (rows.length && rows[rows.length - 1].every((c) => String(c ?? "") === "")) rows.pop();
      if (!rows.length) return { csv: "", error: "That sheet is empty." };
      return { csv: toCsvText(rows), error: null, sheet: path };
    } catch (e) {
      console.warn("[xlsx] toCsv", e);
      return { csv: "", error: "Couldn't read that spreadsheet. Save it as CSV and upload that instead." };
    }
  }

  globalThis.STSD = globalThis.STSD || {};
  globalThis.STSD.xlsx = { looksLikeZip, toCsv, toCsvText, serialToText, colIndex, unescapeXml };
})();
