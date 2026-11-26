# 0093: Team chat is text and emoji, with reactions, quick chat and a message sound

Date: 2026-11-26. Status: accepted. Redesign R9 (plan sections 29-32).

## Decision

- **Text and emoji only.** Direct messages and channels refuse file uploads, files on messages and record links
  (`400 CHAT_TEXT_ONLY`). New channels cannot be linked to a record, and editing a channel no longer sends a link.
  Files and links sent before this change stay stored. Workspace admins (`tenant:manage`) still see and download
  them; everyone else no longer gets them in responses. The support line (admins and SampForce support) and
  SampBidx conversations are unchanged.
- **Full emoji picker.** Every Unicode emoji comes from `emojibase-data` (en, compact). It is loaded with a dynamic
  import the first time a picker opens. You can search by name or keyword and browse by group, and the emoji you
  used recently are kept on the device.
- **Reactions.** `PUT /chat/messages/:id/reactions {emoji, on}` (and the operator equivalent). The reactions are
  stored on the message as `{ emoji: ["u:<user>"|"o:<operator>", …] }`, with at most 20 different emoji per
  message. Only emoji are accepted. Every member of the conversation can react. A change sends a `message_changed`
  event, so everyone sees it live, and deleting a message clears its reactions. SampBidx messages take no
  reactions, because SampBidx would not see them.
- **Delete** stays as before: the text, files and link are removed on the server and a "deleted" line remains.
- **Quick chat.** On a computer (lg and up), a tab sits on the right edge, vertically centred. The main area keeps
  a gutter for it (`lg:pe-20`) whenever team chat is on, so it covers nothing. On phones it is a sixth tab of the
  bottom bar. It opens a panel with your conversations and one conversation at a time, using the same Thread
  component as the Team chat page. Pop-ups for new messages are held back while the panel is open.
- **Sound.** New messages that are not on screen play a short two-note chime made with the Web Audio API (no file
  to load), at most once every 1.5 s. You can mute it from the quick chat header. The choice is kept per device
  (`sf.chatSound`).

## Not covered

Typed web addresses in a message are still plain text. Skin-tone variants are not offered in the picker.
