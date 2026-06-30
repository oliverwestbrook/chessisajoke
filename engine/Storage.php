<?php
final class Storage {
    private static function path(string $game): string { return __DIR__."/storage/state_{$game}.json"; }

    public static function load(string $game): Position {
        $path=self::path($game);
        if (!file_exists($path)) {
            $pos=Position::initial(); self::save($game,$pos); return $pos;
        }
        $json=@file_get_contents($path);
        if ($json===false || $json==='') { $pos=Position::initial(); self::save($game,$pos); return $pos; }
        $arr=json_decode($json,true);
        if (!is_array($arr)) { $pos=Position::initial(); self::save($game,$pos); return $pos; }
        return Position::fromArray($arr);
    }

    public static function save(string $game, Position $pos): void {
        $path=self::path($game);
        $dir=dirname($path); if(!is_dir($dir)) @mkdir($dir,0777,true);
        @file_put_contents($path, json_encode($pos->toArray(),JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES|JSON_PRETTY_PRINT));
        @chmod($path,0777);
    }
}
