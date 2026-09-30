import { environment } from '../../environments/environments';

// Client for the RAG chatbot backend. All chatbot fetch code lives here.

const BASE_URL = environment.chatApiUrl.replace(/\/+$/, '');

// Answers usually take 5-20 s, sometimes much longer.
const REQUEST_TIMEOUT_MS = 180_000;
// Streams may stay open a long time; give up only when nothing arrives for this long
const STREAM_IDLE_TIMEOUT_MS = 120_000;

export type ChatStatus = 'ok' | 'not_in_docs' | 'no_relevant_docs' | 'ungrounded' | 'truncated';

export interface ChatImage {
  url: string; // absolute https URL
  alt: string | null; // usually null
}

export interface AnswerImage extends ChatImage {
  source_index: number; // the [n] source it belongs to
  placed: boolean; // true = already shown inline via segments
}

export interface MarkdownSegment {
  type: 'markdown';
  text: string; // markdown with [n] citation markers
}

export interface ImageSegment {
  type: 'image';
  url: string;
  alt: string | null;
  source_index: number;
}

// The answer in display order: text interleaved with the screenshots that illustrate it
export type Segment = MarkdownSegment | ImageSegment;

export interface Source {
  index: number;
  chunk_id: string;
  title: string;
  section: string;
  url: string | null;
  versions: string[];
  score: number;
  for_query: string | null;
  images: ChatImage[]; // all screenshots of this source, doc order
}

export interface ChatResponse {
  conversation_id: string;
  question: string;
  standalone_question: string | null;
  answer: string; // whole answer as markdown without images (for copying)
  segments: Segment[]; // render this, not `answer`
  status: ChatStatus;
  citations: Source[];
  sources: Source[];
  model: string | null;
  latency_ms: number;
  images: AnswerImage[]; // screenshots of the cited sources; placed=false ones aren't in segments
  timings?: ChatTimings;
}

export interface ChatTimings {
  total_ms?: number;
  first_visible_ms?: number | null;
  cached?: boolean;
  [key: string]: unknown;
}

// --- Streaming (POST /api/chat/stream, Server-Sent Events) ---

export type StreamStage = 'searching' | 'generating' | 'thinking';

export interface StreamStartEvent {
  conversation_id: string;
  question: string;
}

export interface StreamStatusEvent {
  stage: StreamStage;
}

export interface StreamRetrievedEvent {
  standalone_question: string | null;
  sources: Source[];
}

export interface StreamDeltaEvent {
  text: string;
}

export interface StreamImageEvent {
  url: string;
  alt: string | null;
  source_index: number;
}

// `done` is not a handler: streamChat resolves with it. An `error` event rejects.
export interface StreamHandlers {
  onStart?(event: StreamStartEvent): void;
  onStatus?(event: StreamStatusEvent): void;
  onRetrieved?(event: StreamRetrievedEvent): void;
  onDelta?(event: StreamDeltaEvent): void;
  onImage?(event: StreamImageEvent): void;
}

export interface ConversationTurn {
  question: string;
  standalone_question: string | null;
  answer: string;
  segments: Segment[];
  status: ChatStatus;
  citations: Source[];
  images: AnswerImage[];
}

export interface Conversation {
  conversation_id?: string;
  turns: ConversationTurn[];
}

export interface HealthResponse {
  status: string;
  llm_configured: boolean;
  llm_model: string | null;
}

export class ChatApiError extends Error {
  constructor(
    message: string,
    // 0 = network failure / timeout (no HTTP response)
    readonly status: number,
    readonly detail?: unknown
  ) {
    super(message);
    this.name = 'ChatApiError';
  }
}

// Aborting `outer` (the caller's signal) also aborts `inner`
function linkAbort(outer: AbortSignal | undefined, inner: AbortController): () => void {
  if (!outer) {
    return () => {};
  }
  const onAbort = () => inner.abort();
  if (outer.aborted) {
    inner.abort();
  }
  outer.addEventListener('abort', onAbort, { once: true });
  return () => outer.removeEventListener('abort', onAbort);
}

// A caller abort is rethrown as-is (callers check their signal); anything else becomes a ChatApiError
function fetchFailure(err: unknown, outer: AbortSignal | undefined, timedOut: boolean): unknown {
  if (outer?.aborted) {
    return err;
  }
  return new ChatApiError(timedOut ? 'Request timed out' : 'Network error', 0);
}

async function httpError(response: Response): Promise<ChatApiError> {
  let detail: unknown;
  try {
    detail = (await response.json())?.detail;
  } catch {
    // body wasn't JSON
  }
  return new ChatApiError(`HTTP ${response.status}`, response.status, detail);
}

