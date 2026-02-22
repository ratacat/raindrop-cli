# Raindrop.io API Documentation

> Source: https://developer.raindrop.io  
> Scraped: 2026-02-22

---

## Table of Contents

1. [Terms & Guidelines](#terms--guidelines)
2. [Authentication](#authentication)
3. [Making Authorized Calls](#making-authorized-calls)
4. [Raindrops (Fields)](#raindrops-fields)
5. [Single Raindrop](#single-raindrop)
6. [Multiple Raindrops](#multiple-raindrops)
7. [Collections (Fields)](#collections-fields)
8. [Collection Methods](#collection-methods)
9. [Sharing / Collaboration](#sharing--collaboration)
10. [Tags](#tags)
11. [Highlights](#highlights)
12. [Filters](#filters)
13. [User (Fields)](#user-fields)
14. [Authenticated User Methods](#authenticated-user-methods)
15. [Import](#import)
16. [Export](#export)
17. [Backups](#backups)

---

## Terms & Guidelines

### DO
Build applications that **extend** Raindrop.io to platforms beyond the web and offer services that Raindrop.io does not.

### DON'T
Don't build what replicates or replaces raindrop.io. Don't overburden servers. Rate limiting applies. Commercial use is fine as long as you don't compete with Raindrop.io.

---

## Authentication

Raindrop.io API uses OAuth 2.0. To get started:

1. Register your application at https://app.raindrop.io/settings/integrations
2. You'll receive a **client_id** and **client_secret**
3. For personal use, you can create a **test token** directly from the integrations page (no OAuth flow needed)

### OAuth 2.0 Flow

**Step 1: Authorize**

```
GET https://raindrop.io/oauth/authorize?client_id={CLIENT_ID}&redirect_uri={REDIRECT_URI}
```

Parameters:
- `client_id` (required) — from your app settings
- `redirect_uri` (required) — must match the URI in your app settings

User authorizes → redirected to `{REDIRECT_URI}?code={CODE}`

**Step 2: Exchange code for token**

```
POST https://raindrop.io/oauth/access_token
Content-Type: application/json

{
  "client_id": "{CLIENT_ID}",
  "client_secret": "{CLIENT_SECRET}",
  "grant_type": "authorization_code",
  "code": "{CODE}",
  "redirect_uri": "{REDIRECT_URI}"
}
```

Response:
```json
{
  "access_token": "ae261404-11r4-47c0-bce3-e18a423da828",
  "refresh_token": "c4e2a1e0-5b6c-11e9-8647-d663bd873d93",
  "token_type": "Bearer",
  "expires_in": 1209600,
  "expires": 1209600
}
```

**Step 3: Refresh token (when expired)**

```
POST https://raindrop.io/oauth/access_token
Content-Type: application/json

{
  "client_id": "{CLIENT_ID}",
  "client_secret": "{CLIENT_SECRET}",
  "grant_type": "refresh_token",
  "refresh_token": "{REFRESH_TOKEN}"
}
```

### Test Token (Personal Use)

For personal/single-user apps, create a test token at https://app.raindrop.io/settings/integrations — no OAuth flow needed.

---

## Making Authorized Calls

Include the access token in all API calls via the Authorization header:

```http
Authorization: Bearer ae261404-11r4-47c0-bce3-e18a423da828
```

---

## Raindrops (Fields)

A "raindrop" is a bookmark.

### Main Fields

| Field | Type | Description |
|-------|------|-------------|
| _id | `Integer` | Unique identifier |
| collection | `Object` | |
| collection.$id | `Integer` | Collection that the raindrop resides in |
| cover | `String` | Raindrop cover URL |
| created | `String` | Creation date |
| domain | `String` | Hostname of a link. Files always have `raindrop.io` hostname |
| excerpt | `String` | Description; max length: 10000 |
| note | `String` | Note; max length: 10000 |
| lastUpdate | `String` | Update date |
| link | `String` | URL |
| media | `Array<Object>` | Covers list in format: `[ {"link":"url"} ]` |
| tags | `Array<String>` | Tags list |
| title | `String` | Title; max length: 1000 |
| type | `String` | `link` `article` `image` `video` `document` or `audio` |
| user | `Object` | |
| user.$id | `Integer` | Raindrop owner |

### Other Fields

| Field | Type | Description |
|-------|------|-------------|
| broken | `Boolean` | Marked as broken (original link is not reachable) |
| cache | `Object` | Permanent copy (cached version) details |
| cache.status | `String` | `ready` `retry` `failed` `invalid-origin` `invalid-timeout` or `invalid-size` |
| cache.size | `Integer` | Full size in bytes |
| cache.created | `String` | Date when copy is successfully made |
| creatorRef | `Object` | Info about original author (when raindrop is in shared collection by another user) |
| creatorRef._id | `Integer` | Original author user ID |
| creatorRef.fullName | `String` | Original author name |
| file | `Object` | Uploaded file details |
| file.name | `String` | File name |
| file.size | `Integer` | File size in bytes |
| file.type | `String` | Mime type |
| important | `Boolean` | Marked as "favorite" |
| highlights | `Array` | List of highlights |
| highlights[]._id | `String` | Unique id of highlight |
| highlights[].text | `String` | Text of highlight (required) |
| highlights[].color | `String` | Color: `blue`, `brown`, `cyan`, `gray`, `green`, `indigo`, `orange`, `pink`, `purple`, `red`, `teal`, `yellow` (default) |
| highlights[].note | `String` | Optional note for highlight |
| highlights[].created | `String` | Creation date of highlight |
| reminder | `Object` | Reminder attachment |
| reminder.data | `Date` | YYYY-MM-DDTHH:mm:ss.sssZ |

---

## Single Raindrop

### Get raindrop

```
GET https://api.raindrop.io/rest/v1/raindrop/{id}
```

Path: `id` (number, required) — Existing raindrop ID

### Create raindrop

```
POST https://api.raindrop.io/rest/v1/raindrop
```

Body:

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| link | string | **yes** | URL |
| pleaseParse | object | no | Empty object to auto-parse metadata in background |
| created | string | no | |
| lastUpdate | string | no | |
| order | number | no | Sort order (ascending). Set to 0 for first place |
| important | boolean | no | |
| tags | array | no | |
| media | array | no | |
| cover | string | no | |
| collection | object | no | `{"$id": collectionId}` |
| type | string | no | |
| excerpt | string | no | |
| note | string | no | |
| title | string | no | |
| highlights | array | no | |
| reminder | object | no | |

Response:
```json
{
    "result": true,
    "item": { ... }
}
```

### Update raindrop

```
PUT https://api.raindrop.io/rest/v1/raindrop/{id}
```

Path: `id` (number, required)  
Body: Same fields as create (all optional)

### Remove raindrop

```
DELETE https://api.raindrop.io/rest/v1/raindrop/{id}
```

Moves to Trash. Deleting from Trash removes permanently.

### Upload file

```
PUT https://api.raindrop.io/rest/v1/raindrop/file
Content-Type: multipart/form-data
```

Body:
- `file` (required) — File to upload
- `collectionId` (optional) — Collection ID

### Upload cover

```
PUT https://api.raindrop.io/rest/v1/raindrop/{id}/cover
Content-Type: multipart/form-data
```

Body: `cover` (required) — PNG, GIF or JPEG file

### Get permanent copy

```
GET https://api.raindrop.io/rest/v1/raindrop/{id}/cache
```

Returns 307 redirect to cached copy (PRO only).

### Suggest collection and tags (new bookmark)

```
POST https://api.raindrop.io/rest/v1/raindrop/suggest
```

Body: `link` (string, required)

Response:
```json
{
    "result": true,
    "item": {
        "collections": [{"$id": 568368}, ...],
        "tags": ["fonts", "free", ...]
    }
}
```

### Suggest collection and tags (existing bookmark)

```
GET https://api.raindrop.io/rest/v1/raindrop/{id}/suggest
```

---

## Multiple Raindrops

### Common Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| collectionId | `Integer` | Path parameter. `0` for all (except Trash), `-1` for Unsorted, `-99` for Trash |
| search | `String` | Search query ([operators docs](https://help.raindrop.io/using-search#operators)) |
| sort | `String` | `-created` (default), `created`, `score` (with search), `-sort`, `title`, `-title`, `domain`, `-domain` |
| page | `Integer` | 0, 1, 2, 3 ... |
| perpage | `Integer` | Max 50 |
| ids | `Array<Integer>` | Exact raindrop IDs for batch operations |
| nested | `Boolean` | Include bookmarks from nested collections |

### Get raindrops

```
GET https://api.raindrop.io/rest/v1/raindrops/{collectionId}
```

Query: `sort`, `perpage`, `page`, `search`, `nested`

### Create many raindrops

```
POST https://api.raindrop.io/rest/v1/raindrops
```

Body: `items` (array, required) — Max 100 objects, same format as single create

### Update many raindrops

```
PUT https://api.raindrop.io/rest/v1/raindrops/{collectionId}
```

Use `search` and/or `ids` to limit scope.

Body:

| Field | Type | Description |
|-------|------|-------------|
| ids | array | Specific raindrop IDs |
| important | boolean | true=favorite, false=unfavorite |
| tags | array | Append tags. `[]` removes all |
| media | array | Append media. `[]` removes all |
| cover | string | Set URL. `<screenshot>` for auto screenshots |
| collection | object | `{"$id": collectionId}` to move |

### Remove many raindrops

```
DELETE https://api.raindrop.io/rest/v1/raindrops/{collectionId}
```

Moves to Trash. When collectionId is `-99`, permanently removes.

Query: `search`  
Body: `ids` (array)

Response:
```json
{"result": true, "modified": 330}
```

---

## Collections (Fields)

| Field | Type | Description |
|-------|------|-------------|
| _id | `Integer` | Collection ID |
| access | `Object` | |
| access.level | `Integer` | 1=read only, 2=collaborator read, 3=collaborator write, 4=owner |
| access.draggable | `Boolean` | Can change parent? |
| collaborators | `Object` | Present when collection is shared |
| color | `String` | Primary color as HEX |
| count | `Integer` | Raindrop count |
| cover | `Array<String>` | Cover URL (always one item) |
| created | `String` | Creation date |
| expanded | `Boolean` | Sub-collections expanded? |
| lastUpdate | `String` | Update date |
| parent | `Object` | |
| parent.$id | `Integer` | Parent collection ID (empty for root) |
| public | `Boolean` | Publicly accessible? |
| sort | `Integer` | Order (descending) |
| title | `String` | Name |
| user | `Object` | |
| user.$id | `Integer` | Owner ID |
| view | `String` | `list` (default), `simple`, `grid`, `masonry` |

### System Collections

| _id | Description |
|-----|-------------|
| -1 | "Unsorted" |
| -99 | "Trash" |

---

## Collection Methods

### Get root collections

```
GET https://api.raindrop.io/rest/v1/collections
```

### Get child collections

```
GET https://api.raindrop.io/rest/v1/collections/childrens
```

### Get collection

```
GET https://api.raindrop.io/rest/v1/collection/{id}
```

### Create collection

```
POST https://api.raindrop.io/rest/v1/collection
```

Body: `title`, `view`, `sort`, `public`, `parent.$id`, `cover`

### Update collection

```
PUT https://api.raindrop.io/rest/v1/collection/{id}
```

Body: `title`, `view`, `sort`, `public`, `parent.$id`, `cover`, `expanded`

### Upload collection cover

```
PUT https://api.raindrop.io/rest/v1/collection/{id}/cover
Content-Type: multipart/form-data
```

Body: `cover` (file)

### Remove collection

```
DELETE https://api.raindrop.io/rest/v1/collection/{id}
```

Removes collection and descendants. Raindrops move to Trash.

### Remove multiple collections

```
DELETE https://api.raindrop.io/rest/v1/collections
```

Body: `ids` (array of collection IDs). Nested collections must be explicitly included.

### Reorder all collections

```
PUT https://api.raindrop.io/rest/v1/collections
```

Body: `sort` — `"title"`, `"-title"`, `"-count"`

### Expand/collapse all collections

```
PUT https://api.raindrop.io/rest/v1/collections
```

Body: `expanded` (boolean)

### Merge collections

```
PUT https://api.raindrop.io/rest/v1/collections/merge
```

Body:
- `to` (number) — Target collection ID
- `ids` (array) — Collection IDs to merge

### Remove all empty collections

```
PUT https://api.raindrop.io/rest/v1/collections/clean
```

Response: `{"result": true, "count": 3}`

### Empty Trash

```
DELETE https://api.raindrop.io/rest/v1/collection/-99
```

### Get system collections count

```
GET https://api.raindrop.io/rest/v1/user/stats
```

Response:
```json
{
  "items": [
    {"_id": 0, "count": 1570},
    {"_id": -1, "count": 34},
    {"_id": -99, "count": 543}
  ],
  "meta": {
    "pro": true,
    "_id": 32,
    "changedBookmarksDate": "2020-02-11T11:23:43.143Z",
    "duplicates": {"count": 3},
    "broken": {"count": 31}
  }
}
```

---

## Sharing / Collaboration

### Collaborator Fields

| Field | Description |
|-------|-------------|
| _id | User ID |
| email | Collaborator email (empty for read-only users) |
| email_MD5 | MD5 hash of email |
| fullName | Full name |
| role | `member` (write + invite) or `viewer` (read-only) |

### Share collection

```
POST https://api.raindrop.io/rest/v1/collection/{id}/sharing
```

Body:
- `role` — `"member"` or `"viewer"`
- `emails` — Array of emails (max 10)

### Get collaborators

```
GET https://api.raindrop.io/rest/v1/collection/{id}/sharing
```

### Unshare or leave collection

```
DELETE https://api.raindrop.io/rest/v1/collection/{id}/sharing
```

Owner: unshares collection. Member/viewer: leaves collection.

### Change collaborator access level

```
PUT https://api.raindrop.io/rest/v1/collection/{id}/sharing/{userId}
```

Body: `role` — `"member"` or `"viewer"`

### Delete a collaborator

```
DELETE https://api.raindrop.io/rest/v1/collection/{id}/sharing/{userId}
```

### Accept invitation

```
POST https://api.raindrop.io/rest/v1/collection/{id}/join
```

Body: `token` (string from invitation email)

---

## Tags

### Get tags

```
GET https://api.raindrop.io/rest/v1/tags/{collectionId}
```

`collectionId` is optional — omit to get all tags from all collections.

Response:
```json
{
    "result": true,
    "items": [{"_id": "api", "count": 100}]
}
```

### Rename tag

```
PUT https://api.raindrop.io/rest/v1/tags/{collectionId}
```

Body:
- `tags` — Array with one string (current name)
- `replace` — New name

### Merge tags

```
PUT https://api.raindrop.io/rest/v1/tags/{collectionId}
```

Body:
- `tags` — Array of tag names to merge
- `replace` — New unified name

### Remove tag(s)

```
DELETE https://api.raindrop.io/rest/v1/tags/{collectionId}
```

Body: `tags` (array of tag names)

---

## Highlights

### Highlight Object

| Field | Type | Description |
|-------|------|-------------|
| _id | `String` | Unique ID |
| text | `String` | Highlighted text (required) |
| title | `String` | Title of bookmark |
| color | `String` | Default `yellow`. Options: `blue`, `brown`, `cyan`, `gray`, `green`, `indigo`, `orange`, `pink`, `purple`, `red`, `teal`, `yellow` |
| note | `String` | Optional note |
| created | `String` | Creation date |
| tags | `Array` | Tags list |
| link | `String` | Highlighted page URL |

### Get all highlights

```
GET https://api.raindrop.io/rest/v1/highlights
```

Query: `page`, `perpage` (max 50, default 25)

### Get highlights in a collection

```
GET https://api.raindrop.io/rest/v1/highlights/{collectionId}
```

### Get highlights of a raindrop

```
GET https://api.raindrop.io/rest/v1/raindrop/{id}
```

Highlights are in `item.highlights`.

### Add highlight

```
PUT https://api.raindrop.io/rest/v1/raindrop/{id}
```

Body:
```json
{"highlights": [{"text": "Some quote", "color": "red", "note": "Some note"}]}
```

### Update highlight

```
PUT https://api.raindrop.io/rest/v1/raindrop/{id}
```

Body:
```json
{"highlights": [{"_id": "62388e9e...", "note": "New note"}]}
```

### Remove highlight

```
PUT https://api.raindrop.io/rest/v1/raindrop/{id}
```

Body:
```json
{"highlights": [{"_id": "62388e9e...", "text": ""}]}
```

---

## Filters

### Fields

| Field | Type | Description |
|-------|------|-------------|
| broken.count | `Integer` | Broken links count |
| duplicates.count | `Integer` | Duplicate links count |
| important.count | `Integer` | Favorites count |
| notag.count | `Integer` | Raindrops without tags |
| tags | `Array<Object>` | `[{"_id": "tag name", "count": 1}]` |
| types | `Array<Object>` | `[{"_id": "type", "count": 1}]` |

### Get filters

```
GET https://api.raindrop.io/rest/v1/filters/{collectionId}
```

Query:
- `tagsSort` — `-count` (default) or `_id` (by name)
- `search` — Same as raindrops search

---

## User (Fields)

### Main Fields

| Field | Publicly Visible | Type | Description |
|-------|-----------------|------|-------------|
| _id | Yes | `Integer` | Unique user ID |
| config | No | `Object` | See config fields below |
| email | No | `String` | Only visible for you |
| email_MD5 | Yes | `String` | MD5 hash of email |
| files.used | No | `Integer` | Space used for files this month |
| files.size | No | `Integer` | Total space for uploads |
| files.lastCheckPoint | No | `String` | Last space reset time |
| fullName | Yes | `String` | Max 1000 chars |
| groups | No | `Array<Object>` | See groups below |
| password | No | `Boolean` | Has password? |
| pro | Yes | `Boolean` | PRO subscription |
| proExpire | No | `String` | PRO expiration date |
| registered | No | `String` | Registration date |

### Config Fields

| Field | Type | Description |
|-------|------|-------------|
| config.broken_level | `String` | `basic`, `default`, `strict`, or `off` |
| config.font_color | `String` | `sunset`, `night`, or empty |
| config.font_size | `Integer` | 0 to 9 |
| config.lang | `String` | 2 char language code |
| config.last_collection | `Integer` | Last viewed collection ID |
| config.raindrops_sort | `String` | `title`, `-title`, `-sort`, `domain`, `-domain`, `+lastUpdate`, `-lastUpdate` |
| config.raindrops_view | `String` | `grid`, `list`, `simple`, `masonry` |

### Groups

| Field | Type | Description |
|-------|------|-------------|
| title | `String` | Group name |
| hidden | `Boolean` | Collapsed? |
| sort | `Integer` | Ascending order |
| collections | `Array<Integer>` | Collection IDs in order |

---

## Authenticated User Methods

### Get current user

```
GET https://api.raindrop.io/rest/v1/user
```

### Get user by name

```
GET https://api.raindrop.io/rest/v1/user/{name}
```

Returns publicly visible fields only.

### Update user

```
PUT https://api.raindrop.io/rest/v1/user
```

Body: `fullName`, `email`, `config`, `groups`, `newpassword`, `oldpassword`

### Connect social network

```
GET https://api.raindrop.io/rest/v1/user/connect/{provider}
```

Provider: `facebook`, `google`, `twitter`, `vkontakte`, `dropbox`, `gdrive`

### Disconnect social network

```
GET https://api.raindrop.io/rest/v1/user/connect/{provider}/revoke
```

---

## Import

### Parse URL

```
GET https://api.raindrop.io/rest/v1/import/url/parse?url={URL}
```

Extracts title, excerpt, media, type from any URL.

### Check URL existence

```
POST https://api.raindrop.io/rest/v1/import/url/exists
```

Body: `urls` (array)

Response:
```json
{"result": true, "ids": [3322, 12323]}
```

### Parse HTML import file

```
POST https://api.raindrop.io/rest/v1/import/file
Content-Type: multipart/form-data
```

Body: `import` (file) — Supports Netscape, Pocket, Instapaper formats

---

## Export

### Export in format

```
GET https://api.raindrop.io/rest/v1/raindrops/{collectionId}/export.{format}
```

- `collectionId` — Collection ID. `0` for all.
- `format` — `csv`, `html`, or `zip`

Query: `sort`, `search` (same as multiple raindrops)

---

## Backups

### Get all backups

```
GET https://api.raindrop.io/rest/v1/backups
```

Sorted by date (newest first).

Response:
```json
{
    "result": true,
    "items": [{"_id": "659d42a35ffbb2eb5ae1cb86", "created": "2024-01-09T12:57:07.630Z"}]
}
```

### Download backup file

```
GET https://api.raindrop.io/rest/v1/backup/{ID}.{format}
```

Format: `html` or `csv`

### Generate new backup

```
GET https://api.raindrop.io/rest/v1/backup
```

Creates a new backup (async). Email notification when ready.
