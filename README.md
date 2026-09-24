# Hamsa · همسة

A real-time chat app built with React, TypeScript and Tailwind CSS v4, designed as a quiet room:
warm surfaces, one teal accent, and message states you can read at a glance. Full English and
Arabic (RTL) support, light and dark themes.

> Status: **Feature-complete.** Real-time messaging, friends, profiles and image sharing on Supabase.

## Run it

1. Create a free project at [supabase.com](https://supabase.com).
2. In the dashboard, open **SQL Editor → New query**, and run each file in
   `supabase/migrations/` once, in order (oldest first).
3. Copy `.env.example` to `.env.local` and fill in the URL and publishable key
   (**Project Settings → API**).
4. For quick local testing, turn off **Authentication → Sign In / Providers → Email → Confirm email**,
   or confirm each account from its inbox.
5. Start the app:

```bash
npm install
npm run dev
```

To try a conversation, sign up two accounts: one in a normal window and one in a private window.

### Google sign-in (optional)

Create an OAuth client in Google Cloud Console, add the callback URL Supabase shows under
**Authentication → Providers → Google**, and paste the client id and secret there. Add
`http://localhost:5173` to **Authentication → URL Configuration → Redirect URLs**.

## What works now

- Email + password and Google sign-in; a profile is created automatically on sign-up
- New chat: search people, start a 1:1 conversation, or pick several and create a group
- Conversations and messages load from Supabase with TanStack Query; older messages page in 30 at a time
- Live updates with Supabase Realtime: new messages, read receipts, unread counts, new conversations
  and friend requests arrive without refreshing; a "Reconnecting…" banner shows when the connection drops
- Online status and "last seen" (Presence), and "Sara is typing…" (Broadcast)
- Image messages: attach, paste a screenshot, preview before sending; resized in the browser, stored
  in a private bucket and shown through signed links
- Emoji picker, drafts kept per conversation, smart scrolling with a "new messages" button,
  older messages load as you scroll up, unread count in the tab title
- Optimistic sending: the message appears at once as "sending", then "sent"; failures can be retried
- Read receipts and unread counts from one `last_read_at` per member
- Friends: find people, send / accept / decline / cancel requests, remove friends, message a friend
- Profile photos from Google, with an initials fallback if the image fails to load
- Public privacy policy page at `/privacy` (required by Google sign-in)
- Conversation menu (the "⋯" button, right-click, or Shift+F10): pin, mute, mark as read/unread,
  delete chat (for you only), leave group — all optimistic, all per-person
- My profile: change name and username (live availability check), upload or remove a photo
  (cropped and resized to 256×256 in the browser before upload), and change or set a password

- Conversation list with search, filters (All / Unread / Groups), unread badges, muted state,
  typing preview, and own-message status icons
- Keyboard navigation in the list: one tab stop, ↑/↓, Home/End, Enter, type-a-letter to jump
- Message thread with runs, "tail" corners, date separators, sender names in groups, images
- All message states: sending, sent, read, failed with retry, typing indicator
- Composer that grows to 6 lines; Enter sends, Shift+Enter adds a line, safe with IME input
- RTL that mirrors through logical CSS only; mixed Arabic/English text keeps its own direction
- Responsive: three-pane desktop, two-screen mobile flow
- Reduced-motion support and visible keyboard focus everywhere

## Structure

```
src/
├── components/ui/        Button, IconButton, TextField, Avatar, Badge, Spinner, BrandMark
├── features/
│   ├── auth/             LoginPage, useSession
│   ├── chat/             ChatApp: the signed-in app shell
│   ├── conversations/    api.ts, queries.ts, Sidebar, ConversationList, NewChatDialog…
│   ├── friends/          api.ts, queries.ts, FriendsPage
│   ├── realtime/         useLiveUpdates, usePresence, useTyping
│   ├── legal/            PrivacyPage
│   ├── profile/          api.ts, queries.ts, ProfilePage
│   └── messages/         api.ts, queries.ts, ChatPane, MessageThread, MessageBubble, Composer…
├── lib/                  supabase client, i18n + dates, theme, message status, avatar tints
supabase/
├── migrations/           the schema, RLS policies and functions
└── tests/                SQL tests for the security rules
├── styles/               design tokens (CSS variables) + Tailwind v4 theme
└── types/chat.ts         User, Conversation, Message
```

## Decisions worth knowing

- **Row Level Security on every table.** A single `is_member()` check guards conversations,
  participants, messages and image files. It's `security definer` so the participants policy
  doesn't call itself forever (the classic RLS recursion bug).
- **Multi-table writes go through functions.** Creating a conversation and adding its members
  happens in one transaction (`get_or_create_direct_conversation`, `create_group_conversation`),
  and a unique `direct_key` makes duplicate 1:1 chats impossible, even if both people click at once.
- **Read receipts from one timestamp.** Each member has a `last_read_at`. Unread count = messages
  after mine; "read" = every other member's `last_read_at` is past the message. One update per
  conversation opened instead of one per message.
- **Friendships are one row per pair.** A unique index on the sorted pair of ids means A→B and
  B→A can't both exist; if B sends a request while A's is pending, it becomes an acceptance.
- **Column-level privileges on profiles.** Even on your own row, only `full_name`, `username`
  and `avatar_url` are writable; `id`, `created_at` and `last_seen_at` are not.
- **Private Realtime channels.** Typing indicators use one channel per conversation
  (`typing:<id>`); policies on `realtime.messages` let only that conversation's members join.
  Online status is limited to signed-in users.
- **The server owns time.** A trigger overwrites `created_at`, so nobody can back-date a message.
- **One request for the sidebar.** `get_my_conversations()` returns members, last message and unread
  count together, and runs as the caller so RLS still applies.

- **Tokens as CSS variables, Tailwind maps to them** (`@theme inline`), so light/dark switch at
  runtime by changing one `data-theme` attribute — no `dark:` classes in components.
- **Logical properties only** (`ms-`, `end-`, `rounded-es-`), so `dir="rtl"` mirrors the whole app.
- **Bubble shape vs. content direction:** the bubble's corners follow the thread; the content inside
  uses `dir="auto"`, so an English message in Arabic UI keeps its time on the correct side.
- **Client-generated message ids** (`crypto.randomUUID()`): when Realtime echoes our own insert back,
  we recognise it by id instead of showing the message twice.

## Next

- [ ] Browser notifications for new messages while the tab is in the background
- [ ] Unit tests (Vitest) and end-to-end tests (Playwright) in CI
- [ ] Deploy to Vercel

## Testing the security rules

`supabase/tests/10_security_tests.sql` signs in as three users and checks that outsiders can't read
or write a conversation, nobody can send as someone else, and uploads are limited to members.
It runs on plain PostgreSQL with `00_supabase_stub.sql` standing in for Supabase's `auth` schema.
