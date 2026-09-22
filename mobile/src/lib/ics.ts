// ics.ts — iCalendar (RFC 5545) import/export for the mobile app. Mirrors the desktop core
// (scala_impl.cpp exportCalendarIcs/importIcs) so an .ics round-trips between platforms:
// VEVENT with DTSTART/DTEND (UTC, or VALUE=DATE for all-day), SUMMARY/DESCRIPTION/LOCATION/URL
// (escaped + line-folded), and RRULE (FREQ/INTERVAL/UNTIL) <-> the recur rule.
import type { CalEvent } from "./store";
import { fromByteArray } from "base64-js";

/** UTF-8 encode an .ics string to base64 (for the native saveToDownloads, which takes b64).
 *  Hand-rolled UTF-8 so it never depends on TextEncoder being present in the JS runtime. */
export function icsToBase64(ics: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < ics.length; i++) {
    const c = ics.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff) {
      // High surrogate: only combine with a valid following low surrogate. A lone/unpaired high
      // surrogate (e.g. a truncated emoji at end-of-string) becomes U+FFFD, not garbage bytes.
      const c2 = i + 1 < ics.length ? ics.charCodeAt(i + 1) : 0;
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        i++;
        const cp = 0x10000 + ((c & 0x3ff) << 10) + (c2 & 0x3ff);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
      } else bytes.push(0xef, 0xbf, 0xbd); // U+FFFD
    } else if (c >= 0xdc00 && c <= 0xdfff) bytes.push(0xef, 0xbf, 0xbd); // unpaired low surrogate → U+FFFD
    else bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
  }
  return fromByteArray(new Uint8Array(bytes));
}

const pad = (n: number) => (n < 10 ? "0" + n : "" + n);
const fmtUtc = (ms: number): string => {
  const d = new Date(ms);
  return d.getUTCFullYear() + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()) + "T" +
         pad(d.getUTCHours()) + pad(d.getUTCMinutes()) + pad(d.getUTCSeconds()) + "Z";
};
const fmtDate = (ms: number): string => {   // all-day: the local calendar date
  const d = new Date(ms);
  return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate());
};
const esc = (s: string): string =>
  (s || "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r/g, "").replace(/\n/g, "\\n");
const unesc = (s: string): string => {
  let o = "";
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "\\" && i + 1 < s.length) { const n = s[++i]; o += (n === "n" || n === "N") ? "\n" : n; }
    else o += s[i];
  }
  return o;
};
const fold = (line: string): string => {   // RFC 5545 §3.1 — <=75 octets, CRLF + leading space
  let o = "", n = 0;
  for (const c of line) { if (n >= 73) { o += "\r\n "; n = 1; } o += c; n++; }
  return o;
};

/** Build an .ics document (text) for a calendar's events. */
export function buildIcs(calName: string, events: CalEvent[]): string {
  const stamp = fmtUtc(Date.now());
  let out = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Scala//Secure CALendar//EN\r\nCALSCALE:GREGORIAN\r\n";
  out += fold("X-WR-CALNAME:" + esc(calName || "Scala Calendar")) + "\r\n";
  for (const ev of events) {
    const st = ev.startTime || 0;
    const en = ev.endTime || st;
    out += "BEGIN:VEVENT\r\n";
    out += fold("UID:" + (ev.id || String(st)) + "@scala") + "\r\n";
    out += "DTSTAMP:" + stamp + "\r\n";
    if (ev.allDay) {
      out += "DTSTART;VALUE=DATE:" + fmtDate(st) + "\r\n";
      out += "DTEND;VALUE=DATE:" + fmtDate((en > st ? en : st) + 86400000) + "\r\n";   // DTEND exclusive
    } else {
      out += "DTSTART:" + fmtUtc(st) + "\r\n";
      out += "DTEND:" + fmtUtc(en > 0 ? en : st) + "\r\n";
    }
    if (ev.title) out += fold("SUMMARY:" + esc(ev.title)) + "\r\n";
    if (ev.description) out += fold("DESCRIPTION:" + esc(ev.description)) + "\r\n";
    if (ev.location) out += fold("LOCATION:" + esc(ev.location)) + "\r\n";
    if (ev.url) out += fold("URL:" + esc(ev.url)) + "\r\n";
    const r = ev.recur;
    if (r && r.freq) {
      const F = ({ daily: "DAILY", weekly: "WEEKLY", monthly: "MONTHLY", yearly: "YEARLY" } as Record<string, string>)[r.freq];
      if (F) {
        let rr = "RRULE:FREQ=" + F;
        if (r.interval && r.interval > 1) rr += ";INTERVAL=" + r.interval;
        if (typeof r.until === "number") rr += ";UNTIL=" + fmtUtc(r.until);
        out += rr + "\r\n";
      }
    }
    out += "END:VEVENT\r\n";
  }
  out += "END:VCALENDAR\r\n";
  return out;
}

