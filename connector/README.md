# Meridian Vault Connector

Lets the Company Vault keep files on hosting the founder controls, instead of (or as well as)
Supabase Storage. It is one PHP file, needs PHP 8.1 or newer with `pdo_sqlite`, and has no other dependencies.

## Where it sits

```
browser ──(Supabase auth)──> Meridian Edge Function ──(HMAC-signed HTTPS)──> connector ──> files on disk
```

The browser never talks to the connector and never sees its key. The Edge Function checks the
founder's session and the `documents` row first, then signs a request. The `documents` row is the
record of truth: it stores `storage_provider = 'external_connector'`, the object key and its sha256.

## Protocol MERIDIAN-V1

| Header | Value |
|---|---|
| `X-Meridian-Key-Id` | key id from the config |
| `X-Meridian-Timestamp` | unix seconds; rejected outside ±300 s |
| `X-Meridian-Nonce` | 16–64 chars `[A-Za-z0-9_-]`; each one is accepted once per key |
| `X-Meridian-Content-SHA256` | hex sha256 of the body (of the empty string for GET/DELETE) |
| `X-Meridian-Signature` | hex HMAC-SHA256 over the canonical string below |

```
MERIDIAN-V1\n{key_id}\n{timestamp}\n{nonce}\n{METHOD}\n{path}\n{content_sha256}\n{content_length}
```

`path` is `/objects/{business_id}/{key}`, exactly as sent (no decoding). Keys have 1 to 4 segments,
each matching `^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$` and not ending in a dot. Uploads never overwrite;
a new version goes under a new key. Responses: 201 upload, 200 download (with the sha256 header), 204 delete;
400 bad path or body, 401 authentication or replay, 403 HTTPS, scope, business or path, 404, 405, 409 exists, 413 too large, 422 body hash mismatch.

## What it guards against

- **Forged or altered requests**: HMAC over method, path, body hash and length; compared with `hash_equals`.
- **Replay**: timestamp window plus a SQLite nonce table.
- **Key rotation**: several keys can be active. Add the new key, switch Meridian, set the old one `active => false`, then delete it.
- **Least privilege**: each key is tied to one business and a set of scopes (`read`, `write`, `delete`).
- **Path traversal**: strict segment regex; `%`, `\`, NUL, `//`, dot-dot, hidden names and trailing dots are refused before the filesystem is touched.
- **Symlinks and junctions**: every directory below the root is checked; a link or reparse point is refused, and the final directory must `realpath` to itself. It is checked again just before the file is published.
- **Partial or corrupt writes**: the upload streams to a temp file in the same directory, is hashed on the way in, `fsync`ed, compared with the signed hash, then published with `link()` (atomic and never overwrites). Temp files are removed on every failure path.
- **Size**: 50 MB by default, enforced on the stream, not only on `Content-Length`.

## Shared hosting versus VPS

| | Shared hosting (cPanel and similar) | VPS |
|---|---|---|
| TLS | Use the host's certificate (AutoSSL / Let's Encrypt). Ask the host to disable TLS 1.0/1.1; most panels offer only 1.2+ already. | Configure the web server: `ssl_protocols TLSv1.3 TLSv1.2;` (nginx) or `SSLProtocol -all +TLSv1.3 +TLSv1.2` (Apache). |
| Storage root | A folder in the home directory **above** `public_html`, e.g. `/home/acct/meridian-vault`. | A dedicated directory owned by the PHP-FPM user, mode 0750, e.g. `/srv/meridian-vault`. |
| Config | `config.php` above `public_html`; point `MERIDIAN_CONNECTOR_CONFIG` at it with `SetEnv` in `.htaccess` if the host allows, otherwise next to the script with `.htaccess` denying it. | Outside the web root, set in the FPM pool: `env[MERIDIAN_CONNECTOR_CONFIG] = /etc/meridian/connector.php`. |
| Body size | Check `upload_max_filesize`, `post_max_size` and any host request limit are at least 50 MB. | Set `client_max_body_size 51m;` (nginx) and the PHP limits. |
| Behind a proxy | Leave `trust_forwarded_proto` false. | Only set it true when your own proxy terminates TLS and overwrites `X-Forwarded-Proto`. |
| Backups | Host backups may lag; Meridian's recovery drill copies files and re-checks every sha256. | Snapshot the storage root and the nonce DB is not needed in backups. |

**FTP is not a storage API.** FTP/SFTP is how the founder uploads this script to the host. Meridian
never stores or reads vault files over FTP: there is no per-request authentication, no integrity
check and no atomic publish. Every vault operation goes through the signed HTTPS endpoint above.

## Install

1. Upload `meridian-vault-connector.php` into the web root (any name).
2. Create the storage root and a private folder for `nonces.sqlite`, both outside the web root.
3. Copy `config.example.php` to the private location, fill in the paths, `business_id` and a
   secret from `php -r "echo bin2hex(random_bytes(32));"`.
4. Store the same key id and secret in Meridian as a Supabase Vault secret (never in the browser).
5. Run `php tests/connector/run.php` locally first to see the behaviour.

## Validation status

`tests/connector/run.php` runs 41 checks over real HTTP against PHP's built-in server.
Result on Windows / PHP 8.2.12: **41 PASS** (`evidence/connector-results.json`). The link test there
used an NTFS junction because creating a symlink needs extra Windows rights. A POSIX symlink run on Linux
hosting, and a TLS-version check against the real host, are still pending.
