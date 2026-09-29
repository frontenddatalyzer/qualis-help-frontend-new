import { ChatImage, Source } from '../../api/chat';
import { isSafeUrl } from './render-answer';

// A screenshot ready for display: caption and source details resolved up front
export interface ChatImageItem {
  url: string;
  caption: string;
  sourceIndex: number;
  sourceTitle: string;
  sourceSection: string;
  sourceUrl: string | null;
}

export interface OpenImageEvent {
  items: ChatImageItem[];
  index: number;
  trigger: HTMLElement;
}

// Images are only ever rendered from https URLs
export function isHttpsUrl(url: unknown): url is string {
  return typeof url === 'string' && url.startsWith('https://');
}

export function toImageItem(image: ChatImage, sourceIndex: number, source?: Source): ChatImageItem | null {
  if (!isHttpsUrl(image?.url)) {
    return null;
  }
  const title = source?.title ?? '';
  return {
    url: image.url,
    caption: image.alt?.trim() || `Screenshot · [${sourceIndex}]${title ? ' ' + title : ''}`,
    sourceIndex,
    sourceTitle: title,
    sourceSection: source?.section ?? '',
    sourceUrl: isSafeUrl(source?.url) ? source.url : null
  };
}
