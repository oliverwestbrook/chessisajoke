<?php
// Returns the legal target squares for a given from-square
require_once __DIR__ . '/bootstrap.php';
header('Content-Type: application/json');

try {
    $gameId = $_GET['game'] ?? $_POST['game'] ?? 'demo';
    $ff = (int)($_GET['ff'] ?? $_POST['ff'] ?? -1);
    $fr = (int)($_GET['fr'] ?? $_POST['fr'] ?? -1);

    $pos = Storage::load($gameId);
    $out = [];

    if ($pos instanceof Position
        && $pos->status === 'ongoing'
        && $ff >= 0 && $fr >= 0) {
        $pc = $pos->get($ff, $fr);
        // Only the side to move may have legal moves
        if ($pc && Rules::pieceSide($pc) === $pos->sideToMove) {
            foreach (Engine::generateLegalMoves($pos, $ff, $fr) as $m) {
                $out[] = [$m->toF, $m->toR];
            }
        }
    }

    echo json_encode(['ok' => true, 'moves' => $out], JSON_UNESCAPED_SLASHES);
} catch (Throwable $e) {
    error_log('legal_moves error: ' . $e->getMessage());
    echo json_encode(['ok' => false, 'moves' => []], JSON_UNESCAPED_SLASHES);
}
