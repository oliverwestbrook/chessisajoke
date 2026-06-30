<?php
require_once __DIR__ . '/bootstrap.php';

header('Content-Type: application/json');

try {
    // inputs
    $gameId = $_POST['game'] ?? 'demo';
    $reason = isset($_POST['reason']) ? strtolower(trim((string)$_POST['reason'])) : null; // reason
    $winner = isset($_POST['winner']) ? strtolower(trim((string)$_POST['winner'])) : null; // 'w'|'b' or null
    $finalWhiteTime = isset($_POST['finalWhiteTime']) ? (int)$_POST['finalWhiteTime'] : null;
    $finalBlackTime = isset($_POST['finalBlackTime']) ? (int)$_POST['finalBlackTime'] : null;

    // normalize clocks
    if ($finalWhiteTime !== null && $finalWhiteTime < 0) $finalWhiteTime = 0;
    if ($finalBlackTime !== null && $finalBlackTime < 0) $finalBlackTime = 0;

    // load
    $pos = Storage::load($gameId);
    if (!$pos instanceof Position) {
        jsend(false, [], 'Failed to load game');
        exit;
    }

    $changed = false;

    // persist final clocks if provided
    if ($finalWhiteTime !== null && $pos->finalWhiteTime !== $finalWhiteTime) {
        $pos->finalWhiteTime = $finalWhiteTime;
        $changed = true;
    }
    if ($finalBlackTime !== null && $pos->finalBlackTime !== $finalBlackTime) {
        $pos->finalBlackTime = $finalBlackTime;
        $changed = true;
    }

    // mark end if needed
    if ($pos->status !== 'ongoing' && $pos->endedAt === null) {
        $pos->endedAt = time();
        $changed = true;
    }

    // Handle client-declared timeout only if still ongoing
    if ($pos->status === 'ongoing' && $reason === 'timeout') {
        // Winner must be provided and valid for timeout
        if ($winner !== 'w' && $winner !== 'b') {
            jsend(false, [], 'Timeout requires a valid winner: w or b');
            exit;
        }
        // timeout result
        $pos->status = 'draw';
        $pos->winner = $winner;
        $pos->reason = 'timeout';
        $pos->endedAt = time();
        $changed = true;
    }

    // If the game is ended
    if ($pos->status !== 'ongoing' && $pos->endedAt === null) {
        $pos->endedAt = time();
        $changed = true;
    }

    if ($changed) Storage::save($gameId, $pos);

    jsend(true, [
        'status'         => $pos->status,
        'winner'         => $pos->winner,
        'reason'         => $pos->reason,
        'endedAt'        => $pos->endedAt,
        'finalWhiteTime' => $pos->finalWhiteTime,
        'finalBlackTime' => $pos->finalBlackTime,
    ], 'OK');
} catch (Throwable $e) {
    error_log('end_game error: '.$e->getMessage());
    jsend(false, [], 'Internal error');
}