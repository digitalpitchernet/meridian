<?php
// Copy to config.php (git-ignored) or point MERIDIAN_CONNECTOR_CONFIG at a file OUTSIDE the web root.
// Generate a secret with:  php -r "echo bin2hex(random_bytes(32)), PHP_EOL;"
return [
    // Absolute path OUTSIDE the web root. Must exist and be writable by PHP only.
    'storage_root' => '/home/founder/meridian-vault',
    // SQLite file for replay protection, also outside the web root.
    'nonce_db' => '/home/founder/meridian-private/nonces.sqlite',
    'require_https' => true,
    // Only true when a reverse proxy you control terminates TLS and sets X-Forwarded-Proto.
    'trust_forwarded_proto' => false,
    'max_bytes' => 52428800,          // 50 MB, matches the company-vault bucket
    'clock_skew_seconds' => 300,
    // Rotation: add the new key, switch Meridian to it, then set the old key's 'active' => false and later remove it.
    'keys' => [
        'k2026a' => [
            'secret_hex' => 'replace-with-64-hex-characters',
            'business_id' => '00000000-0000-0000-0000-000000000000',
            'scopes' => ['read', 'write', 'delete'],
            'active' => true,
        ],
    ],
];
