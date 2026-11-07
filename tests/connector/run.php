<?php
/**
 * Connector test suite. Starts `php -S` on 127.0.0.1 against a scratch storage root and
 * exercises the connector over real HTTP.  Usage:  php tests/connector/run.php
 * Writes evidence/connector-results.json. TLS itself is a host concern: these tests check
 * that plain HTTP is refused unless a trusted proxy marks the request as HTTPS.
 */
declare(strict_types=1);

$repo = dirname(__DIR__, 2);
$work = __DIR__ . '/.work';
$docroot = "$work/www";
$store = "$work/store";
$outside = "$work/outside";
$cfgFile = "$work/config.php";
$port = 18765;
$BIZ = '11111111-1111-4111-8111-111111111111';
$OTHER = '22222222-2222-4222-8222-222222222222';
$K = [
    'k1' => bin2hex(random_bytes(32)), 'k2' => bin2hex(random_bytes(32)),
    'ro' => bin2hex(random_bytes(32)), 'other' => bin2hex(random_bytes(32)), 'old' => bin2hex(random_bytes(32)),
];

function rrmdir(string $d): void
{
    if (!file_exists($d) && !is_link($d)) return;
    if (is_link($d) || is_file($d)) { @unlink($d) || @rmdir($d); return; }
    foreach (scandir($d) as $f) if ($f !== '.' && $f !== '..') rrmdir("$d/$f");
    @rmdir($d);
}
if (PHP_OS_FAMILY === 'Windows' && is_dir($work)) {
    exec('cmd /c rmdir /s /q ' . escapeshellarg(str_replace('/', '\\', $work))); // does not follow junctions
}
rrmdir($work);
mkdir($docroot, 0777, true); mkdir($store); mkdir($outside);
copy("$repo/connector/meridian-vault-connector.php", "$docroot/c.php");

function write_cfg(array $over = []): void
{
    global $cfgFile, $store, $work, $K, $BIZ, $OTHER;
    $cfg = array_merge([
        'storage_root' => $store, 'nonce_db' => "$work/nonces.sqlite",
        'require_https' => true, 'trust_forwarded_proto' => true, 'max_bytes' => 1024 * 1024, 'clock_skew_seconds' => 300,
        'keys' => [
            'k1' => ['secret_hex' => $K['k1'], 'business_id' => $BIZ, 'scopes' => ['read', 'write', 'delete'], 'active' => true],
            'k2' => ['secret_hex' => $K['k2'], 'business_id' => $BIZ, 'scopes' => ['read', 'write', 'delete'], 'active' => true],
            'ro' => ['secret_hex' => $K['ro'], 'business_id' => $BIZ, 'scopes' => ['read'], 'active' => true],
            'other' => ['secret_hex' => $K['other'], 'business_id' => $OTHER, 'scopes' => ['read', 'write', 'delete'], 'active' => true],
            'old' => ['secret_hex' => $K['old'], 'business_id' => $BIZ, 'scopes' => ['read', 'write', 'delete'], 'active' => false],
        ],
    ], $over);
    file_put_contents($cfgFile, '<?php return ' . var_export($cfg, true) . ';');
}
write_cfg();

$env = array_merge(getenv(), ['MERIDIAN_CONNECTOR_CONFIG' => $cfgFile]);
$srv = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $docroot], [1 => ['file', "$work/server.log", 'a'], 2 => ['file', "$work/server.log", 'a']], $pipes, $docroot, $env);
for ($i = 0; $i < 50 && !@fsockopen('127.0.0.1', $port); $i++) usleep(100000);

/** Signed request. $o: key, body, method, path, ts, nonce, sha (override), sig (override), proto, raw (skip signing) */
function req(array $o): array
{
    global $K, $port;
    $method = $o['method'] ?? 'GET';
    $path = $o['path'];
    $body = $o['body'] ?? '';
    $key = $o['key'] ?? 'k1';
    $ts = (string)($o['ts'] ?? time());
    $nonce = $o['nonce'] ?? bin2hex(random_bytes(12));
    $sha = $o['sha'] ?? hash('sha256', $body);
    $canonical = implode("\n", ['MERIDIAN-V1', $key, $ts, $nonce, $method, $path, $sha, (string)strlen($body)]);
    $sig = $o['sig'] ?? hash_hmac('sha256', $canonical, hex2bin($K[$key] ?? str_repeat('0', 64)));
    $h = ["X-Meridian-Key-Id: $key", "X-Meridian-Timestamp: $ts", "X-Meridian-Nonce: $nonce", "X-Meridian-Content-SHA256: $sha", "X-Meridian-Signature: $sig"];
    $proto = array_key_exists('proto', $o) ? $o['proto'] : 'https';
    if ($proto !== null) $h[] = "X-Forwarded-Proto: $proto";
    $ch = curl_init("http://127.0.0.1:$port/c.php$path");
    curl_setopt_array($ch, [CURLOPT_CUSTOMREQUEST => $method, CURLOPT_RETURNTRANSFER => true, CURLOPT_HTTPHEADER => $h, CURLOPT_HEADER => true, CURLOPT_PATH_AS_IS => true]);
    if ($body !== '') curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $resp = curl_exec($ch);
    $code = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $hs = curl_getinfo($ch, CURLINFO_HEADER_SIZE);
    curl_close($ch);
    return ['code' => $code, 'headers' => substr((string)$resp, 0, $hs), 'body' => substr((string)$resp, $hs), 'nonce' => $nonce];
}

