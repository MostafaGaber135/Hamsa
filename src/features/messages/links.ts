/** A web link, without the punctuation that usually follows one in a sentence. */
export const LINK_PATTERN = String.raw`https?:\/\/[^\s<>"']+[^\s<>"'.,;:!?)\]}]`

/** The first web link in a message, for its preview. */
export function firstLink(text: string | undefined): string | undefined {
  return text?.match(new RegExp(LINK_PATTERN, 'i'))?.[0]
}
