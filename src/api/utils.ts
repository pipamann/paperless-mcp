import { validateHeaderName, validateHeaderValue } from "node:http";
import { MATCHING_ALGORITHM_OPTIONS, MatchingAlgorithm } from "./types";

export const headersToObject = (headers: any): Record<string, string> => {
  if (!headers) return {};
  if (typeof headers.forEach === "function") {
    const obj: Record<string, string> = {};
    headers.forEach((value: string, key: string) => {
      obj[key] = value;
    });
    return obj;
  }
  return headers;
};

export interface NamedItem {
  id: number;
  name: string;
}

export function enhanceMatchingAlgorithm<
  T extends { matching_algorithm: MatchingAlgorithm }
>(obj: T): T & { matching_algorithm: NamedItem } {
  return {
    ...obj,
    matching_algorithm: {
      id: obj.matching_algorithm,
      name:
        MATCHING_ALGORITHM_OPTIONS[obj.matching_algorithm] ||
        String(obj.matching_algorithm),
    },
  };
}

export function enhanceMatchingAlgorithmArray<
  T extends { matching_algorithm: MatchingAlgorithm }
>(objects: T[]): (T & { matching_algorithm: NamedItem })[] {
  return objects.map((obj) => enhanceMatchingAlgorithm(obj));
}

const RESERVED_HEADER = "authorization";

function assertUsableHeader(name: string, value: string, source: string): void {
  if (!name) {
    throw new Error(`${source} contains a header with an empty name.`);
  }
  if (name.toLowerCase() === RESERVED_HEADER) {
    throw new Error(
      `${source} must not set an "Authorization" header; that header carries the Paperless-NGX API token.`
    );
  }
  if (name === "__proto__") {
    // Axios drops this name when building AxiosHeaders, so it would never be sent.
    throw new Error(`${source} cannot set a header named "__proto__".`);
  }
  try {
    validateHeaderName(name);
  } catch {
    throw new Error(`${source} contains an invalid header name: "${name}".`);
  }
  try {
    validateHeaderValue(name, value);
  } catch {
    // Node's own message quotes the offending value, which is a credential here.
    throw new Error(`${source} contains an invalid value for header "${name}".`);
  }
}

/**
 * Removes any casing of `Authorization` from a header set. That header carries
 * the Paperless-NGX API token and is never sourced from configuration or from
 * a per-request override.
 */
export function omitAuthorizationHeader(
  headers: Record<string, string>
): Record<string, string> {
  const remaining: Record<string, string> = {};
  for (const name of Object.keys(headers)) {
    if (name.toLowerCase() !== RESERVED_HEADER) {
      remaining[name] = headers[name];
    }
  }
  return remaining;
}

/**
 * Builds the extra headers sent with every Paperless-NGX request, from the
 * `PAPERLESS_EXTRA_HEADERS` JSON object and/or repeated `--header "Name: value"`
 * flags. CLI flags win over the environment variable, matching HTTP semantics
 * by comparing header names case-insensitively.
 *
 * Header *values* are credentials in the common case (reverse-proxy service
 * tokens), so failures report the header name at most and never the value.
 */
export function parseExtraHeaders(
  envValue?: string,
  cliHeaders: string[] = []
): Record<string, string> {
  const collected = new Map<string, [string, string]>();

  const collect = (name: string, value: string, source: string): void => {
    assertUsableHeader(name, value, source);
    collected.set(name.toLowerCase(), [name, value]);
  };

  if (envValue && envValue.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(envValue);
    } catch {
      throw new Error(
        "PAPERLESS_EXTRA_HEADERS is not valid JSON. Expected an object of header names to string values, " +
          'e.g. {"CF-Access-Client-Id":"<id>","CF-Access-Client-Secret":"<secret>"}.'
      );
    }
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new Error(
        "PAPERLESS_EXTRA_HEADERS must be a JSON object of header names to string values."
      );
    }
    for (const [name, value] of Object.entries(parsed)) {
      const trimmedName = name.trim();
      if (typeof value !== "string") {
        throw new Error(
          `PAPERLESS_EXTRA_HEADERS value for "${trimmedName}" must be a string.`
        );
      }
      collect(trimmedName, value, "PAPERLESS_EXTRA_HEADERS");
    }
  }

  for (const entry of cliHeaders) {
    const separatorIndex = entry.indexOf(":");
    if (separatorIndex === -1) {
      throw new Error(
        '--header expects "Name: value" but got an entry without a colon.'
      );
    }
    collect(
      entry.slice(0, separatorIndex).trim(),
      entry.slice(separatorIndex + 1).trim(),
      "--header"
    );
  }

  const headers: Record<string, string> = {};
  for (const [name, value] of collected.values()) {
    headers[name] = value;
  }
  return headers;
}
