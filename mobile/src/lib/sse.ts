/** Incremental Server-Sent Events parser (WHATWG event-stream rules, minus `retry`). */

export type SseFrame = { id?: string; event?: string; data: string };

const LINE_END = /\r\n|\r|\n/;

export class SseParser {
  private buf = '';
  private id?: string;
  private event?: string;
  private data: string[] = [];

  /** Feed decoded text; returns every frame completed by this chunk. */
  push(chunk: string): SseFrame[] {
    this.buf += chunk;
    const frames: SseFrame[] = [];
    for (;;) {
      const m = LINE_END.exec(this.buf);
      if (!m) break;
      // A lone trailing "\r" may be the first half of "\r\n": wait for more input.
      if (m[0] === '\r' && m.index === this.buf.length - 1) break;
      const line = this.buf.slice(0, m.index);
      this.buf = this.buf.slice(m.index + m[0].length);
      const frame = this.line(line);
      if (frame) frames.push(frame);
    }
    return frames;
  }

  private line(line: string): SseFrame | null {
    if (line === '') {
      if (this.data.length === 0) {
        this.event = undefined;
        return null;
      }
      const frame: SseFrame = { id: this.id, event: this.event, data: this.data.join('\n') };
      this.data = [];
      this.event = undefined;
      return frame;
    }
    if (line.startsWith(':')) return null; // comment / keepalive
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.data.push(value);
    else if (field === 'event') this.event = value;
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    return null;
  }
}
