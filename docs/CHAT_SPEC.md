# Cloud, sync & chat — spec for the Firebase side

The client code is complete (`js/core/cloud.js`, `js/modules/chat.js`, `js/modules/settings.js`). What is missing is the Firebase project itself:
config, security rules, and optional push notifications. This file is the contract the rules must enforce.

## 1. Setup
1. Create a Firebase project; add a **Web app**; paste its config object into `js/firebase-config.js` (it is `null` until then — the app runs local-only).
2. Enable **Authentication → Google** and add your deployed domains (and `localhost`) to Authorized domains.
3. Create **Firestore** (production mode) and **Cloud Storage** (needs the Blaze plan; set a budget alert).
4. Deploy rules (section 3 and 4). No composite indexes are required by the queries below.
5. Optional: enable **App Check** to cut abuse from non-app clients.

## 2. Data model
```
users/{uid}                 { uid, handle, name, nameLower, discoverable, createdAt }       read: any signed-in user · write: owner
handles/{handle}            { uid }                       handle = lowercase [a-z0-9._]{3,20}, immutable, unique
directory/{uid}             { uid, handle, name, nameLower }   exists only when discoverable = true
chats/{uidA_uidB}           ids sorted alphabetically, joined by "_"
  members: [uidA, uidB]     sorted
  status: 'pending' | 'accepted' | 'blocked'
  requester: uid            who sent the first message
  blockedBy: uid            only when blocked
  names / handles: {uid: string}   denormalised for the chat list
  lastMessage: { text, ts, from }
  unread: { uid: number }
  createdAt, updatedAt: ms
  messages/{msgId}          { from, text, ts, attachment?: { name, type, size, path, url } }
users/{uid}/{kind}/{docId}  money-data sync. kind ∈ profiles, funds, categories, parties, transactions, recurring, audit
                            every doc has `id` and `updatedAt` (ms). Owner-only.
Storage: chat-files/{chatId}/{msgId}/{filename}
```

## 3. Firestore rules the client relies on
- **users**: any signed-in user may read; only the owner may create/update; `uid == request.auth.uid`; `handle` cannot change after creation.
- **handles**: create only if the doc does not exist and `uid == request.auth.uid` (the client claims it in a transaction together with `users` and `directory`); never update or delete.
- **directory**: owner writes/deletes own doc; any signed-in user may read and query by `nameLower` range (limit ≤ 10).
- **users/{uid}/{kind}/{id}**: read and write only when `request.auth.uid == uid`; `request.resource.data.id == docId`.
- **chats/{chatId}**:
  - read: `request.auth.uid in resource.data.members`.
  - create: `chatId == sorted(members).join('_')`, caller is a member, `status == 'pending'`, `requester == caller`, `unread` shape valid, and the other member has not blocked the caller (a blocked chat doc already exists, so create is naturally refused).
  - update by members only, limited to: `status` pending→accepted (**only the non-requester**); any→blocked (either member, sets `blockedBy` = caller); blocked→accepted (**only `blockedBy`**); `updatedAt`, `lastMessage`, `unread.<uid>` counters. Members and `requester` are immutable.
- **chats/{chatId}/messages**:
  - read: caller is a member (use `get()` on the parent chat).
  - create: caller is a member, `from == caller`, `text.size() <= 2000`, and the parent chat is `accepted`; **or** `pending` and the caller is the requester and this is the first message (no earlier messages exist — enforce by requiring `lastMessage.ts == request.time`-style check or by allowing only one pending message via a counter field).
  - never update or delete.
- Rate limiting: Firestore rules cannot rate-limit directly; rely on App Check plus the one-message-until-accepted rule.

## 4. Storage rules
- `chat-files/{chatId}/{msgId}/{file}`: read/write only if caller is a member of `chatId` (cross-service `firestore.get` on `/chats/{chatId}`) and the chat is `accepted` (or `pending` and caller is requester).
- Write: `request.resource.size < 10 * 1024 * 1024`; images are compressed client-side to ≤ 5 MB / 1600 px.
- Allowed `contentType`: `image/jpeg`, `image/png`, `image/webp`, `application/pdf`, `text/plain`, `text/csv`, `application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`.
- No delete from clients. Optional: Storage lifecycle rule to delete `chat-files/` objects after 90 days.

## 5. Behaviour the UI already implements
- First message to a stranger creates a **pending** chat; the sender cannot send again until accepted. The recipient sees Accept / Block.
- Either member can block; only the blocker can unblock.
- Find people by exact `@id` (always) or by name prefix (only if `discoverable`).
- Unread counters, in-app badge, and a desktop/Android-WebView `Notification` while the app is open.
- Attachments validated client-side (type + size) to match the rules above.

## 6. Not done here (needs the native wrapper or Cloud Functions)
- **Push notifications when the app is closed**: FCM + a Cloud Function on `chats/{id}/messages` create (Functions need Blaze). Client side: `@capacitor/push-notifications`.
- **Google sign-in inside the Android wrapper**: `signInWithPopup` does not work in a WebView. Use `@capacitor-firebase/authentication` and pass the credential to `signInWithCredential` (replace `signIn()` in `cloud.js`).
- **Biometric unlock**: Capacitor biometric plugin; the PIN lock in `core/lock.js` is the web fallback.
- **Real `.xlsx` / `.docx` / PDF export**: bundle SheetJS / docx / a PDF library when the project gets a bundler. Current Excel/Word exports are HTML-based `.xls`/`.doc`.
- **End-to-end encryption of chat**: deliberately skipped (lost-device history, multi-device keys). TLS plus the rules above apply.
- Bundle the Firebase SDK locally instead of loading it from gstatic if the wrapped app must work offline from first launch.
