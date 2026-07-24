import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";

import {
  contractPlaceholders,
  DOCX_MIME,
  type ContractPlaceholder,
} from "./constants";

export type TemplateValidationReport = {
  valid: boolean;
  errors: string[];
  warnings: string[];
  placeholders: string[];
  duplicates: string[];
  parts: string[];
};

const placeholderPattern = /\{\{([a-z][a-z0-9_]*)\}\}/gu;
const xmlPartsPattern = /^word\/(document|header\d+|footer\d+)\.xml$/u;

// A template carrying its own mock/editorial markup must never become
// approvable for production use — but the markup itself is never stripped
// (it is the safety net that keeps a mock document from being mistaken for
// a real one), so this only ever affects `valid`, not the template bytes.
const MOCK_MARKER_PATTERN = /\bMOCK\b|НЕ\s+ДЛЯ\s+ПОДПИСАНИЯ/iu;
const TEST_REQUISITE_PATTERN =
  /исполнитель-мок|mock-банк|тестовый\s+банк|тестовый\s+контрагент/iu;
const HIGHLIGHT_MARKUP_PATTERN = /<w:highlight\b[^>]*w:val="(?!none)[^"]+"/iu;

function decodeXml(value: string) {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function encodeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function safeArchive(content: Buffer) {
  if (
    content.length < 4 ||
    content[0] !== 0x50 ||
    content[1] !== 0x4b ||
    content.length > 10_485_760
  ) {
    throw new Error("DOCX signature or size is invalid.");
  }
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(content);
  } catch {
    throw new Error("DOCX archive is malformed.");
  }
  const names = Object.keys(entries);
  if (names.length > 2000) throw new Error("DOCX contains too many ZIP entries.");
  let expanded = 0;
  for (const name of names) {
    expanded += entries[name].length;
    if (
      expanded > 30_000_000 ||
      name.includes("\\") ||
      name.startsWith("/") ||
      name.split("/").includes("..")
    ) {
      throw new Error("DOCX archive violates path or expansion limits.");
    }
  }
  return entries;
}

function textNodes(xml: string) {
  return [...xml.matchAll(/<w:t\b[^>]*>([\s\S]*?)<\/w:t>/gu)].map((match) =>
    decodeXml(match[1]),
  );
}

export function validateDocxTemplate(input: {
  content: Buffer;
  mimeType: string;
  requiredPlaceholders: string[];
}): TemplateValidationReport {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (input.mimeType !== DOCX_MIME) errors.push("MIME_TYPE_INVALID");
  let archive: Record<string, Uint8Array>;
  try {
    archive = safeArchive(input.content);
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : "DOCX_INVALID"],
      warnings,
      placeholders: [],
      duplicates: [],
      parts: [],
    };
  }
  const names = Object.keys(archive);
  if (!archive["word/document.xml"] || !archive["[Content_Types].xml"]) {
    errors.push("DOCX_CORE_PART_MISSING");
  }
  if (names.some((name) => /vbaProject\.bin|macros?/iu.test(name))) {
    errors.push("MACROS_NOT_ALLOWED");
  }
  const contentTypes = archive["[Content_Types].xml"]
    ? strFromU8(archive["[Content_Types].xml"])
    : "";
  if (/macroEnabled|vbaProject/iu.test(contentTypes)) errors.push("MACROS_NOT_ALLOWED");

  const parts = names.filter((name) => xmlPartsPattern.test(name));
  const occurrences: string[] = [];
  for (const part of parts) {
    const xml = strFromU8(archive[part]);
    if (/<!DOCTYPE|<!ENTITY/iu.test(xml)) errors.push("XML_ENTITIES_NOT_ALLOWED");
    const joined = textNodes(xml).join("");
    occurrences.push(...[...joined.matchAll(placeholderPattern)].map((item) => item[1]));
    const outsideText = xml.replace(/<w:t\b[^>]*>[\s\S]*?<\/w:t>/gu, "");
    if (placeholderPattern.test(outsideText)) errors.push("PLACEHOLDER_UNSUPPORTED_XML");
    placeholderPattern.lastIndex = 0;
    if (MOCK_MARKER_PATTERN.test(joined)) errors.push("MOCK_MARKER_PRESENT");
    if (TEST_REQUISITE_PATTERN.test(joined)) errors.push("TEST_REQUISITES_PRESENT");
    if (HIGHLIGHT_MARKUP_PATTERN.test(xml)) errors.push("TEMPLATE_HIGHLIGHT_MARKUP_PRESENT");
  }
  const known = new Set<string>(contractPlaceholders);
  const unknown = [...new Set(occurrences.filter((name) => !known.has(name)))];
  if (unknown.length) errors.push(`UNKNOWN_PLACEHOLDERS:${unknown.join(",")}`);
  const present = [...new Set(occurrences)];
  const missing = input.requiredPlaceholders.filter((name) => !present.includes(name));
  if (missing.length) errors.push(`REQUIRED_PLACEHOLDERS_MISSING:${missing.join(",")}`);
  const duplicates = present.filter(
    (name) => occurrences.filter((current) => current === name).length > 1,
  );
  if (duplicates.length) warnings.push(`DUPLICATE_PLACEHOLDERS:${duplicates.join(",")}`);
  if (occurrences.length === 0) errors.push("TEMPLATE_HAS_NO_PLACEHOLDERS");
  if (occurrences.length > 200) errors.push("TOO_MANY_PLACEHOLDERS");
  return {
    valid: errors.length === 0,
    errors: [...new Set(errors)],
    warnings,
    placeholders: present,
    duplicates,
    parts,
  };
}

