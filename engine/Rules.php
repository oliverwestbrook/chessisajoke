<?php
// Joke-mode rules
final class Rules
{
    public const FILES = 9;
    public const RANKS = 9;

    // In-croissant behavior knob referenced by Engine
    public const CROISSANT_MODE = 'strict'; // 'strict' or 'loose'

    // Piece values used by Joker targeting
    public static array $pieceValues = [
        'P'=>1, 'N'=>3, 'B'=>3, 'R'=>5, 'Q'=>9, 'K'=>1000, 'J'=>0
    ];

    // Knight jump deltas
    public static array $knightDeltas = [
        [ 1, 2],[ 2, 1],[ 2,-1],[ 1,-2],
        [-1,-2],[-2,-1],[-2, 1],[-1, 2],
    ];

    // Return 'w' or 'b'
    public static function pieceSide(string $pc): string { return $pc[0]; }

    // Return single-letter type 'P'
    public static function pieceType(string $pc): string { return $pc[1]; }

    public static function inBounds(int $f, int $r): bool {
        return $f >= 0 && $f < self::FILES && $r >= 0 && $r < self::RANKS;
    }

    // Rank a pawn must reach to promote
    public static function promotionRank(string $side): int {
        return ($side === 'w') ? (self::RANKS - 1) : 0;
    }

    // Allowed promotion targets in Joke mode
    public static function promotionChoices(): array {
        return ['Q','R','B','N','J'];
    }

    // Initial board
    public static function initialBoard(): array {
        $board = array_fill(0, self::FILES, array_fill(0, self::RANKS, null));

        // White back rank
        $whiteBack = ['R','N','B','Q','K','B','J','N','R'];
        for ($f=0; $f<self::FILES; $f++) $board[$f][0] = 'w'.$whiteBack[$f];

        // White pawns
        for ($f=0; $f<self::FILES; $f++) $board[$f][1] = 'wP';

        // Black pawns
        for ($f=0; $f<self::FILES; $f++) $board[$f][7] = 'bP';

        // Black back rank
        $blackBack = ['R','N','B','Q','K','B','J','N','R'];
        for ($f=0; $f<self::FILES; $f++) $board[$f][8] = 'b'.$blackBack[$f];

        return $board;
    }
}