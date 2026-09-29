import { environment } from '../../environments/environments';

// Client for the RAG chatbot backend. All chatbot fetch code lives here.

const BASE_URL = environment.chatApiUrl.replace(/\/+$/, '');

// Answers usually take 5-20 s, sometimes much longer.
const REQUEST_TIMEOUT_MS = 180_000;

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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: { Accept: 'application/json', ...(init.headers ?? {}) },
      signal: controller.signal
    });
  } catch (err) {
    const timedOut = (err as Error)?.name === 'AbortError';
    throw new ChatApiError(timedOut ? 'Request timed out' : 'Network error', 0);
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    let detail: unknown;
    try {
      detail = (await response.json())?.detail;
    } catch {
      // body wasn't JSON
    }
    throw new ChatApiError(`HTTP ${response.status}`, response.status, detail);
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

export function sendMessage(question: string, conversationId?: string | null): Promise<ChatResponse> {
  const body: { question: string; conversation_id?: string } = { question };
  if (conversationId) {
    body.conversation_id = conversationId;
  }
  return request<ChatResponse>('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(normalizeResponse);
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