function parseIcsDate(value: string): { ms: number; allDay: boolean } | null {
  let v = value.trim();
  if (/^\d{8}$/.test(v)) {                       // VALUE=DATE → all-day, local midnight
    const y = +v.slice(0, 4), mo = +v.slice(4, 6), d = +v.slice(6, 8);
    return { ms: new Date(y, mo - 1, d).getTime(), allDay: true };
  }
  const utc = v.endsWith("Z"); if (utc) v = v.slice(0, -1);
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(v);
  if (!m) return null;
  const Y = +m[1], MO = +m[2], D = +m[3], H = +m[4], MI = +m[5], S = +m[6];
  const ms = utc ? Date.UTC(Y, MO - 1, D, H, MI, S) : new Date(Y, MO - 1, D, H, MI, S).getTime();
  return { ms, allDay: false };
}

/** Parse VEVENTs from an .ics document into partial CalEvents. `id` is derived from the VEVENT UID
 *  when present (stable, so re-import dedups); calendarId is set by the caller when authoring. */
export function parseIcs(text: string): Array<Partial<CalEvent>> {
  const raw = text.split(/\r?\n/); const lines: string[] = []; let cur = "";
  for (const line of raw) {                       // unfold continuation lines
    if (line.length && (line[0] === " " || line[0] === "\t")) cur += line.slice(1);
    else { if (cur) lines.push(cur); cur = line; }
  }
  if (cur) lines.push(cur);
  const out: Array<Partial<CalEvent>> = []; let inEv = false; let ev: any = {};
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") { inEv = true; ev = {}; continue; }
    if (line === "END:VEVENT") {
      inEv = false;
      if (typeof ev.startTime === "number") {
        if (typeof ev.endTime !== "number") ev.endTime = ev.allDay ? ev.startTime : ev.startTime + 3600000;
        out.push(ev);
      }
      continue;
    }
    if (!inEv) continue;
    const c = line.indexOf(":"); if (c < 0) continue;
    const name = (line.slice(0, c).split(";")[0] || "").toUpperCase();
    const value = line.slice(c + 1);
    if (name === "UID") {
      // Idempotent import: carry a stable id from the UID so re-importing upserts instead of
      // duplicating. Our export writes UID:<id>@scala — strip that suffix; foreign UIDs used verbatim.
      ev.id = value.endsWith("@scala") ? value.slice(0, -"@scala".length) : value;
    }
    else if (name === "SUMMARY") ev.title = unesc(value);
    else if (name === "DESCRIPTION") ev.description = unesc(value);
    else if (name === "LOCATION") ev.location = unesc(value);
    else if (name === "URL") ev.url = unesc(value);
    else if (name === "DTSTART") { const p = parseIcsDate(value); if (p) { ev.startTime = p.ms; if (p.allDay) ev.allDay = true; } }
    else if (name === "DTEND") { const p = parseIcsDate(value); if (p) ev.endTime = p.allDay ? p.ms - 86400000 : p.ms; }
    else if (name === "RRULE") {
      const r: any = {};
      for (const kv of value.split(";")) {
        const eq = kv.indexOf("="); if (eq < 0) continue;
        const k = kv.slice(0, eq).toUpperCase(), val = kv.slice(eq + 1);
        if (k === "FREQ") { const f = val.toLowerCase(); if (["daily", "weekly", "monthly", "yearly"].includes(f)) r.freq = f; }
        else if (k === "INTERVAL") { const n = parseInt(val, 10); if (!isNaN(n)) r.interval = n; }
        else if (k === "UNTIL") { const p = parseIcsDate(val); if (p) r.until = p.ms; }
      }
      if (r.freq) ev.recur = r;
    }
  }
  return out;
}
