<?php
require_once __DIR__.'/bootstrap.php';

$gameId = $_GET['game'] ?? 'demo';
$pos = Storage::load($gameId);

// Whether the side to move's king is currently attacked
$check = Engine::inCheck($pos, $pos->sideToMove);

header('Content-Type: application/json');
echo json_encode([
    'board'          => $pos->board,
    'sideToMove'     => $pos->sideToMove,
    'kingPos'        => $pos->kingPos,
    'check'          => $check,
    'flaked'         => $pos->flaked,
    'doubleStepped'  => $pos->doubleStepped,
    'croissantRight' => $pos->croissantRight,
    'status'         => $pos->status,
    'winner'         => $pos->winner,
    'reason'         => $pos->reason,
    // persisted end-of-game metadata
    'endedAt'        => $pos->endedAt,
    'finalWhiteTime' => $pos->finalWhiteTime,
    'finalBlackTime' => $pos->finalBlackTime,
    // variant mode
    'mode'           => $pos->mode ?? ($GLOBALS['ENGINE_MODE'] ?? 'joke'),
], JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);