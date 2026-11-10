<?php
/**
 * Meridian Vault Connector (protocol MERIDIAN-V1), PHP >= 8.1, no dependencies.
 *
 * A single-file HTTPS endpoint that stores Company Vault files on founder-controlled
 * hosting (shared hosting or VPS). It is called only by Meridian's server side (an Edge
 * Function that has already authorised the founder); browsers never hold its secrets.
 *
 *   PUT    /objects/{business_id}/{key}   upload (no overwrite; new versions use new keys)
 *   GET    /objects/{business_id}/{key}   download
 *   DELETE /objects/{business_id}/{key}   delete
 *
 * Every request is signed:
 *   X-Meridian-Key-Id, X-Meridian-Timestamp (unix seconds), X-Meridian-Nonce,
 *   X-Meridian-Content-SHA256 (hex of the body; of the empty string for GET/DELETE),
 *   X-Meridian-Signature = hex(HMAC-SHA256(secret, canonical))
 *   canonical = "MERIDIAN-V1\n{key_id}\n{timestamp}\n{nonce}\n{METHOD}\n{path}\n{content_sha256}\n{content_length}"
 *   where path is the request path after the script name, e.g. /objects/<uuid>/legal/mou.pdf
 *
 * Configuration: a PHP file returning an array (see config.example.php), located by the
 * MERIDIAN_CONNECTOR_CONFIG environment variable, else ./config.php next to this file.
 * Keep the config, the storage root and the nonce database OUTSIDE the web root.
 */
declare(strict_types=1);

const MV_PROTOCOL = 'MERIDIAN-V1';
const MV_UUID = '/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/';
const MV_SEGMENT = '/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/';
const MV_NONCE = '/^[A-Za-z0-9_-]{16,64}$/';
const MV_CHUNK = 1048576;

