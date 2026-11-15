export async function* streamLines(body: ReadableStream<Uint8Array>, byteLimit: number) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let fragments: string[] = [];
  try {
    for (;;) {
      const next = await reader.read();
      total += next.value?.byteLength ?? 0;
      if (total > byteLimit) throw new Error("串流回應超出大小上限。");
      const lines = decoder.decode(next.value, { stream: !next.done }).split("\n");
      for (let index = 0; index < lines.length - 1; index++) {
        fragments.push(lines[index]);
        yield fragments.join("").replace(/\r$/, "");
        fragments = [];
      }
      fragments.push(lines.at(-1)!);
      if (next.done) {
        if (fragments.some(Boolean)) yield fragments.join("").replace(/\r$/, "");
        break;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
