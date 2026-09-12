// PostgREST puts `.in()` lists in the query string, so a selection's worth of
// ids can outgrow the URL. Every filter built from a list of ids goes through
// here.
//
// A leaf module: it started out private to `admin-ops-classes`, and then the
// private-series core needed the same guard against the same URL. Two copies of
// a limit like this drift, and the one that drifts is the one nobody is looking
// at when the founder finally selects three hundred things.

export const ID_CHUNK = 100;

export function chunked<T>(xs: T[], size = ID_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}
