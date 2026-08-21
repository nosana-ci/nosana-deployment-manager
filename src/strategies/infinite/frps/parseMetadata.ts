import type { FRPSEventMetaData } from "../../../listeners/frps/types.js";

/**
 * Flattens the `metadatas` array of an FRPS event into a single object.
 *
 * FRPS sends the entries either merged into one object or split one-key-per
 * object, so every entry has to be folded in — reading only the first would
 * silently drop the `jobId` on the split shape and leave the handlers unable to
 * identify the replica.
 */
export function parseFrpsMetadata(
  metadatas: Array<Partial<FRPSEventMetaData>> | undefined
): Partial<FRPSEventMetaData> {
  if (!metadatas) return {};

  return Object.fromEntries(
    metadatas
      .filter((entry): entry is Partial<FRPSEventMetaData> => !!entry)
      .flatMap((entry) => Object.entries(entry))
      .filter(([, value]) => value !== undefined && value !== null && value !== "")
  );
}