const TERMINAL_PUNCTUATION = new Set([".", ",", ";", ":", "!", "?"]);

// A value that already ends in terminal punctuation (". что-то." style text
// extracted verbatim from the client) must not get a second, template-owned
// punctuation mark glued right after it ("...рекомендаций.."). Only the
// value's own trailing mark is dropped — never the template's — so the
// template keeps full control of its own sentence punctuation.
function dedupeTrailingPunctuation(value: string, nextChar: string | undefined) {
  if (!nextChar || !TERMINAL_PUNCTUATION.has(nextChar)) return value;
  const trimmed = value.replace(/\s+$/u, "");
  if (!trimmed || !TERMINAL_PUNCTUATION.has(trimmed.slice(-1))) return value;
  return trimmed.slice(0, -1);
}

function replacePart(
  xml: string,
  values: Partial<Record<ContractPlaceholder, string>>,
) {
  const matches = [...xml.matchAll(/(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/gu)];
  const nodes = matches.map((match) => decodeXml(match[2]));
  let joined = nodes.join("");
  const replacements = [...joined.matchAll(placeholderPattern)]
    .map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
      name: match[1] as ContractPlaceholder,
    }))
    .reverse();
  for (const replacement of replacements) {
    const rawValue = values[replacement.name];
    if (rawValue === undefined || rawValue === null || rawValue === "") {
      throw new Error(`PLACEHOLDER_VALUE_MISSING:${replacement.name}`);
    }
    const value = dedupeTrailingPunctuation(rawValue, joined[replacement.end]);
    const offsets: number[] = [];
    let total = 0;
    for (const node of nodes) {
      offsets.push(total);
      total += node.length;
    }
    const startNode = offsets.findLastIndex((offset) => offset <= replacement.start);
    const endNode = offsets.findLastIndex((offset) => offset < replacement.end);
    const localStart = replacement.start - offsets[startNode];
    const localEnd = replacement.end - offsets[endNode];
    if (startNode === endNode) {
      nodes[startNode] =
        nodes[startNode].slice(0, localStart) +
        value +
        nodes[startNode].slice(localEnd);
    } else {
      nodes[startNode] = nodes[startNode].slice(0, localStart) + value;
      for (let index = startNode + 1; index < endNode; index += 1) nodes[index] = "";
      nodes[endNode] = nodes[endNode].slice(localEnd);
    }
    joined = joined.slice(0, replacement.start) + value + joined.slice(replacement.end);
  }
  let cursor = 0;
  return xml.replace(
    /(<w:t\b[^>]*>)([\s\S]*?)(<\/w:t>)/gu,
    (_match, open: string, _text: string, close: string) =>
      `${open}${encodeXml(nodes[cursor++] ?? "")}${close}`,
  );
}

// Removes character highlighting from the client-facing output, both for
// substituted placeholder runs (which inherit whatever run formatting the
// template author left on the placeholder) and for any yellow highlight the
// template itself carries as editorial "please review" markup — neither
// belongs in a document handed to a client. Table/cell shading (`w:tcPr`,
// `w:tblPr`, `w:trPr`) is structural formatting, not highlighting, and is
// deliberately left untouched.
function stripHighlightMarkup(xml: string) {
  const withoutHighlight = xml.replace(/<w:highlight\b[^>]*\/>/gu, "");
  return withoutHighlight.replace(
    /<w:rPr>([\s\S]*?)<\/w:rPr>/gu,
    (_match, inner: string) => `<w:rPr>${inner.replace(/<w:shd\b[^>]*\/>/gu, "")}</w:rPr>`,
  );
}

export function renderDocxTemplate(input: {
  content: Buffer;
  values: Record<ContractPlaceholder, string>;
}) {
  const archive = safeArchive(input.content);
  for (const [name, bytes] of Object.entries(archive)) {
    if (!xmlPartsPattern.test(name)) continue;
    const rendered = stripHighlightMarkup(replacePart(strFromU8(bytes), input.values));
    archive[name] = strToU8(rendered);
  }
  const output = Buffer.from(zipSync(archive, { level: 6 }));
  const remaining = Object.entries(archive)
    .filter(([name]) => xmlPartsPattern.test(name))
    .flatMap(([, bytes]) =>
      [...strFromU8(bytes).matchAll(placeholderPattern)].map((match) => match[0]),
    );
  if (remaining.length) throw new Error("OUTPUT_HAS_UNRESOLVED_PLACEHOLDERS");
  safeArchive(output);
  return output;
}
