import { Fragment } from 'react'
import { LINK_PATTERN } from './links'

const MENTION = String.raw`@[a-z0-9_]{3,24}`
const TOKENS = new RegExp(`(${LINK_PATTERN})|(${MENTION})`, 'gi')

interface RichTextProps {
  text: string
  /** Usernames of the chat's members: only those @mentions are highlighted. */
  usernames?: ReadonlySet<string>
}

/**
 * Message text with its links clickable and @mentions highlighted. Everything stays
 * plain text: no HTML from a message is ever rendered.
 */
export function RichText({ text, usernames }: RichTextProps) {
  const parts: React.ReactNode[] = []
  let last = 0
  for (const match of text.matchAll(TOKENS)) {
    const index = match.index ?? 0
    if (index > last) parts.push(text.slice(last, index))
    const [token, link] = match
    if (link) {
      parts.push(
        <a
          key={index}
          href={link}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className="underline decoration-1 underline-offset-2 break-all hover:decoration-2"
        >
          {link}
        </a>,
      )
    } else if (usernames?.has(token.slice(1).toLowerCase())) {
      parts.push(
        <span key={index} className="font-bold">
          {token}
        </span>,
      )
    } else {
      parts.push(token)
    }
    last = index + token.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return <>{parts.map((part, i) => <Fragment key={i}>{part}</Fragment>)}</>
}
