export function loader() {
  // Chrome DevTools probes this URL for automatic workspace configuration.
  return new Response(null, { status: 404 });
}
