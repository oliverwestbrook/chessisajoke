<?php
final class Position {
    public array $board = [];
    public string $sideToMove = 'w';
    public int $halfmoveClock = 0;
    public int $ply = 0;

    public bool $wCastleK = true, $wCastleQ = true, $bCastleK = true, $bCastleQ = true;
    public array $kingPos = ['w'=>[0,0],'b'=>[0,8]];
    // freeze entries
    public array $flaked = [];
    // first-move double-step flags
    public array $doubleStepped = ['w'=>[], 'b'=>[]];
    // in-croissant / en-passant right
    public ?array $croissantRight = null;

    // game state
    public string $status = 'ongoing'; // 'ongoing'|'checkmate'|'draw'
    public ?string $winner = null; // 'w'|'b'|null
    public ?string $reason = null; // 'checkmate'|'stalemate'|'50-move'|'insufficient'|'timeout'|null

    // persisted end-of-game metadata
    public ?int $endedAt = null; // unix timestamp when game ended
    public ?int $finalWhiteTime = null; // remaining white clock at end
    public ?int $finalBlackTime = null; // remaining black clock at end

    // variant mode
    public string $mode = 'joke';

    public static function initial(): self {
        $p = new self();

        // mode comes from bootstrap
        if (isset($GLOBALS['ENGINE_MODE']) && ($GLOBALS['ENGINE_MODE']==='classic' || $GLOBALS['ENGINE_MODE']==='joke')) {
            $p->mode = $GLOBALS['ENGINE_MODE'];
        } else {
            $p->mode = 'joke';
        }

        $p->board = Rules::initialBoard();
        $p->sideToMove = 'w';
        $p->halfmoveClock = 0; $p->ply = 0;
        $p->wCastleK = $p->wCastleQ = $p->bCastleK = $p->bCastleQ = true;
        $p->flaked = [];
        $p->doubleStepped = ['w'=>[], 'b'=>[]];
        $p->croissantRight = null;
        $p->status='ongoing'; $p->winner=null; $p->reason=null;

        // end-of-game metadata defaults
        $p->endedAt = null;
        $p->finalWhiteTime = null;
        $p->finalBlackTime = null;

        // locate kings
        for($f=0;$f<Rules::FILES;$f++){
            for($r=0;$r<Rules::RANKS;$r++){
                $pc = $p->board[$f][$r] ?? null;
                if ($pc && $pc[1]==='K') $p->kingPos[$pc[0]] = [$f,$r];
            }
        }
        return $p;
    }

    public static function fromArray(array $a): self {
        $p = new self();
        foreach ($a as $k=>$v) if (property_exists($p,$k)) $p->$k = $v;

        if (!isset($p->flaked) || !is_array($p->flaked)) $p->flaked = [];
        if (empty($p->doubleStepped) || !is_array($p->doubleStepped)) $p->doubleStepped = ['w'=>[], 'b'=>[]];
        if (!array_key_exists('croissantRight',$a)) $p->croissantRight = null;
        if (!isset($p->status)) $p->status='ongoing';
        if (!array_key_exists('winner',$a)) $p->winner=null;
        if (!array_key_exists('reason',$a)) $p->reason=null;

        // normalize persisted end-of-game fields
        if (!array_key_exists('endedAt',$a)) $p->endedAt = null;
        if (!array_key_exists('finalWhiteTime',$a)) $p->finalWhiteTime = null;
        if (!array_key_exists('finalBlackTime',$a)) $p->finalBlackTime = null;

        // normalize mode
        if (!array_key_exists('mode',$a) || ($p->mode!=='classic' && $p->mode!=='joke')) {
            $p->mode = 'joke';
        }

        if (empty($p->kingPos) || !isset($p->kingPos['w'],$p->kingPos['b'])) {
            $p->kingPos = ['w'=>[0,0],'b'=>[0,8]];
            for($f=0;$f<Rules::FILES;$f++){
                for($r=0;$r<Rules::RANKS;$r++){
                    $pc = $p->board[$f][$r] ?? null;
                    if ($pc && $pc[1]==='K') $p->kingPos[$pc[0]] = [$f,$r];
                }
            }
        }
        return $p;
    }

    public function toArray(): array {
        return [
            'board'=>$this->board,
            'sideToMove'=>$this->sideToMove,
            'halfmoveClock'=>$this->halfmoveClock,
            'ply'=>$this->ply,
            'wCastleK'=>$this->wCastleK,'wCastleQ'=>$this->wCastleQ,
            'bCastleK'=>$this->bCastleK,'bCastleQ'=>$this->bCastleQ,
            'kingPos'=>$this->kingPos,
            'flaked'=>$this->flaked,
            'doubleStepped'=>$this->doubleStepped,
            'croissantRight'=>$this->croissantRight,
            'status'=>$this->status,
            'winner'=>$this->winner,
            'reason'=>$this->reason,
            // persisted end-of-game
            'endedAt'=>$this->endedAt,
            'finalWhiteTime'=>$this->finalWhiteTime,
            'finalBlackTime'=>$this->finalBlackTime,
            // variant
            'mode'=>$this->mode,
        ];
    }

    public function get(int $f,int $r): ?string { return $this->board[$f][$r] ?? null; }

    public function set(int $f,int $r, ?string $pc): void {
        $this->board[$f][$r] = $pc;
        if ($pc && $pc[1]==='K') $this->kingPos[$pc[0]] = [$f,$r];
    }

    public function isFrozen(int $f,int $r): bool {
        if (empty($this->flaked)) return false;
        foreach ($this->flaked as $fx) {
            if (($fx['f']??null)===$f && ($fx['r']??null)===$r) {
                if (!empty($fx['by'])) return true;
                if (((int)($fx['turns']??0))>0) return true;
            }
        }
        return false;
    }

    public function clearExpiredStatuses(): void {
        if (empty($this->flaked)) return;
        foreach ($this->flaked as $i=>$fx) {
            if (!empty($fx['by'])) continue; // active adjacency
            if (isset($fx['turns'])) {
                $t=(int)$fx['turns'];
                if ($t>0) $this->flaked[$i]['turns']=$t-1;
                if ((int)($this->flaked[$i]['turns']??0)<=0) unset($this->flaked[$i]);
            }
        }
        $this->flaked = array_values($this->flaked);
    }

    public function cloneDeep(): self {
        return self::fromArray([
            'board'=>array_map(fn($col)=>array_values($col), $this->board),
            'sideToMove'=>$this->sideToMove,
            'halfmoveClock'=>$this->halfmoveClock,
            'ply'=>$this->ply,
            'wCastleK'=>$this->wCastleK,'wCastleQ'=>$this->wCastleQ,
            'bCastleK'=>$this->bCastleK,'bCastleQ'=>$this->bCastleQ,
            'kingPos'=>[
                'w'=>[$this->kingPos['w'][0],$this->kingPos['w'][1]],
                'b'=>[$this->kingPos['b'][0],$this->kingPos['b'][1]]
            ],
            'flaked'=>array_values($this->flaked),
            'doubleStepped'=>[
                'w'=>$this->doubleStepped['w'] ?? [],
                'b'=>$this->doubleStepped['b'] ?? [],
            ],
            'croissantRight'=>$this->croissantRight,
            'status'=>$this->status,
            'winner'=>$this->winner,
            'reason'=>$this->reason,
            // persisted end-of-game
            'endedAt'=>$this->endedAt,
            'finalWhiteTime'=>$this->finalWhiteTime,
            'finalBlackTime'=>$this->finalBlackTime,
            // variant
            'mode'=>$this->mode,
        ]);
    }
}