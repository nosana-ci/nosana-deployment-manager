import { IncomingHttpHeaders } from "http";
import { HeadersSchema } from "../schema/index.schema";

export function doesHeaderContainerKey(headers: IncomingHttpHeaders & HeadersSchema): boolean {
  return typeof headers["x-user-id"] === "string" &&
    typeof headers.authorization === "string" &&
    headers.authorization.startsWith('nos_');
}