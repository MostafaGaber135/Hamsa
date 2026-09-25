import { useMemo } from 'react'
import { useConfirm } from '@/components/ui/confirm'
import { ChatPane } from '@/features/messages/ChatPane'
import type { Draft } from '@/features/messages/Composer'
import type { JumpTarget } from '@/features/messages/MessageThread'
import { useMessages, useSendMessage } from '@/features/messages/queries'
import { useBlockState, useSetBlocked } from '@/features/privacy/queries'
import type { Connection } from '@/features/realtime/useLiveUpdates'
import { useLocale } from '@/lib/i18n'
import { withStatus } from '@/lib/status'
import type { CachedMessage, Conversation, ConversationAction, Message, User } from '@/types/chat'
import { CenteredLoading, LoadError } from './Placeholders'

interface OpenConversationProps {
  conversation: Conversation
  me: User
  users: Record<string, User>
  connection: Connection
  onTyping: () => void
  onSent: () => void
  onBack: () => void
  /** Accept or delete a message request. */
  onAction: (action: ConversationAction) => void
  detailsOpen: boolean
  onToggleDetails: () => void
  jumpTarget?: JumpTarget
  onCall?: (video: boolean) => void
}

/** Its own component so each open conversation gets its own message query and send mutation. */
export function OpenConversation({
  conversation,
  me,
  users,
  connection,
  onTyping,
  onSent,
  onBack,
  onAction,
  detailsOpen,
  onToggleDetails,
  jumpTarget,
  onCall,
}: OpenConversationProps) {
  const { t } = useLocale()
  const confirm = useConfirm()
  const messagesQuery = useMessages(conversation.id, conversation.clearedAt)
  const send = useSendMessage()
  const peer = conversation.isGroup ? undefined : conversation.members.find((m) => m.id !== me.id)
  const blocked = useBlockState(conversation.id, peer?.id)
  const setBlocked = useSetBlocked()

  const messages = useMemo(
    () => (messagesQuery.data ?? []).map((m) => withStatus(m, me.id, conversation.members)),
    [messagesQuery.data, me.id, conversation.members],
  )

  function sendMessage(draft: Draft) {
    onSent()
    const local = draft.file ? URL.createObjectURL(draft.file) : undefined
    send.mutate({
      id: crypto.randomUUID(), // client-generated: lets us recognise the Realtime echo
      conversationId: conversation.id,
      senderId: me.id,
      kind: draft.kind,
      content: draft.content,
      file: draft.file,
      attachment: draft.file
        ? { ...draft.attachment, name: draft.file.name, size: draft.file.size, mime: draft.file.type }
        : draft.attachment,
      // Shown right away while the real file uploads.
      imageUrl: draft.kind === 'image' ? local : undefined,
      fileUrl: draft.kind !== 'image' ? local : undefined,
      createdAt: new Date().toISOString(),
      replyToId: draft.replyToId,
    })
  }

  function retry(message: Message) {
    // The cached copy still has the picked image, so it can be uploaded again.
    const cached: CachedMessage = messagesQuery.data?.find((m) => m.id === message.id) ?? message
    send.mutate(cached)
  }

  let threadPlaceholder = null
  if (messagesQuery.isPending) threadPlaceholder = <CenteredLoading label={t.loading} />
  else if (messagesQuery.isError) threadPlaceholder = <LoadError onRetry={() => messagesQuery.refetch()} />

  return (
    <ChatPane
      conversation={conversation}
      title={conversation.name ?? peer?.name ?? ''}
      peer={peer}
      messages={messages}
      users={users}
      currentUserId={me.id}
      onBack={onBack}
      onSend={sendMessage}
      onRetry={retry}
      hasOlder={messagesQuery.hasNextPage}
      loadingOlder={messagesQuery.isFetchingNextPage}
      onLoadOlder={() => messagesQuery.fetchNextPage()}
      threadPlaceholder={threadPlaceholder}
      onTyping={onTyping}
      connection={connection}
      detailsOpen={detailsOpen}
      onToggleDetails={onToggleDetails}
      jumpTarget={jumpTarget}
      onCall={onCall}
      blocked={blocked}
      onUnblock={peer && (() => setBlocked.mutate({ userId: peer.id, blocked: false }))}
      request={
        conversation.isRequest && peer && !blocked
          ? {
              onAccept: () => onAction('accept'),
              onBlock: () =>
                void confirm({
                  message: t.block.confirm(peer.name),
                  confirmLabel: t.block.block(peer.name),
                  danger: true,
                }).then((ok) => ok && setBlocked.mutate({ userId: peer.id, blocked: true })),
              onDelete: () => onAction('delete'),
            }
          : undefined
      }
    />
  )
}
