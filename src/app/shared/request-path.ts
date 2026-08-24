// The one thing the middleware and the root layout have to agree on.
//
// The header wraps every signed-in screen from the root layout, which receives
// no route parameters, so the path is forwarded on the request instead. The name
// of that header is a contract between the two and belongs to neither, which is
// why it is here rather than inside the module that resolves a Course from it —
// the middleware has no business importing a database-backed module to learn a
// string.

/** The request header the middleware puts the path in. */
export const PATHNAME_HEADER = 'x-pathname';