$results = [];
function check(string $id, string $desc, bool $ok, string $expected, string $actual): void
{
    global $results;
    $results[] = ['test_id' => $id, 'description' => $desc, 'status' => $ok ? 'PASS' : 'FAIL', 'expected' => $expected, 'actual' => $actual];
    printf("%-4s %-8s %s  [%s]\n", $ok ? 'PASS' : 'FAIL', $id, $desc, $actual);
}
function code_is(string $id, string $desc, array $r, int $want): void
{
    check($id, $desc, $r['code'] === $want, (string)$want, $r['code'] . ' ' . (str_starts_with($r['body'], '{') ? trim($r['body']) : strlen($r['body']) . ' bytes'));
}

$p = "/objects/$BIZ/legal/mou-v1.pdf";
$data = random_bytes(200000);

// transport
code_is('CON-01', 'plain HTTP without a trusted HTTPS marker is refused', req(['method' => 'PUT', 'path' => $p, 'body' => $data, 'proto' => null]), 403);
code_is('CON-02', 'method other than PUT/GET/DELETE is refused', req(['method' => 'POST', 'path' => $p]), 405);

// upload and integrity
$r = req(['method' => 'PUT', 'path' => $p, 'body' => $data]);
code_is('CON-03', 'signed upload succeeds', $r, 201);
$j = json_decode($r['body'], true) ?: [];
check('CON-04', 'upload response reports the body sha256', ($j['sha256'] ?? '') === hash('sha256', $data), hash('sha256', $data), (string)($j['sha256'] ?? 'none'));
check('CON-05', 'stored bytes equal the uploaded bytes', is_file("$store/$BIZ/legal/mou-v1.pdf") && hash_file('sha256', "$store/$BIZ/legal/mou-v1.pdf") === hash('sha256', $data), 'identical', is_file("$store/$BIZ/legal/mou-v1.pdf") ? 'file present' : 'missing');
$r = req(['path' => $p]);
check('CON-06', 'download returns identical bytes', $r['code'] === 200 && hash('sha256', $r['body']) === hash('sha256', $data), '200 + same sha', $r['code'] . ' ' . substr(hash('sha256', $r['body']), 0, 12));
check('CON-07', 'download carries X-Meridian-Content-SHA256', stripos($r['headers'], 'X-Meridian-Content-SHA256: ' . hash('sha256', $data)) !== false, 'header present', stripos($r['headers'], 'X-Meridian-Content-SHA256') !== false ? 'present' : 'absent');
code_is('CON-08', 'overwrite of an existing key is refused', req(['method' => 'PUT', 'path' => $p, 'body' => 'x']), 409);
code_is('CON-09', 'body that does not match the signed sha256 is rejected', req(['method' => 'PUT', 'path' => "/objects/$BIZ/legal/tamper.pdf", 'body' => 'real body', 'sha' => hash('sha256', 'other body')]), 422);
check('CON-10', 'rejected upload leaves no file and no temp file', !file_exists("$store/$BIZ/legal/tamper.pdf") && !glob("$store/$BIZ/legal/.upload-*"), 'nothing', implode(',', array_map('basename', glob("$store/$BIZ/legal/*") ?: [])));

// authentication, replay, rotation
$r = req(['path' => $p, 'nonce' => 'fixednonce-0000000001']);
code_is('CON-11', 'first use of a nonce is accepted', $r, 200);
code_is('CON-12', 'replayed nonce is refused', req(['path' => $p, 'nonce' => 'fixednonce-0000000001']), 401);
code_is('CON-13', 'timestamp 301 s old is refused', req(['path' => $p, 'ts' => time() - 301]), 401);
code_is('CON-14', 'timestamp 301 s in the future is refused', req(['path' => $p, 'ts' => time() + 301]), 401);
code_is('CON-15', 'wrong signature is refused', req(['path' => $p, 'sig' => str_repeat('a', 64)]), 401);
code_is('CON-16', 'signature for another path is refused', req(['path' => $p, 'sig' => hash_hmac('sha256', implode("\n", ['MERIDIAN-V1', 'k1', (string)time(), 'n' . str_repeat('1', 20), 'GET', "/objects/$BIZ/x", hash('sha256', ''), '0']), hex2bin($K['k1']))]), 401);
code_is('CON-17', 'unknown key id is refused', req(['path' => $p, 'key' => 'nobody']), 401);
code_is('CON-18', 'deactivated (rotated-out) key is refused', req(['path' => $p, 'key' => 'old']), 401);
code_is('CON-19', 'second active key works during rotation', req(['path' => $p, 'key' => 'k2']), 200);

