// Shared types for the admin-ops domain cores. This is a LEAF module: it must
// never import from (or be re-exported in a cycle with) @/lib/admin-ops. The
// barrel re-exports these, but the domain files import them from HERE, so the
// domain files never point back at the barrel — which previously created an
// import cycle that made Turbopack emit a runtime reference to erased types
// (e.g. "ReferenceError: VenueInput is not defined").

export type OpResult = { ok: boolean; error?: string };
