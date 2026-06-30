<?php
require_once __DIR__ . '/bootstrap.php';

header('Content-Type: application/json');

try {
    // ms timestamp + 6 base36 chars
    $ms = (string)floor(microtime(true) * 1000);
    $alphabet = '0123456789abcdefghijklmnopqrstuvwxyz';
    $rand = '';
    for ($i=0; $i<6; $i++) { $rand .= $alphabet[random_int(0, strlen($alphabet)-1)]; }
    $gameId = $ms . '-' . $rand;

    // safety
    if (!preg_match('/^[0-9]{10,16}-[0-9a-z]{6}$/', $gameId)) {
        throw new Exception('Bad ID');
    }

    // Mode selection comes from bootstrap via $GLOBALS['ENGINE_MODE']
    $mode = ($GLOBALS['ENGINE_MODE'] === 'classic') ? 'classic' : 'joke';

    // create initial position and save
    $pos = Position::initial();
    $pos->mode = $mode;
    Storage::save($gameId, $pos);

    echo json_encode([
        'ok'    => true,
        'game'  => $gameId,
        'mode'  => $mode,
        'state' => $pos->toArray(),
    ]);
} catch (Throwable $e) {
    error_log('new_game error: '.$e->getMessage());
    echo json_encode(['ok'=>false,'error'=>'Internal error']);
}