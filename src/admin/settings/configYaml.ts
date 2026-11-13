import {
 TELEGRAM_DEFAULTS, TELEGRAM_FIELDS, TELEGRAM_YAML_KEYS,
 telegramDraftFromDocument, telegramFieldValue, type TelegramDraft,
} from "./telegramYaml";
import {
  Scalar,
  isMap,
  isScalar,
  parseDocument,
  stringify,
  type Pair,
  type ParsedNode,
  type Range,
  type YAMLMap,
} from "yaml";

export type SettingsDraft = TelegramDraft & {
  useGPU: boolean;
  previewEnabled: boolean;
  nightlyDisabled: boolean;
  nightlyStartTime: string;
  nightlyTimezone: string;
  previewConcurrency: number;
  thumbnailConcurrency: number;
  fingerprintConcurrency: number;
};

export type VisualField = keyof SettingsDraft;

export const DEFAULT_DRAFT: SettingsDraft = {
  ...TELEGRAM_DEFAULTS,
  useGPU: false,
  previewEnabled: true,
  nightlyDisabled: false,
  nightlyStartTime: "01:00",
  nightlyTimezone: "Asia/Shanghai",
  previewConcurrency: 1,
  thumbnailConcurrency: 1,
  fingerprintConcurrency: 1,
};

export const MIN_GENERATION_CONCURRENCY = 1;
export const MAX_GENERATION_CONCURRENCY = 5;

type ParsedMap = YAMLMap<ParsedNode, ParsedNode | null>;
type ParsedPair = Pair<ParsedNode, ParsedNode | null>;

type SourceEdit = {
  start: number;
  end: number;
  text: string;
};

type RangedNode = {
  range?: Range | null;
};

export function isValidStartTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false;
  const [hour, minute] = value.split(":").map(Number);
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
}

