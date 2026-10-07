// The id sent to the chatbot backend as `user_id`. The app has no sign-in, so this is a random id
// per browser: generated on first use, kept in localStorage and reused on every later load. It ties
// the chat history and the monthly usage to this browser.

const STORAGE_KEY = 'qualis_help_user_id';
const USER_ID_PATTERN = /^[A-Za-z0-9._@:+-]{1,128}$/;

let cached: string | null = null;

function randomId(): string {
  // randomUUID needs a secure context (https or localhost); fall back for plain-http deployments
  if (typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
}

/** The browser's id, or null on the server (SSR). */
export function getChatUserId(): string | null {
  if (cached) {
    return cached;
  }
  if (typeof window === 'undefined' || typeof crypto === 'undefined') {
    return null;
  }
  let id: string | null = null;
  try {
    id = localStorage.getItem(STORAGE_KEY);
  } catch {
    // storage unavailable (private mode, blocked site data)
  }
  if (!id || !USER_ID_PATTERN.test(id)) {
    id = randomId();
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // not persisted: the id then only lasts until the page is reloaded
    }
  }
  cached = id;
  return id;
}
