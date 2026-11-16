export type VideoOutputItem = {
  id: string;
  url: string;
  label: string;
  group: string;
};

export type NestedOutputValue =
  | string
  | null
  | undefined
  | NestedOutputValue[]
  | { [key: string]: NestedOutputValue };

const VIDEO_EXTENSIONS = [".mp4", ".mov", ".webm", ".m4v", ".avi", ".mkv"];

function looksLikeVideoPath(value: string) {
  const normalized = value.toLowerCase();
  return (
    normalized.startsWith("http://") ||
    normalized.startsWith("https://") ||
    normalized.startsWith("/") ||
    VIDEO_EXTENSIONS.some((extension) => normalized.includes(extension))
  );
}

function humanizeKey(value: string) {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function extractVideoOutputs(
  value: NestedOutputValue,
  fullUrl: (path?: string | null) => string,
  path: string[] = [],
): VideoOutputItem[] {
  if (!value) return [];

  if (typeof value === "string") {
    if (!looksLikeVideoPath(value)) return [];

    const meaningfulPath = path.filter((segment) => segment !== "outputs" && segment !== "primary_output");
    const group = meaningfulPath.length > 1 ? humanizeKey(meaningfulPath[0]) : "Output";
    const rawLabel = meaningfulPath.length ? humanizeKey(meaningfulPath[meaningfulPath.length - 1]) : "Video";
    const label = rawLabel === group ? "Video" : rawLabel;
    const url = fullUrl(value);

    if (!url) return [];

    return [
      {
        id: `${path.join("-") || "output"}-${url}`,
        url,
        label,
        group,
      },
    ];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item, index) => extractVideoOutputs(item, fullUrl, [...path, `clip_${index + 1}`]));
  }

  return Object.entries(value).flatMap(([key, nestedValue]) => extractVideoOutputs(nestedValue, fullUrl, [...path, key]));
}

export function dedupeVideoOutputs(items: VideoOutputItem[]) {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}
