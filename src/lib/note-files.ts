import { invalid } from "./errors";

/**
 * Shared-note uploads accept any kind of document, image, audio, video or text. The only files refused are ones that run code when
 * opened (programs, installers, Windows scripts, shortcuts) and web pages/vector images that can run script when opened in a
 * browser. Files are never served inline and never opened by the server, so this protects the people who download them.
 * Both the extension and the file's own signature are checked, so renaming a program does not get it through.
 */
const BLOCKED_EXTENSIONS = new Set([
  "exe", "dll", "msi", "msp", "com", "scr", "pif", "cpl", "msc", "lnk", "reg", "hta", "gadget", "jar", "apk", "ipa", "app", "dmg", "pkg", "deb", "rpm",
  "bat", "cmd", "ps1", "psm1", "vbs", "vbe", "js", "jse", "mjs", "wsf", "wsh", "command", "bin", "run", "appimage",
  "html", "htm", "xhtml", "shtml", "svg", "swf",
]);

export const BLOCKED_TYPES_HELP = "programs, installers, Windows scripts, shortcuts, web pages (.html) and .svg images";

const extOf = (name: string) => (name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "");

/** A file name that is safe to store and show: no paths, no control characters, bounded length. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? "";
  const cleaned = base.replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "").replace(/\s+/g, " ").trim();
  if (!cleaned || cleaned === "." || cleaned === "..") return "file";
  if (cleaned.length <= 150) return cleaned;
  const ext = extOf(cleaned);
  return cleaned.slice(0, 140 - ext.length) + (ext ? "." + ext : "");
}

function signatureProblem(b: Uint8Array): string | null {
  const at = (i: number) => b[i] ?? -1;
  if (at(0) === 0x4d && at(1) === 0x5a && b.length > 0x40) {
    // Windows program: "MZ" plus a "PE\0\0" header at the offset stored at 0x3C.
    const off = at(0x3c) | (at(0x3d) << 8) | (at(0x3e) << 16);
    if (off > 0 && off + 4 <= b.length && at(off) === 0x50 && at(off + 1) === 0x45 && at(off + 2) === 0 && at(off + 3) === 0) return "a Windows program";
  }
  if (at(0) === 0x7f && at(1) === 0x45 && at(2) === 0x4c && at(3) === 0x46) return "a Linux program";
  const w = (at(0) << 24) | (at(1) << 16) | (at(2) << 8) | at(3);
  if ([0xfeedface, 0xfeedfacf, 0xcefaedfe, 0xcffaedfe, 0xcafebabe].includes(w >>> 0)) return "a macOS or Java program";
  const head = new TextDecoder("latin1").decode(b.subarray(0, 2048)).replace(/^﻿/, "").trimStart().toLowerCase();
  if (/^(<\?xml[^>]*>\s*)?(<!doctype\s+(html|svg)|<html|<svg|<script)/.test(head)) return "a web page or SVG image";
  return null;
}

/** Throws a user-facing error if the file should not be accepted. Returns the cleaned file name. */
export function inspectFile(rawName: string, bytes: Uint8Array): string {
  const name = safeFileName(rawName);
  if (bytes.length === 0) throw invalid(`“${name}” is empty.`);
  if (BLOCKED_EXTENSIONS.has(extOf(name))) {
    throw invalid(`“${name}” is a type of file that is not accepted (${BLOCKED_TYPES_HELP}). If it is code or text, save it as .txt and send that.`);
  }
  const why = signatureProblem(bytes);
  if (why) throw invalid(`“${name}” looks like ${why}, which is not accepted. Send documents, images or text instead.`);
  return name;
}
