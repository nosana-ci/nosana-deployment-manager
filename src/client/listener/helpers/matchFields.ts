/**
 * Whether a change-stream update touched any of the fields a listener cares about.
 *
 * `updatedFields` keys are the paths Mongo actually wrote, which for anything
 * nested is a DOTTED path, not the containing field: a `$set` of
 * `endpoints.$[e].online` on a single matching element reports
 * `{"endpoints.0.online": true}`, never `{"endpoints": …}`. An exact key check
 * therefore silently drops every nested update, so a field is matched here if it
 * is the key itself or a prefix of one.
 *
 * The prefix must be followed by a `.` so `endpoints` cannot match a sibling
 * called `endpointsArchive`.
 *
 * Mongo collapses the diff to the whole array when several elements change at
 * once (`{"endpoints": [...]}`), so both shapes occur for the same write
 * depending on how many elements matched — another reason not to key on one.
 */
export function matchFields(updatedFields: Record<string, unknown>, fields: string[]): boolean {
  const updated = Object.keys(updatedFields);

  return fields.some((field) =>
    updated.some((key) => key === field || key.startsWith(`${field}.`))
  );
}
