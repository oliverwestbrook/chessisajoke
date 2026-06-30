<?php
// /engine/subscribe.php
declare(strict_types=1);
header('Content-Type: application/json');

function done(bool $ok, string $msg){
  echo json_encode(['ok'=>$ok,'message'=>$msg], JSON_UNESCAPED_SLASHES);
  exit;
}

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') done(false,'POST only');

// inputs
$email  = trim($_POST['email']  ?? '');
$hp     = trim($_POST['hp']     ?? ''); // honeypot
$ts     = (int)($_POST['ts']    ?? 0); // submit timestamp
$a      = (int)($_POST['a']     ?? 0);
$b      = (int)($_POST['b']     ?? 0);
$answer = trim($_POST['answer'] ?? '');

// honeypot
if ($hp !== '') done(true,'Thanks!');

// basic timing anti-bot
if ($ts <= 0 || (time() - $ts) < 3) done(false,'Hold up a moment and try again.');

// email + quiz validation
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) done(false,'Enter a valid email.');
if ($answer === '' || (string)($a + $b) !== $answer) done(false,'Wrong answer.');

// normalize/sanitize minimal
$email = strtolower($email);
$email = str_replace(["\r","\n"], '', $email);

// storage
$BASE = '/var/appdata/chess/waitlist';
if (!is_dir($BASE) && !@mkdir($BASE, 0700, true)) {
  done(false,'Server storage unavailable.');
}

// simple IP rate limit
$ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
$ipKey = preg_replace('/[^0-9a-f:.]/i', '_', $ip);
$rateDir = $BASE . '/tmp';
if (!is_dir($rateDir)) @mkdir($rateDir, 0700, true);
$rateFile = $rateDir . '/rl_' . $ipKey;
$now = time();
$last = @intval(@file_get_contents($rateFile));
if ($now - $last < 60) done(false,'Too many tries. Give it a sec.');
@file_put_contents($rateFile, (string)$now, LOCK_EX);

// append CSV
$csv   = $BASE . '/emails.csv';
$ua    = str_replace('"','""', ($_SERVER['HTTP_USER_AGENT'] ?? ''));
$line  = sprintf("\"%s\",\"%s\",\"%s\",\"%s\"\n", gmdate('c'), $email, $ip, $ua);

// ensure new files are 600
$oldUmask = umask(0077);
$ok = @file_put_contents($csv, $line, FILE_APPEND | LOCK_EX);
umask($oldUmask);

if ($ok === false) done(false,'Server can’t save right now.');

done(true,'Added — we’ll email you when it’s ready!');