async function request<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const unlink = linkAbort(signal, controller);
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
      signal: controller.signal
    });
  } catch (err) {
    throw fetchFailure(err, signal, timedOut);
  } finally {
    clearTimeout(timer);
    unlink();
  }

  if (!response.ok) {
    throw await httpError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// Guarantees the array fields exist, so callers work against older backend builds too
function normalizeSource(source: Source): Source {
  return { ...source, versions: source.versions ?? [], images: source.images ?? [] };
}

function normalizeSegments(segments: Segment[] | undefined, answer: string): Segment[] {
  return segments?.length ? segments : [{ type: 'markdown', text: answer ?? '' }];
}

function normalizeImages(images: AnswerImage[] | undefined): AnswerImage[] {
  return (images ?? []).map(img => ({ ...img, placed: img.placed ?? false }));
}

function normalizeResponse(res: ChatResponse): ChatResponse {
  return {
    ...res,
    segments: normalizeSegments(res.segments, res.answer),
    citations: (res.citations ?? []).map(normalizeSource),
    sources: (res.sources ?? []).map(normalizeSource),
    images: normalizeImages(res.images)
  };
}

function normalizeTurn(turn: ConversationTurn): ConversationTurn {
  return {
    ...turn,
    segments: normalizeSegments(turn.segments, turn.answer),
    citations: (turn.citations ?? []).map(normalizeSource),
    images: normalizeImages(turn.images)
  };
}

function chatBody(question: string, conversationId?: string | null): string {
  const body: { question: string; conversation_id?: string } = { question };
  if (conversationId) {
    body.conversation_id = conversationId;
  }
  return JSON.stringify(body);
}

export function sendMessage(question: string, conversationId?: string | null, signal?: AbortSignal): Promise<ChatResponse> {
  return request<ChatResponse>(
    '/api/chat',
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: chatBody(question, conversationId) },
    signal
  ).then(normalizeResponse);
}

// Frames end with a blank line; tolerate CRLF line endings
const FRAME_END = /\r?\n\r?\n/;

function parseFrame(frame: string): { event: string; data: unknown } | null {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split(/\r?\n/)) {
    if (!line || line.startsWith(':')) {
      continue; // blank or comment (keep-alive)
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }
    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      data.push(value);
    }
  }
  if (!data.length) {
    return null;
  }
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return null; // malformed frame: skip it
  }
}

/**
 * Streams an answer. Calls the handlers as events arrive and resolves with the `done` payload
 * (the same ChatResponse POST /api/chat returns). Rejects with ChatApiError on HTTP errors, a missing
 * stream, an `error` event or a stream that ends without `done`; a caller abort rejects with the AbortError.
 */
export async function streamChat(
  question: string,
  conversationId: string | null | undefined,
  handlers: StreamHandlers,
  signal?: AbortSignal
): Promise<ChatResponse> {
  const controller = new AbortController();
  const unlink = linkAbort(signal, controller);
  let timedOut = false;
  let idleTimer: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, STREAM_IDLE_TIMEOUT_MS);
  };

  try {
    resetIdle();
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}/api/chat/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
        body: chatBody(question, conversationId),
        signal: controller.signal
      });
    } catch (err) {
      throw fetchFailure(err, signal, timedOut);
    }

    if (!response.ok) {
      throw await httpError(response);
    }
    if (!response.body || !(response.headers.get('Content-Type') ?? '').includes('text/event-stream')) {
      throw new ChatApiError('Streaming not supported', 0);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: ChatResponse | null = null;

    const dispatch = (frame: string) => {
      const parsed = parseFrame(frame);
      if (!parsed) {
        return;
      }
      const data = parsed.data as any;
      switch (parsed.event) {
        case 'start':
          handlers.onStart?.(data);
          break;
        case 'status':
          handlers.onStatus?.(data);
          break;
        case 'retrieved':
          handlers.onRetrieved?.({ ...data, sources: (data.sources ?? []).map(normalizeSource) });
          break;
        case 'delta':
          handlers.onDelta?.(data);
          break;
        case 'image':
          handlers.onImage?.(data);
          break;
        case 'done':
          result = normalizeResponse(data);
          break;
        case 'error':
          throw new ChatApiError('Stream error', 502, data?.detail);
      }
    };

    while (!result) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (err) {
        throw fetchFailure(err, signal, timedOut);
      }
      resetIdle();
      if (chunk.done) {
        buffer += decoder.decode();
        if (buffer.trim()) {
          dispatch(buffer); // last frame without the trailing blank line
        }
        break;
      }
      buffer += decoder.decode(chunk.value, { stream: true });
      // A chunk can end mid-frame: only handle frames whose terminator has arrived
      let match: RegExpExecArray | null;
      while (!result && (match = FRAME_END.exec(buffer))) {
        const frame = buffer.slice(0, match.index);
        buffer = buffer.slice(match.index + match[0].length);
        dispatch(frame);
      }
    }

    if (!result) {
      throw new ChatApiError('Stream interrupted', 0);
    }
    reader.cancel().catch(() => {});
    return result;
  } finally {
    clearTimeout(idleTimer);
    unlink();
  }
}

export function getConversation(id: string): Promise<Conversation> {
  return request<Conversation>(`/api/chat/${encodeURIComponent(id)}`).then(conversation => ({
    ...conversation,
    turns: (conversation.turns ?? []).map(normalizeTurn)
  }));
}

export async function deleteConversation(id: string): Promise<void> {
  await request<unknown>(`/api/chat/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export function health(): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health');
}
