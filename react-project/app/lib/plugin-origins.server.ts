export function parentOrigins(): string[] {
  return (process.env.LITELLM_PARENT_ORIGINS ?? "").split(",").flatMap((value) => {
    try {
      const url = new URL(value.trim());
      return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? [url.origin] : [];
    } catch { return []; }
  });
}

export function frameAncestors() {
  const origins = parentOrigins();
  return "frame-ancestors " + (origins.length ? origins.join(" ") : "'none'");
}