final class MvError extends Exception
{
    public function __construct(public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function mv_respond(int $status, ?array $json = null): void
{
    http_response_code($status);
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if ($json !== null) {
        header('Content-Type: application/json');
        echo json_encode($json, JSON_UNESCAPED_SLASHES);
    }
}

function mv_header(string $name): ?string
{
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    $v = $_SERVER[$key] ?? null;
    return is_string($v) ? trim($v) : null;
}

function mv_config(): array
{
    $path = getenv('MERIDIAN_CONNECTOR_CONFIG') ?: __DIR__ . '/config.php';
    if (!is_file($path)) {
        throw new MvError(500, 'connector is not configured');
    }
    $cfg = require $path;
    foreach (['storage_root', 'nonce_db', 'keys'] as $k) {
        if (!isset($cfg[$k])) {
            throw new MvError(500, 'connector configuration is incomplete');
        }
    }
    $cfg += ['require_https' => true, 'trust_forwarded_proto' => false, 'max_bytes' => 52428800, 'clock_skew_seconds' => 300];
    return $cfg;
}

/** Path after the script name, taken raw from REQUEST_URI so no decoding ambiguity exists. */
function mv_request_path(): string
{
    $uri = (string)($_SERVER['REQUEST_URI'] ?? '');
    $uri = explode('?', $uri, 2)[0];
    $script = (string)($_SERVER['SCRIPT_NAME'] ?? '');
    if ($script !== '' && str_starts_with($uri, $script)) {
        $uri = substr($uri, strlen($script));
    }
    return $uri;
}

/** @return array{0:string,1:string[]} business id and key segments, or throws 400 */
function mv_parse_object_path(string $path): array
{
    if (str_contains($path, '%') || str_contains($path, '\\') || str_contains($path, "\0") || str_contains($path, '//')) {
        throw new MvError(400, 'invalid object path');
    }
    $parts = explode('/', $path);
    // ['', 'objects', business, seg1, ..., segN]
    if (count($parts) < 4 || $parts[0] !== '' || $parts[1] !== 'objects') {
        throw new MvError(400, 'invalid object path');
    }
    $business = $parts[2];
    $segments = array_slice($parts, 3);
    if (!preg_match(MV_UUID, $business) || count($segments) > 4) {
        throw new MvError(400, 'invalid object path');
    }
    foreach ($segments as $s) {
        if (!preg_match(MV_SEGMENT, $s) || str_ends_with($s, '.')) {
            throw new MvError(400, 'invalid object path');
        }
    }
    return [$business, $segments];
}

function mv_is_https(array $cfg): bool
{
    if (!empty($_SERVER['HTTPS']) && strtolower((string)$_SERVER['HTTPS']) !== 'off') {
        return true;
    }
    return $cfg['trust_forwarded_proto'] && strtolower((string)mv_header('X-Forwarded-Proto')) === 'https';
}

function mv_authenticate(array $cfg, string $method, string $path, int $contentLength): array
{
    $keyId = mv_header('X-Meridian-Key-Id');
    $ts = mv_header('X-Meridian-Timestamp');
    $nonce = mv_header('X-Meridian-Nonce');
    $sha = mv_header('X-Meridian-Content-SHA256');
    $sig = mv_header('X-Meridian-Signature');
    if (!$keyId || !$ts || !$nonce || !$sha || !$sig || !ctype_digit($ts) || !preg_match(MV_NONCE, $nonce)
        || !preg_match('/^[0-9a-f]{64}$/', $sha) || !preg_match('/^[0-9a-f]{64}$/', $sig)) {
        throw new MvError(401, 'missing or malformed authentication headers');
    }
    $key = $cfg['keys'][$keyId] ?? null;
    if (!is_array($key) || empty($key['active']) || !preg_match('/^[0-9a-f]{64}$/', (string)($key['secret_hex'] ?? ''))) {
        throw new MvError(401, 'unknown or inactive key');
    }
    if (abs(time() - (int)$ts) > (int)$cfg['clock_skew_seconds']) {
        throw new MvError(401, 'request timestamp outside the allowed window');
    }
    $canonical = implode("\n", [MV_PROTOCOL, $keyId, $ts, $nonce, $method, $path, $sha, (string)$contentLength]);
    $expected = hash_hmac('sha256', $canonical, hex2bin($key['secret_hex']));
    if (!hash_equals($expected, $sig)) {
        throw new MvError(401, 'invalid signature');
    }
    mv_consume_nonce($cfg, $keyId, $nonce);
    return ['key_id' => $keyId, 'key' => $key, 'sha' => $sha];
}

/** Replay protection: a nonce is accepted once per key inside twice the skew window. */
function mv_consume_nonce(array $cfg, string $keyId, string $nonce): void
{
    $db = new PDO('sqlite:' . $cfg['nonce_db'], null, null, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);
    $db->exec('PRAGMA busy_timeout = 5000');
    $db->exec('CREATE TABLE IF NOT EXISTS nonces (key_id TEXT NOT NULL, nonce TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (key_id, nonce))');
    $db->prepare('DELETE FROM nonces WHERE seen_at < ?')->execute([time() - 2 * (int)$cfg['clock_skew_seconds']]);
    try {
        $db->prepare('INSERT INTO nonces (key_id, nonce, seen_at) VALUES (?, ?, ?)')->execute([$keyId, $nonce, time()]);
    } catch (PDOException $e) {
        throw new MvError(401, 'replayed request');
    }
}

/**
 * Resolve the object path under the storage root, creating directories for uploads.
 * Rejects symlinks anywhere below the root and re-checks with realpath, so a link
 * planted inside the tree cannot redirect a write or read outside it.
 */
function mv_resolve(array $cfg, string $business, array $segments, bool $create): array
{
    $root = realpath((string)$cfg['storage_root']);
    if ($root === false || !is_dir($root)) {
        throw new MvError(500, 'storage root is unavailable');
    }
    $dir = $root;
    foreach (array_merge([$business], array_slice($segments, 0, -1)) as $part) {
        $dir .= DIRECTORY_SEPARATOR . $part;
        if (is_link($dir)) {
            throw new MvError(403, 'path not permitted');
        }
        if (!is_dir($dir)) {
            if (file_exists($dir)) { // a non-directory here (file, Windows junction, reparse point)
                throw new MvError(403, 'path not permitted');
            }
            if (!$create) {
                throw new MvError(404, 'not found');
            }
            if (!@mkdir($dir, 0750) && !is_dir($dir)) {
                throw new MvError(500, 'could not create directory');
            }
        }
    }
    if (realpath($dir) !== $dir) {
        throw new MvError(403, 'path not permitted');
    }
    $file = $dir . DIRECTORY_SEPARATOR . end($segments);
    if (is_link($file)) {
        throw new MvError(403, 'path not permitted');
    }
    return [$dir, $file];
}

function mv_require_scope(array $auth, string $scope, string $business): void
{
    if (!in_array($scope, (array)($auth['key']['scopes'] ?? []), true)) {
        throw new MvError(403, 'key lacks the ' . $scope . ' scope');
    }
    if (($auth['key']['business_id'] ?? null) !== $business) {
        throw new MvError(403, 'key is not valid for this business');
    }
}

function mv_put(array $cfg, array $auth, string $business, array $segments, int $length): void
{
    mv_require_scope($auth, 'write', $business);
    if ($length > (int)$cfg['max_bytes']) {
        throw new MvError(413, 'file exceeds the size limit');
    }
    [$dir, $file] = mv_resolve($cfg, $business, $segments, true);
    if (file_exists($file)) {
        throw new MvError(409, 'object already exists; store new versions under a new key');
    }
    $tmp = $dir . DIRECTORY_SEPARATOR . '.upload-' . bin2hex(random_bytes(12)) . '.part';
    $out = @fopen($tmp, 'xb');
    if ($out === false) {
        throw new MvError(500, 'could not open a temporary file');
    }
    $in = fopen('php://input', 'rb');
    $ctx = hash_init('sha256');
    $bytes = 0;
    try {
        while (!feof($in)) {
            $chunk = fread($in, MV_CHUNK);
            if ($chunk === false) {
                throw new MvError(400, 'could not read the request body');
            }
            $bytes += strlen($chunk);
            if ($bytes > (int)$cfg['max_bytes'] || $bytes > $length) {
                throw new MvError(413, 'body exceeds the declared or permitted size');
            }
            hash_update($ctx, $chunk);
            fwrite($out, $chunk);
        }
        fflush($out);
        fsync($out);
        fclose($out);
        $out = null;
        $digest = hash_final($ctx);
        if ($bytes !== $length) {
            throw new MvError(400, 'body length does not match Content-Length');
        }
        if (!hash_equals($auth['sha'], $digest)) {
            throw new MvError(422, 'body does not match X-Meridian-Content-SHA256');
        }
        // re-check the directory after the (possibly slow) upload: TOCTOU guard
        if (is_link($dir) || realpath($dir) !== $dir) {
            throw new MvError(403, 'path changed during upload');
        }
        // link() fails if the target exists: an atomic, no-clobber publish
        if (!@link($tmp, $file)) {
            throw new MvError(409, 'object already exists; store new versions under a new key');
        }
        @unlink($tmp);
        $tmp = null;
        mv_respond(201, ['key' => implode('/', $segments), 'size' => $bytes, 'sha256' => $digest]);
    } finally {
        if (is_resource($out)) {
            fclose($out);
        }
        if ($tmp !== null && file_exists($tmp)) {
            @unlink($tmp);
        }
    }
}

function mv_get(array $cfg, array $auth, string $business, array $segments): void
{
    mv_require_scope($auth, 'read', $business);
    [, $file] = mv_resolve($cfg, $business, $segments, false);
    if (!is_file($file) || is_link($file)) {
        throw new MvError(404, 'not found');
    }
    $size = filesize($file);
    $sha = hash_file('sha256', $file);
    http_response_code(200);
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    header('Content-Type: application/octet-stream');
    header('Content-Length: ' . $size);
    header('X-Meridian-Content-SHA256: ' . $sha);
    readfile($file);
}

function mv_delete(array $cfg, array $auth, string $business, array $segments): void
{
    mv_require_scope($auth, 'delete', $business);
    [, $file] = mv_resolve($cfg, $business, $segments, false);
    if (!is_file($file) || is_link($file)) {
        throw new MvError(404, 'not found');
    }
    if (!@unlink($file)) {
        throw new MvError(500, 'could not delete the object');
    }
    mv_respond(204);
}

function mv_main(): void
{
    try {
        $method = strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? ''));
        if (!in_array($method, ['PUT', 'GET', 'DELETE'], true)) {
            throw new MvError(405, 'method not allowed');
        }
        $cfg = mv_config();
        if ($cfg['require_https'] && !mv_is_https($cfg)) {
            throw new MvError(403, 'HTTPS is required');
        }
        $path = mv_request_path();
        $length = (int)($_SERVER['CONTENT_LENGTH'] ?? 0);
        if ($length < 0 || ($method !== 'PUT' && $length !== 0)) {
            throw new MvError(400, 'unexpected request body');
        }
        $auth = mv_authenticate($cfg, $method, $path, $length);
        [$business, $segments] = mv_parse_object_path($path);
        match ($method) {
            'PUT' => mv_put($cfg, $auth, $business, $segments, $length),
            'GET' => mv_get($cfg, $auth, $business, $segments),
            'DELETE' => mv_delete($cfg, $auth, $business, $segments),
        };
    } catch (MvError $e) {
        mv_respond($e->status, ['error' => $e->getMessage()]);
    } catch (Throwable $e) {
        error_log('meridian-vault-connector: ' . $e->getMessage());
        mv_respond(500, ['error' => 'internal error']);
    }
}

mv_main();
