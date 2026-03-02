import { IncomingHttpHeaders } from "http";
import { HeadersSchema } from "../schema/index.schema";

export function getExtractApiKeyFromHeader(headers: IncomingHttpHeaders & HeadersSchema): string | null {
  return headers["x-nosana-api"] || null;
}