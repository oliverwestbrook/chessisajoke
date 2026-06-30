<?php
require_once __DIR__ . '/bootstrap.php';

try {
    $gameId = $_POST['game'] ?? 'demo';
    $ff = (int)($_POST['ff'] ?? -1);
    $fr = (int)($_POST['fr'] ?? -1);
    $tf = (int)($_POST['tf'] ?? -1);
    $tr = (int)($_POST['tr'] ?? -1);
    $promo = isset($_POST['promo']) ? strtoupper(trim((string)$_POST['promo'])) : null;

    $pos = Storage::load($gameId);
    if(!$pos instanceof Position) throw new Exception("Failed to load game");

    // Block moves after game over
    if($pos->status !== 'ongoing'){
        $msg = 'Game over: '.($pos->reason ?? 'finished');
        jsend(false, [
            'status'=>$pos->status,
            'winner'=>$pos->winner,
            'reason'=>$pos->reason
        ], $msg);
        exit;
    }

    // Basic bounds
    if($ff<0||$fr<0||$tf<0||$tr<0) {
        jsend(false, [], 'Bad coordinates');
        exit;
    }

    // Build move
    $mv = Move::make($ff,$fr,$tf,$tr);

    // Promotion pre-check
    $pc = $pos->get($ff,$fr);
    if ($pc && Rules::pieceType($pc)==='P') {
        $side = Rules::pieceSide($pc);
        $needPromotion = ($tr === Rules::promotionRank($side));
        if ($needPromotion) {
            $choices = Rules::promotionChoices();
            if ($promo === null || !in_array($promo, $choices, true)) {
                jsend(false, ['needPromotion'=>true, 'choices'=>$choices], 'Promotion required');
                exit;
            }
            $mv->promotion = $promo;
        }
    } else {
        // ignore promo if not a pawn move
        $promo = null;
    }

    // Apply on engine
    $res = Engine::applyMove($pos, $mv);
    if (!$res['ok']) {
        jsend(false, [
            'status'=>$pos->status,
            'winner'=>$pos->winner,
            'reason'=>$pos->reason
        ], $res['msg'] ?? 'Illegal or failed move');
        exit;
    }

    // Save updated position
    $new = $res['pos'];
    Storage::save($gameId, $new);

    jsend(true, [
        'sideToMove' => $new->sideToMove ?? 'w',
        'halfmove'   => $new->halfmoveClock ?? 0,
        'ply'        => $new->ply ?? 0,
        'status'     => $new->status,
        'winner'     => $new->winner,
        'reason'     => $new->reason,
    ], 'OK');

} catch (Throwable $e) {
    error_log("validate_move error: ".$e->getMessage());
    jsend(false, [], 'Internal error: '.$e->getMessage());
    exit;
}