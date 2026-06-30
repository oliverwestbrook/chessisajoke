<?php
final class Move {
    public int $fromF, $fromR, $toF, $toR;
    public bool $isCastle = false, $isCroissant = false; // croissant = incroissant
    public ?string $promotion = null; // promotion piece

    // Construct a basic move
    public static function make(int $ff, int $fr, int $tf, int $tr): self {
        $m = new self();
        $m->fromF = $ff; $m->fromR = $fr;
        $m->toF   = $tf; $m->toR   = $tr;
        return $m;
    }
}