export function isValidTimezone(value: string) {
  if (value === "Local" || value === "" || value !== value.trim()) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function configDocument(source: string) {
  const document = parseDocument(source, {
    keepSourceTokens: true,
    prettyErrors: true,
  });
  if (document.errors.length > 0) {
    throw new Error(document.errors[0].message);
  }
  const root = document.toJS();
  if (root !== null && (typeof root !== "object" || Array.isArray(root))) {
    throw new Error("config.yaml 顶层必须是映射对象");
  }
  return document;
}

function draftFromDocument(document: ReturnType<typeof configDocument>): SettingsDraft {
  const nightlyNode = document.get("nightly", true);
  if (
    nightlyNode !== undefined &&
    nightlyNode !== null &&
    !isMap(nightlyNode) &&
    !(isScalar(nightlyNode) && nightlyNode.value === null)
  ) {
    throw new Error("nightly 必须是映射对象");
  }
  const configuredStart = document.getIn(["nightly", "start_time"]);
  let nightlyStartTime = DEFAULT_DRAFT.nightlyStartTime;
  if (configuredStart !== undefined && configuredStart !== null) {
    if (typeof configuredStart !== "string" || !isValidStartTime(configuredStart)) {
      throw new Error("nightly.start_time 必须是 HH:mm 格式的有效时间");
    }
    nightlyStartTime = configuredStart;
  } else {
    const legacyHour = document.getIn(["nightly", "cron_hour"]);
    if (typeof legacyHour === "number" && legacyHour >= 1 && legacyHour <= 23) {
      nightlyStartTime = `${String(legacyHour).padStart(2, "0")}:00`;
    }
  }

  const configuredTimezone = document.getIn(["nightly", "timezone"]);
  let nightlyTimezone = DEFAULT_DRAFT.nightlyTimezone;
  if (configuredTimezone !== undefined && configuredTimezone !== null) {
    if (typeof configuredTimezone !== "string" || !isValidTimezone(configuredTimezone)) {
      throw new Error("nightly.timezone 必须是有效的 IANA 时区名");
    }
    nightlyTimezone = configuredTimezone;
  }

  const configuredDisabled = document.getIn(["nightly", "disabled"]);
  let nightlyDisabled = DEFAULT_DRAFT.nightlyDisabled;
  if (configuredDisabled !== undefined && configuredDisabled !== null) {
    if (typeof configuredDisabled !== "boolean") {
      throw new Error("nightly.disabled 必须是布尔值");
    }
    nightlyDisabled = configuredDisabled;
  }

  const previewNode = document.get("preview", true);
  if (
    previewNode !== undefined &&
    previewNode !== null &&
    !isMap(previewNode) &&
    !(isScalar(previewNode) && previewNode.value === null)
  ) {
    throw new Error("preview 必须是映射对象");
  }
  const configuredPreviewEnabled = document.getIn(["preview", "enabled"]);
  let previewEnabled = DEFAULT_DRAFT.previewEnabled;
  if (configuredPreviewEnabled !== undefined && configuredPreviewEnabled !== null) {
    if (typeof configuredPreviewEnabled !== "boolean") {
      throw new Error("preview.enabled 必须是布尔值");
    }
    previewEnabled = configuredPreviewEnabled;
  }
  const generationNode = document.get("generation", true);
  if (
    generationNode !== undefined &&
    generationNode !== null &&
    !isMap(generationNode) &&
    !(isScalar(generationNode) && generationNode.value === null)
  ) {
    throw new Error("generation 必须是映射对象");
  }
  function generationConcurrency(key: string, fallback: number) {
    const value = document.getIn(["generation", key]);
    if (value === undefined || value === null) return fallback;
    if (
      typeof value !== "number" ||
      !Number.isInteger(value) ||
      value < MIN_GENERATION_CONCURRENCY ||
      value > MAX_GENERATION_CONCURRENCY
    ) {
      throw new Error(`generation.${key} 必须是 ${MIN_GENERATION_CONCURRENCY}-${MAX_GENERATION_CONCURRENCY} 之间的整数`);
    }
    return value;
  }
  const configuredGPU = document.getIn(["generation", "use_gpu"]);
  if (configuredGPU != null && typeof configuredGPU !== "boolean") {
    throw new Error("generation.use_gpu 必须是布尔值");
  }
  const useGPU = configuredGPU ?? DEFAULT_DRAFT.useGPU;
  const thumbnailConcurrency = generationConcurrency(
    "thumbnail_concurrency", DEFAULT_DRAFT.thumbnailConcurrency
  );
  const previewConcurrency = generationConcurrency(
    "preview_concurrency", DEFAULT_DRAFT.previewConcurrency
  );
  const fingerprintConcurrency = generationConcurrency(
    "fingerprint_concurrency", DEFAULT_DRAFT.fingerprintConcurrency
  );

  return {
    ...telegramDraftFromDocument(document),
    useGPU,
    previewEnabled,
    nightlyDisabled,
    nightlyStartTime,
    nightlyTimezone,
    previewConcurrency,
    thumbnailConcurrency,
    fingerprintConcurrency,
  };
}

export function parseConfig(source: string) {
  const document = configDocument(source);
  return { document, draft: draftFromDocument(document) };
}

function requiredRange(node: RangedNode, description: string) {
  if (!node.range) {
    throw new Error(`无法定位 ${description} 在 config.yaml 中的位置`);
  }
  return node.range;
}

function findPair(map: ParsedMap, key: string): ParsedPair | undefined {
  return map.items.find(
    (pair) => isScalar(pair.key) && pair.key.value === key
  );
}

function yamlString(value: string, template?: ParsedNode | null) {
  if (isScalar(template)) {
    if (template.type === Scalar.QUOTE_DOUBLE) return JSON.stringify(value);
    if (template.type === Scalar.QUOTE_SINGLE) {
      return `'${value.replace(/'/g, "''")}'`;
    }
  }

  const serialized = stringify(value, { lineWidth: 0 });
  return serialized.endsWith("\n") ? serialized.slice(0, -1) : serialized;
}

function lineStart(source: string, offset: number) {
  let cursor = offset;
  while (cursor > 0 && source[cursor - 1] !== "\n" && source[cursor - 1] !== "\r") {
    cursor -= 1;
  }
  return cursor;
}

function lineEndIncludingBreak(source: string, offset: number) {
  let cursor = offset;
  while (cursor < source.length && source[cursor] !== "\n" && source[cursor] !== "\r") {
    cursor += 1;
  }
  if (source[cursor] === "\r" && source[cursor + 1] === "\n") return cursor + 2;
  if (source[cursor] === "\r" || source[cursor] === "\n") return cursor + 1;
  return cursor;
}

function lineEnding(source: string) {
  const match = /\r\n|\n|\r/.exec(source);
  return match?.[0] ?? "\n";
}

function insertLinesAtBoundary(
  source: string,
  position: number,
  lines: readonly string[]
): SourceEdit {
  const eol = lineEnding(source);
  const previousIsBreak =
    position === 0 || source[position - 1] === "\n" || source[position - 1] === "\r";
  const nextIsBreak = source[position] === "\n" || source[position] === "\r";
  const prefix = previousIsBreak ? "" : eol;
  const suffix =
    (position < source.length && !nextIsBreak) ||
    (position === source.length && position > 0 && previousIsBreak)
      ? eol
      : "";

  return {
    start: position,
    end: position,
    text: `${prefix}${lines.join(eol)}${suffix}`,
  };
}

// Replace a pair's value in place. A key written without a value (`key:`)
// receives the value right after its colon, keeping any trailing comment.
function replacePairValue(
  source: string,
  pair: ParsedPair,
  rendered: string,
  path: string
): SourceEdit {
  const node = pair.value;
  if (node?.range && node.range[0] < node.range[1]) {
    return { start: node.range[0], end: node.range[1], text: rendered };
  }

  if (!isScalar(pair.key)) {
    throw new Error(`无法定位 ${path} 的键名`);
  }
  const keyRange = requiredRange(pair.key, path);
  const endOfLine = lineEndIncludingBreak(source, keyRange[1]);
  const colon = source.indexOf(":", keyRange[1]);
  if (colon === -1 || colon >= endOfLine) {
    throw new Error(`无法定位 ${path} 的值`);
  }

  let whitespaceEnd = colon + 1;
  while (source[whitespaceEnd] === " " || source[whitespaceEnd] === "\t") {
    whitespaceEnd += 1;
  }
  const commentGap = source[whitespaceEnd] === "#" ? " " : "";
  return { start: colon + 1, end: whitespaceEnd, text: ` ${rendered}${commentGap}` };
}

type SettingValue = string | number | boolean | number[];

function renderSettingValue(value: SettingValue, template?: ParsedNode | null) {
  return typeof value === "string" ? yamlString(value, template) : JSON.stringify(value);
}

function replaceSettingValue(
  source: string,
  pair: ParsedPair,
  value: SettingValue,
  path: string
): SourceEdit {
  const node = pair.value;
  if (Array.isArray(value)) {
    if (node?.range && node.range[0] < node.range[1]) {
      // Block sequences include their final newline in the value range.
      const suffix = source.slice(node.range[0], node.range[1]).endsWith("\n") ? lineEnding(source) : "";
      return { start: node.range[0], end: node.range[1], text: JSON.stringify(value) + suffix };
    }
    return replacePairValue(source, pair, JSON.stringify(value), path);
  }

  const kind = typeof value === "string" ? "字符串值" : typeof value === "boolean" ? "布尔值" : "整数";
  if (
    (node && !isScalar(node)) ||
    (typeof value === "number" && node && node.value !== null && typeof node.value !== "number")
  ) {
    throw new Error(`${path} 必须是${kind}`);
  }
  return replacePairValue(source, pair, renderSettingValue(value, node), path);
}

function replacePairKey(pair: ParsedPair, key: string): SourceEdit {
  if (!isScalar(pair.key)) {
    throw new Error("无法定位 nightly.cron_hour 的键名");
  }
  const range = requiredRange(pair.key, "nightly.cron_hour");
  return {
    start: range[0],
    end: range[1],
    text: yamlString(key, pair.key),
  };
}

function isFlowMap(map: ParsedMap) {
  return map.srcToken?.type === "flow-collection";
}

function pairContentEnd(pair: ParsedPair) {
  const node = pair.value ?? pair.key;
  return requiredRange(node, "YAML 配置项")[1];
}

function removeMapPair(source: string, map: ParsedMap, pair: ParsedPair): SourceEdit {
  const index = map.items.indexOf(pair);
  if (index === -1) throw new Error("无法定位要移除的 YAML 配置项");

  if (isFlowMap(map)) {
    const currentStart = requiredRange(pair.key, "YAML 配置项")[0];
    const currentEnd = pairContentEnd(pair);
    if (index > 0) {
      return {
        start: pairContentEnd(map.items[index - 1]),
        end: currentEnd,
        text: "",
      };
    }
    if (map.items[index + 1]) {
      return {
        start: currentStart,
        end: requiredRange(map.items[index + 1].key, "YAML 配置项")[0],
        text: "",
      };
    }
    return { start: currentStart, end: currentEnd, text: "" };
  }

  const keyRange = requiredRange(pair.key, "YAML 配置项");
  return {
    start: lineStart(source, keyRange[0]),
    end: lineEndIncludingBreak(source, pairContentEnd(pair)),
    text: "",
  };
}

function insertFlowMapEntry(source: string, map: ParsedMap, entry: string): SourceEdit {
  const range = requiredRange(map, "YAML 映射");
  const openBrace = source.indexOf("{", range[0]);
  const closeBrace = source.lastIndexOf("}", range[1] - 1);
  if (openBrace === -1 || closeBrace <= openBrace) {
    throw new Error("无法定位 YAML 行内映射的边界");
  }

  if (map.items.length === 0) {
    const existingWhitespace = source.slice(openBrace + 1, closeBrace);
    return {
      start: openBrace + 1,
      end: closeBrace,
      text: existingWhitespace.length > 0 ? ` ${entry} ` : entry,
    };
  }

  const lastPair = map.items[map.items.length - 1];
  const position = pairContentEnd(lastPair);
  return { start: position, end: position, text: `, ${entry}` };
}

function insertBlockMapEntry(
  source: string,
  map: ParsedMap,
  entry: string,
  description = "YAML 映射"
): SourceEdit {
  const firstPair = map.items[0];
  if (!firstPair || !isScalar(firstPair.key)) {
    throw new Error(`无法确定 ${description} 配置项的缩进`);
  }
  const keyRange = requiredRange(firstPair.key, `${description} 配置项`);
  const indent = source.slice(lineStart(source, keyRange[0]), keyRange[0]);
  const mapRange = requiredRange(map, description);
  return insertLinesAtBoundary(source, mapRange[2], [`${indent}${entry}`]);
}

function insertAfterEmptyMapKey(
  source: string,
  pair: ParsedPair,
  entry: string,
  description = "YAML 映射"
): SourceEdit {
  const keyRange = requiredRange(pair.key, description);
  const parentIndent = source.slice(lineStart(source, keyRange[0]), keyRange[0]);
  const lineEnd = lineEndIncludingBreak(source, keyRange[1]);
  return insertLinesAtBoundary(source, lineEnd, [`${parentIndent}  ${entry}`]);
}

// Edit only the selected value so comments and unrelated YAML remain intact.
function sectionSettingEdits(
  source: string,
  document: ReturnType<typeof configDocument>,
  sectionName: string,
  key: string,
  value: SettingValue
): SourceEdit[] {
  const root = isMap(document.contents) ? (document.contents as ParsedMap) : null;
  const sectionPair = root ? findPair(root, sectionName) : undefined;
  const entry = `${key}: ${renderSettingValue(value)}`;
  if (!sectionPair) {
    if (root && isFlowMap(root)) {
      return [insertFlowMapEntry(source, root, `${sectionName}: { ${entry} }`)];
    }
    const position = root?.range?.[2] ?? document.range?.[1] ?? source.length;
    return [insertLinesAtBoundary(source, position, [`${sectionName}:`, `  ${entry}`])];
  }

  const node = sectionPair.value;
  if (!node || (isScalar(node) && node.value === null && (!node.range || node.range[0] === node.range[1]))) {
    return [insertAfterEmptyMapKey(source, sectionPair, entry, sectionName)];
  }
  if (isScalar(node) && node.value === null) {
    const range = requiredRange(node, sectionName);
    return [{ start: range[0], end: range[1], text: `{ ${entry} }` }];
  }
  if (!isMap(node)) throw new Error(`${sectionName} 必须是映射对象`);

  const section = node as ParsedMap;
  const pair = findPair(section, key);
  if (pair) return [replaceSettingValue(source, pair, value, `${sectionName}.${key}`)];
  return [
    isFlowMap(section)
      ? insertFlowMapEntry(source, section, entry)
      : insertBlockMapEntry(source, section, entry, sectionName),
  ];
}

// `nightly.cron_hour` is the legacy spelling of `start_time`; saving a start
// time migrates it instead of leaving two competing schedules behind.
function nightlyStartTimeEdits(
  source: string,
  document: ReturnType<typeof configDocument>,
  value: string
): SourceEdit[] {
  const root = isMap(document.contents) ? (document.contents as ParsedMap) : null;
  const nightlyNode = root ? findPair(root, "nightly")?.value : undefined;
  const nightly = isMap(nightlyNode) ? (nightlyNode as ParsedMap) : null;
  const legacyHourPair = nightly ? findPair(nightly, "cron_hour") : undefined;
  if (!nightly || !legacyHourPair) {
    return sectionSettingEdits(source, document, "nightly", "start_time", value);
  }

  const startTimePair = findPair(nightly, "start_time");
  if (startTimePair) {
    return [
      replaceSettingValue(source, startTimePair, value, "nightly.start_time"),
      removeMapPair(source, nightly, legacyHourPair),
    ];
  }
  return [
    replacePairKey(legacyHourPair, "start_time"),
    replaceSettingValue(source, legacyHourPair, value, "nightly.start_time"),
  ];
}

function applySourceEdits(source: string, edits: readonly SourceEdit[]) {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let boundary = source.length;
  let result = source;

  for (const edit of ordered) {
    if (
      edit.start < 0 ||
      edit.end < edit.start ||
      edit.end > source.length ||
      edit.end > boundary
    ) {
      throw new Error("YAML 局部修改范围无效或相互重叠");
    }
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
    boundary = edit.start;
  }
  return result;
}

// Visual fields in write order, each mapped to its `section.key` in config.yaml.
const SECTION_FIELDS = [
  ["useGPU", "generation", "use_gpu"],
  ["previewEnabled", "preview", "enabled"],
  ["nightlyDisabled", "nightly", "disabled"],
  ["nightlyStartTime", "nightly", "start_time"],
  ["nightlyTimezone", "nightly", "timezone"],
  ["thumbnailConcurrency", "generation", "thumbnail_concurrency"],
  ["previewConcurrency", "generation", "preview_concurrency"],
  ["fingerprintConcurrency", "generation", "fingerprint_concurrency"],
] as const;

export function applyVisualFields(
  source: string,
  draft: SettingsDraft,
  fields: ReadonlySet<VisualField>
) {
  let updated = source;
  for (const [field, section, key] of SECTION_FIELDS) {
    if (!fields.has(field)) continue;
    const document = configDocument(updated);
    updated = applySourceEdits(updated, field === "nightlyStartTime"
      ? nightlyStartTimeEdits(updated, document, draft.nightlyStartTime)
      : sectionSettingEdits(updated, document, section, key, draft[field]));
  }
  for (const field of TELEGRAM_FIELDS) {
    if (!fields.has(field)) continue;
    updated = applySourceEdits(updated, sectionSettingEdits(
      updated, configDocument(updated), "telegram", TELEGRAM_YAML_KEYS[field], telegramFieldValue(draft, field)
    ));
  }

  // Source ranges perform the write, while a fresh parse verifies that the
  // localized edit still produced one valid YAML document.
  configDocument(updated);
  return updated;
}

export function changedVisualFields(saved: SettingsDraft, draft: SettingsDraft) {
  const fields = new Set<VisualField>();
  if (saved.useGPU !== draft.useGPU) {
    fields.add("useGPU");
  }
  if (saved.previewEnabled !== draft.previewEnabled) {
    fields.add("previewEnabled");
  }
  if (saved.nightlyDisabled !== draft.nightlyDisabled) {
    fields.add("nightlyDisabled");
  }
  if (saved.nightlyStartTime !== draft.nightlyStartTime) {
    fields.add("nightlyStartTime");
  }
  if (saved.nightlyTimezone !== draft.nightlyTimezone) {
    fields.add("nightlyTimezone");
  }
  if (saved.previewConcurrency !== draft.previewConcurrency) {
    fields.add("previewConcurrency");
  }
  if (saved.thumbnailConcurrency !== draft.thumbnailConcurrency) {
    fields.add("thumbnailConcurrency");
  }
  if (saved.fingerprintConcurrency !== draft.fingerprintConcurrency) {
    fields.add("fingerprintConcurrency");
  }
  for (const field of TELEGRAM_FIELDS) {
    if (saved[field] !== draft[field]) fields.add(field);
  }
  return fields;
}