// authorisation
code_is('CON-20', 'read-only key cannot upload', req(['method' => 'PUT', 'path' => "/objects/$BIZ/legal/ro.pdf", 'body' => 'x', 'key' => 'ro']), 403);
code_is('CON-21', 'read-only key cannot delete', req(['method' => 'DELETE', 'path' => $p, 'key' => 'ro']), 403);
code_is('CON-22', 'read-only key can download', req(['path' => $p, 'key' => 'ro']), 200);
code_is('CON-23', 'key for another business cannot read this business', req(['path' => $p, 'key' => 'other']), 403);
code_is('CON-24', 'key for another business cannot write here', req(['method' => 'PUT', 'path' => "/objects/$BIZ/x.pdf", 'body' => 'x', 'key' => 'other']), 403);

// path safety
foreach ([
    ['CON-25', 'dot-dot segment', "/objects/$BIZ/../$OTHER/x.pdf"],
    ['CON-26', 'percent-encoded traversal', "/objects/$BIZ/%2e%2e/x.pdf"],
    ['CON-27', 'backslash', "/objects/$BIZ/a\\b.pdf"],
    ['CON-28', 'hidden file segment', "/objects/$BIZ/.htaccess"],
    ['CON-29', 'empty segment', "/objects/$BIZ//x.pdf"],
    ['CON-30', 'business id that is not a uuid', '/objects/not-a-uuid/x.pdf'],
    ['CON-31', 'trailing dot (Windows alias)', "/objects/$BIZ/x.pdf."],
    ['CON-32', 'too many segments', "/objects/$BIZ/a/b/c/d/e.pdf"],
] as [$id, $what, $path]) {
    code_is($id, "path rejected: $what", req(['method' => 'PUT', 'path' => $path, 'body' => 'x']), 400);
}

// size
write_cfg(['max_bytes' => 1000]);
code_is('CON-33', 'upload above max_bytes is refused', req(['method' => 'PUT', 'path' => "/objects/$BIZ/big.bin", 'body' => str_repeat('a', 1001)]), 413);
check('CON-34', 'oversize upload leaves nothing behind', !file_exists("$store/$BIZ/big.bin") && !glob("$store/$BIZ/.upload-*"), 'nothing', 'checked');
write_cfg();

// symlinks (Windows needs Developer Mode or admin to create them)
file_put_contents("$outside/secret.txt", 'outside the vault');
$linked = @symlink($outside, "$store/$BIZ/escape");
if (!$linked && PHP_OS_FAMILY === 'Windows') { // junctions need no privilege and are the realistic Windows-host case
    exec('cmd /c mklink /J ' . escapeshellarg(str_replace('/', '\\', "$store/$BIZ/escape")) . ' ' . escapeshellarg(str_replace('/', '\\', $outside)) . ' 2>NUL', $o_, $rc);
    $linked = $rc === 0;
}
if ($linked) {
    code_is('CON-35', 'read through a planted directory symlink is refused', req(['path' => "/objects/$BIZ/escape/secret.txt"]), 403);
    code_is('CON-36', 'write through a planted directory symlink is refused', req(['method' => 'PUT', 'path' => "/objects/$BIZ/escape/new.txt", 'body' => 'x']), 403);
    check('CON-37', 'nothing was written outside the vault', !file_exists("$outside/new.txt"), 'absent', file_exists("$outside/new.txt") ? 'present' : 'absent');
} else {
    $results[] = ['test_id' => 'CON-35', 'description' => 'symlink escape tests', 'status' => 'SKIPPED', 'expected' => '403', 'actual' => 'symlink creation not permitted on this Windows account; run on Linux hosting'];
    echo "SKIP CON-35..37 symlink creation not permitted here\n";
}

// delete
code_is('CON-38', 'signed delete succeeds', req(['method' => 'DELETE', 'path' => $p]), 204);
code_is('CON-39', 'deleted object is gone', req(['path' => $p]), 404);
code_is('CON-40', 'delete of a missing object is 404', req(['method' => 'DELETE', 'path' => $p]), 404);
code_is('CON-41', 'GET with a body is refused', req(['method' => 'GET', 'path' => $p, 'body' => 'x']), 400);

proc_terminate($srv);
proc_close($srv);
$sum = array_count_values(array_column($results, 'status'));
@mkdir("$repo/evidence", 0777, true);
file_put_contents("$repo/evidence/connector-results.json", json_encode(['suite' => 'connector', 'php' => PHP_VERSION, 'os' => PHP_OS_FAMILY, 'ran_at' => gmdate('c'), 'summary' => $sum, 'results' => $results], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
echo json_encode($sum), "\n";
exit(($sum['FAIL'] ?? 0) > 0 ? 1 : 0);
