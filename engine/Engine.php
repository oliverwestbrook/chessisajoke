<?php
// Joke-mode engine
final class Engine {

    public static function applyMove(Position $pos, Move $mv): array {
        // basic validation
        $pc = $pos->get($mv->fromF, $mv->fromR);
        if (!$pc) return ['ok'=>false,'msg'=>'No piece on source'];
        $side = Rules::pieceSide($pc);
        if ($side !== $pos->sideToMove) return ['ok'=>false,'msg'=>'Not your turn'];
        if ($pos->isFrozen($mv->fromF,$mv->fromR)) return ['ok'=>false,'msg'=>'Piece is frozen'];

        // verify legal target
        $legal = self::generateLegalMoves($pos, $mv->fromF, $mv->fromR);
        $isLegal=false; $isCastle=false; $isCroissant=false;
        foreach ($legal as $m) {
            if ($m->toF===$mv->toF && $m->toR===$mv->toR) {
                $isLegal=true; $isCastle=($m->isCastle ?? false); $isCroissant=($m->isCroissant ?? false); break;
            }
        }
        if (!$isLegal) return ['ok'=>false,'msg'=>'Illegal move'];

        // clone + state that can expire after our turn
        $next = $pos->cloneDeep();
        $expireCroissantAfter=false;
        if (!empty($next->croissantRight) && ($next->croissantRight['allowedFor']??'')===$side) {
            $expireCroissantAfter=true;
        }

        // Precompute whether a moving Joker will have any freezable target at its DEST
        $ptypeMoving = Rules::pieceType($pc);
        $jokerMoving = ($ptypeMoving === 'J');
        $jokerWillHaveNewTargets = false;
        if ($jokerMoving) {
            $jokerWillHaveNewTargets = self::hasFreezableAdjEnemy($next, $mv->toF, $mv->toR, $side);
        }

        // If a Joker moves away
        if ($jokerMoving) {
            foreach ($next->flaked as $i=>$fx) {
                if (($fx['reason']??'')==='joker') {
                    $by=$fx['by']??null;
                    if (is_array($by) && isset($by['f'],$by['r']) && $by['f']===$mv->fromF && $by['r']===$mv->fromR) {
                        if ($jokerWillHaveNewTargets) {
                            // Transfer
                            unset($next->flaked[$i]);
                        } else {
                            // Linger for exactly one opponent turn
                            $next->flaked[$i]['turns']  = 2;
                            $next->flaked[$i]['reason'] = 'joker-linger';
                            unset($next->flaked[$i]['by']);
                        }
                    }
                }
            }
            $next->flaked = array_values($next->flaked);
        }

        // make move on board
        $captured = self::makeOnBoard($next,$pc,$mv->fromF,$mv->fromR,$mv->toF,$mv->toR,$isCastle,$isCroissant);

        // If we captured a Joker
        if ($captured && Rules::pieceType($captured)==='J') {
            foreach ($next->flaked as $i=>$fx) {
                if (($fx['reason']??'')==='joker') {
                    $by=$fx['by']??null;
                    if (is_array($by) && isset($by['f'],$by['r']) && $by['f']===$mv->toF && $by['r']===$mv->toR) {
                        unset($next->flaked[$i]);
                    }
                }
            }
            $next->flaked = array_values($next->flaked);
        }

        // Taking in-croissant freezes the passed pawn for 1 full turn
        if ($isCroissant && !empty($pos->croissantRight)) {
            $pf=$pos->croissantRight['passedF']; $pr=$pos->croissantRight['passedR'];
            $next->flaked[]=['f'=>$pf,'r'=>$pr,'reason'=>'croissant','turns'=>2];
            $next->croissantRight=null;
        }

        // bookkeeping
        $next->ply++;
        $next->clearExpiredStatuses();

        // Joker landing bind
        if ($jokerMoving) {
            self::bindBestTargetForJoker($next,$mv->toF,$mv->toR); // freezes all ties
        }

        // halfmove clock
        if ($ptypeMoving==='P' || ($captured && Rules::pieceType($captured)!=='J')) {
            $next->halfmoveClock=0;
        } else {
            $next->halfmoveClock++;
        }

        // track first-move double-steps
        if ($ptypeMoving==='P' && abs($mv->toR-$mv->fromR)===2 && $mv->fromR===self::startRank($side)) {
            $next->doubleStepped[$side][$mv->fromF]=true;
        }

        // create in-croissant right when a single-step creates side-by-side after double-steps
        if ($ptypeMoving==='P' && abs($mv->toR-$mv->fromR)===1) {
            $opp = ($side==='w')?'b':'w';
            $tf=$mv->toF; $tr=$mv->toR;
            foreach([-1,1] as $df){
                $nf=$tf+$df; $nr=$tr;
                if(!Rules::inBounds($nf,$nr)) continue;
                $np=$next->get($nf,$nr);
                if($np && Rules::pieceType($np)==='P' && Rules::pieceSide($np)===$opp){
                    $needBoth = (Rules::CROISSANT_MODE === 'strict');
                    if (
                        !empty($next->doubleStepped[$side][$mv->fromF]) &&
                        (!$needBoth || !empty($next->doubleStepped[$opp][$nf]))
                    ) {
                        $next->croissantRight=['allowedFor'=>$opp,'passedF'=>$tf,'passedR'=>$tr];
                        break;
                    }
                }
            }
        } else {
            if ($expireCroissantAfter) $next->croissantRight=null;
        }

        // PROMOTION
        if ($ptypeMoving==='P' && $mv->toR === Rules::promotionRank($side)) {
            $choices = Rules::promotionChoices();
            $promo   = $mv->promotion ?? null;
            if (!$promo || !in_array($promo, $choices, true)) {
                // Ask client to provide a promotion piece
                return ['ok'=>false,'msg'=>'Promotion required'];
            }
            // Replace pawn with promoted piece
            $next->set($mv->toF, $mv->toR, $side.$promo);
        }

        // global Joker retarget
        self::retargetAllJokers($next);

        // switch turn
        $next->sideToMove = ($pos->sideToMove==='w') ? 'b' : 'w';

        // evaluate game end
        self::evaluateAndMarkGameEnd($next);

        return ['ok'=>true,'msg'=>'OK','pos'=>$next];
    }

    // move generation
    public static function generateLegalMoves(Position $p,int $f,int $r): array {
        $pc=$p->get($f,$r); if(!$pc) return [];
        if($p->isFrozen($f,$r)) return [];
        $s=Rules::pieceSide($pc); $t=Rules::pieceType($pc);
        $moves = [
            'P'=>array_merge(self::pawnPushes($p,$f,$r,$s), self::pawnCaptures($p,$f,$r,$s), self::pawnCroissant($p,$f,$r,$s)),
            'N'=>self::knightLike($p,$f,$r,$s,false),
            'B'=>self::sliders($p,$f,$r,$s,[[1,1],[1,-1],[-1,1],[-1,-1]]),
            'R'=>self::sliders($p,$f,$r,$s,[[1,0],[-1,0],[0,1],[0,-1]]),
            'Q'=>array_merge(self::sliders($p,$f,$r,$s,[[1,0],[-1,0],[0,1],[0,-1]]), self::sliders($p,$f,$r,$s,[[1,1],[1,-1],[-1,1],[-1,-1]])),
            'K'=>array_merge(self::kingSteps($p,$f,$r,$s), self::castling($p,$f,$r,$s)),
            'J'=>self::knightLike($p,$f,$r,$s,true),
        ][$t] ?? [];

        // can't capture own piece
        $moves = array_values(array_filter($moves,function($m)use($p,$s){
            $dst=$p->get($m->toF,$m->toR);
            return (!$dst) || Rules::pieceSide($dst)!==$s;
        }));

        // filter out moves that leave own king in check
        $legal=[];
        foreach($moves as $m){
            $test = $p->cloneDeep();
            $pcT  = $test->get($f,$r);
            $isCastle     = $m->isCastle     ?? false;
            $isCroissant  = $m->isCroissant  ?? false;
            self::makeOnBoard($test,$pcT,$f,$r,$m->toF,$m->toR,$isCastle,$isCroissant);
            if(!self::inCheck($test,$s)) $legal[] = $m;
        }
        return $legal;
    }

    private static function pawnDir(string $s): int { return $s==='w'?+1:-1; }
    private static function startRank(string $s): int { return $s==='w'?1:7; } // 9×9 start ranks

    private static function pawnPushes(Position $p,int $f,int $r,string $s): array {
        $res=[]; $d=self::pawnDir($s);
        $tf=$f; $tr=$r+$d;
        if (Rules::inBounds($tf,$tr) && !$p->get($tf,$tr)) {
            $res[] = Move::make($f,$r,$tf,$tr);
            if (($s==='w' && $r===1) || ($s==='b' && $r===7)) {
                $tr2=$r+2*$d;
                if (Rules::inBounds($tf,$tr2) && !$p->get($tf,$tr2)) $res[] = Move::make($f,$r,$tf,$tr2);
            }
        }
        return $res;
    }

    private static function pawnCaptures(Position $p,int $f,int $r,string $s): array {
        $res=[]; $d=self::pawnDir($s);
        foreach([-1,1] as $df){
            $tf=$f+$df; $tr=$r+$d;
            if(!Rules::inBounds($tf,$tr)) continue;
            $dst=$p->get($tf,$tr);
            if($dst && Rules::pieceSide($dst)!==$s) $res[] = Move::make($f,$r,$tf,$tr);
        }
        return $res;
    }

    // In-Croissant pseudo-move
    private static function pawnCroissant(Position $p,int $f,int $r,string $s): array {
        $res=[];
        $cr=$p->croissantRight ?? null;
        if(!$cr || ($cr['allowedFor']??'')!==$s) return $res;
        $pf=$cr['passedF']; $pr=$cr['passedR'];
        if($r!==$pr || abs($f-$pf)!==1) return $res;
        $dir=self::pawnDir($s);
        $tf=$pf; $tr=$pr+$dir;
        if(!Rules::inBounds($tf,$tr)) return $res;
        if($p->get($tf,$tr)) return $res;
        $m=Move::make($f,$r,$tf,$tr); $m->isCroissant=true; $res[]=$m;
        return $res;
    }

    private static function knightLike(Position $p,int $f,int $r,string $s,bool $joker): array {
        $res=[];
        foreach(Rules::$knightDeltas as [$df,$dr]){
            $tf=$f+$df; $tr=$r+$dr;
            if(!Rules::inBounds($tf,$tr)) continue;
            // Joker cannot capture
            if($joker){
                if(!$p->get($tf,$tr)) $res[] = Move::make($f,$r,$tf,$tr);
            }else{
                $res[] = Move::make($f,$r,$tf,$tr);
            }
        }
        return $res;
    }

    private static function sliders(Position $p,int $f,int $r,string $s,array $dirs): array {
        $res=[];
        foreach($dirs as [$df,$dr]){
            $tf=$f+$df; $tr=$r+$dr;
            while(Rules::inBounds($tf,$tr)){
                $dst=$p->get($tf,$tr);
                if($dst){
                    if(Rules::pieceSide($dst)!==$s) $res[] = Move::make($f,$r,$tf,$tr);
                    break;
                }else{
                    $res[] = Move::make($f,$r,$tf,$tr);
                }
                $tf+=$df; $tr+=$dr;
            }
        }
        return $res;
    }

    private static function kingSteps(Position $p,int $f,int $r,string $s): array {
        $res=[];
        for($df=-1;$df<=1;$df++)for($dr=-1;$dr<=1;$dr++){
            if(!$df&&!$dr) continue;
            $tf=$f+$df; $tr=$r+$dr;
            if(Rules::inBounds($tf,$tr)) $res[] = Move::make($f,$r,$tf,$tr);
        }
        return $res;
    }

    private static function castling(Position $p,int $f,int $r,string $s): array {
        $res=[];
        // castling geometry
        $kingHomeF=4; $maxF=Rules::FILES-1;
        $canK = ($s==='w') ? $p->wCastleK : $p->bCastleK;
        $canQ = ($s==='w') ? $p->wCastleQ : $p->bCastleQ;
        if($f!==$kingHomeF) return $res;

        // cannot castle out of/through check
        if(self::inCheck($p,$s)) return $res;

        // Kingside
        if($canK){
            $empty=true; for($x=$f+1;$x<$maxF;$x++) if($p->get($x,$r)){$empty=false;break;}
            if($empty && !self::pathThroughCheck($p,$s,$f,$r,[$f+1,$f+2,$f+3])){
                $m=Move::make($f,$r,$f+3,$r); $m->isCastle=true; $res[]=$m;
            }
        }
        // Queenside
        if($canQ){
            $empty=true; for($x=$f-1;$x>0;$x--) if($p->get($x,$r)){$empty=false;break;}
            if($empty && !self::pathThroughCheck($p,$s,$f,$r,[$f-1,$f-2,$f-3])){
                $m=Move::make($f,$r,$f-3,$r); $m->isCastle=true; $res[]=$m;
            }
        }
        return $res;
    }

    private static function pathThroughCheck(Position $p,string $s,int $kf,int $kr,array $files): bool {
        $opp = ($s==='w')?'b':'w';
        foreach($files as $tf){ if(self::squareAttacked($p,$opp,$tf,$kr)) return true; }
        return false;
    }

    private static function makeOnBoard(Position $p,string $pc,int $ff,int $fr,int $tf,int $tr,bool $castle,bool $croissant): ?string {
        $captured=null; $maxF=Rules::FILES-1;

        if($castle){
            $p->set($tf,$tr,$pc); $p->set($ff,$fr,null);
            // Rook moves to be adjacent to king toward the center
            if($tf>$ff){ // kingside
                $rookSrcF=$maxF; $rookDstF=$tf-1;
            } else { // queenside
                $rookSrcF=0;     $rookDstF=$tf+1;
            }
            $rook=$p->get($rookSrcF,$tr);
            if($rook && Rules::pieceType($rook)==='R' && Rules::pieceSide($rook)===Rules::pieceSide($pc)){
                $p->set($rookDstF,$tr,$rook); $p->set($rookSrcF,$tr,null);
            }
            if(Rules::pieceSide($pc)==='w'){ $p->wCastleK=false; $p->wCastleQ=false; } else { $p->bCastleK=false; $p->bCastleQ=false; }
            return null;
        }

        if($croissant){
            $p->set($tf,$tr,$pc); $p->set($ff,$fr,null);
            return null; // no capture in in-croissant
        }

        $dst=$p->get($tf,$tr);
        if($dst){ $captured=$dst; }
        $p->set($tf,$tr,$pc); $p->set($ff,$fr,null);

        // update castling rights on K/R move or rook capture
        if(Rules::pieceType($pc)==='K'){
            if(Rules::pieceSide($pc)==='w'){ $p->wCastleK=false; $p->wCastleQ=false; }
            else { $p->bCastleK=false; $p->bCastleQ=false; }
        }
        if(Rules::pieceType($pc)==='R'){
            if(Rules::pieceSide($pc)==='w'){ if($ff===$maxF)$p->wCastleK=false; if($ff===0)$p->wCastleQ=false; }
            else { if($ff===$maxF)$p->bCastleK=false; if($ff===0)$p->bCastleQ=false; }
        }
        if($dst && Rules::pieceType($dst)==='R'){
            if(Rules::pieceSide($dst)==='w'){ if($tf===$maxF)$p->wCastleK=false; if($tf===0)$p->wCastleQ=false; }
            else { if($tf===$maxF)$p->bCastleK=false; if($tf===0)$p->bCastleQ=false; }
        }

        return $captured;
    }

    // attacks / checks
    public static function inCheck(Position $p,string $side): bool {
        $k=$p->kingPos[$side]??null; if(!$k) return false;
        $opp=$side==='w'?'b':'w';
        return self::squareAttacked($p,$opp,$k[0],$k[1]);
    }

    public static function squareAttacked(Position $p,string $att,int $tf,int $tr): bool {
        // Knights + Jokers
        foreach(Rules::$knightDeltas as [$df,$dr]){
            $sf=$tf-$df; $sr=$tr-$dr;
            if(Rules::inBounds($sf,$sr)){
                $pc=$p->get($sf,$sr);
                if($pc && Rules::pieceSide($pc)===$att){
                    if ($p->isFrozen($sf,$sr)) {
                        // frozen piece does not contribute attack pressure in Joke mode
                    } else {
                        $t=Rules::pieceType($pc);
                        if($t==='N') return true;
                    }
                }
            }
        }
        // Pawns
        $d=($att==='w')?+1:-1;
        foreach([-1,+1] as $df){
            $sf=$tf-$df; $sr=$tr-$d;
            if(Rules::inBounds($sf,$sr)){
                $pc=$p->get($sf,$sr);
                if($pc && Rules::pieceSide($pc)===$att){
                    if ($p->isFrozen($sf,$sr)) {
                        // frozen pawn doesn't attack
                    } else if (Rules::pieceType($pc)==='P') {
                        return true;
                    }
                }
            }
        }
        // King
        for($df=-1;$df<=1;$df++)for($dr=-1;$dr<=1;$dr++){
            if(!$df&&!$dr) continue;
            $sf=$tf-$df; $sr=$tr-$dr;
            if(Rules::inBounds($sf,$sr)){
                $pc=$p->get($sf,$sr);
                if($pc && Rules::pieceSide($pc)===$att){
                    if ($p->isFrozen($sf,$sr)) {
                        // frozen king doesn't attack
                    } else if (Rules::pieceType($pc)==='K') {
                        return true;
                    }
                }
            }
        }
        // Sliders
        $dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
        foreach($dirs as [$df,$dr]){
            $sf=$tf+$df; $sr=$tr+$dr;
            while(Rules::inBounds($sf,$sr)){
                $pc=$p->get($sf,$sr);
                if($pc){
                    // Any piece blocks the ray
                    if(Rules::pieceSide($pc)===$att){
                        if (!$p->isFrozen($sf,$sr)) {
                            $t=Rules::pieceType($pc);
                            $ortho = ($df==0||$dr==0);
                            $diag  = ($df!=0&&$dr!=0);
                            if(($ortho && ($t==='R'||$t==='Q')) || ($diag && ($t==='B'||$t==='Q'))) return true;
                        }
                    }
                    break;
                }
                $sf+=$df; $sr+=$dr;
            }
        }
        return false;
    }

    // Joker freezing logic
    private static function bindBestTargetForJoker(Position $p,int $jf,int $jr): void {
        $here = $p->get($jf,$jr); if(!$here) return;
        $side = Rules::pieceSide($here);
        $opp  = ($side==='w') ? 'b' : 'w';

        $bestVal = -1;
        $cands = [];
        for($df=-1;$df<=1;$df++)for($dr=-1;$dr<=1;$dr++){
            if(!$df&&!$dr) continue;
            $tf=$jf+$df; $tr=$jr+$dr;
            if(!Rules::inBounds($tf,$tr)) continue;
            $pc=$p->get($tf,$tr);
            if($pc && Rules::pieceSide($pc)===$opp){
                $t = Rules::pieceType($pc);
                if($t==='K' || $t==='J') continue; // cannot freeze king or joker
                $v = Rules::$pieceValues[$t] ?? 0;
                if($v>$bestVal){ $bestVal=$v; $cands=[['f'=>$tf,'r'=>$tr]]; }
                else if($v===$bestVal){ $cands[]=['f'=>$tf,'r'=>$tr]; }
            }
        }

        if($bestVal<0) return; // nothing freezable
        foreach($cands as $c){
            $p->flaked[]=['f'=>$c['f'],'r'=>$c['r'],'reason'=>'joker','by'=>['f'=>$jf,'r'=>$jr]];
        }
    }

    private static function hasFreezableAdjEnemy(Position $p,int $jf,int $jr,string $side): bool {
        $opp = ($side==='w') ? 'b' : 'w';
        for($df=-1;$df<=1;$df++)for($dr=-1;$dr<=1;$dr++){
            if(!$df&&!$dr) continue;
            $tf=$jf+$df; $tr=$jr+$dr;
            if(!Rules::inBounds($tf,$tr)) continue;
            $pc=$p->get($tf,$tr);
            if($pc && Rules::pieceSide($pc)===$opp){
                $t=Rules::pieceType($pc);
                if($t!=='K' && $t!=='J') return true; // at least one freezable enemy
            }
        }
        return false;
    }

    private static function retargetAllJokers(Position $p): void {
        // Keep non-joker flake entries
        $kept=[];
        foreach($p->flaked as $fx){
            if(($fx['reason']??'')!=='joker'){ $kept[]=$fx; }
        }

        // Find all jokers
        $rebuilt = $kept;
        for($f=0;$f<Rules::FILES;$f++){
            for($r=0;$r<Rules::RANKS;$r++){
                $pc=$p->get($f,$r);
                if($pc && Rules::pieceType($pc)==='J'){
                    // rebuild joker bindings
                    $p->flaked = $rebuilt;
                    self::bindBestTargetForJoker($p,$f,$r); // append to flaked
                    $rebuilt = $p->flaked; // carry forward
                }
            }
        }
        $p->flaked = $rebuilt;
    }

    // game end evaluation
    private static function evaluateAndMarkGameEnd(Position $p): void {
        if($p->status!=='ongoing') return;

        $side=$p->sideToMove;
        $opp = ($side==='w')?'b':'w';

        $hasMove = self::hasAnyLegalMove($p,$side);
        $inCheck = self::inCheck($p,$side);

        if(!$hasMove && $inCheck){
            $p->status='checkmate'; $p->winner=$opp; $p->reason='checkmate';
            if($p->endedAt===null) $p->endedAt=time();
            return;
        }
        if(!$hasMove && !$inCheck){
            $p->status='draw'; $p->winner=null; $p->reason='stalemate';
            if($p->endedAt===null) $p->endedAt=time();
            return;
        }

        if($p->halfmoveClock>=100){
            $p->status='draw'; $p->winner=null; $p->reason='50-move';
            if($p->endedAt===null) $p->endedAt=time();
            return;
        }

        if(self::insufficientMaterial($p)){
            $p->status='draw'; $p->winner=null; $p->reason='insufficient';
            if($p->endedAt===null) $p->endedAt=time();
            return;
        }
    }

    private static function hasAnyLegalMove(Position $p,string $side): bool {
        for($f=0;$f<Rules::FILES;$f++){
            for($r=0;$r<Rules::RANKS;$r++){
                $pc=$p->get($f,$r);
                if(!$pc || Rules::pieceSide($pc)!==$side) continue;
                $moves=self::generateLegalMoves($p,$f,$r);
                if(!empty($moves)) return true;
            }
        }
        return false;
    }

    private static function insufficientMaterial(Position $p): bool {
        $count=['w'=>['P'=>0,'N'=>0,'B'=>0,'R'=>0,'Q'=>0,'J'=>0],'b'=>['P'=>0,'N'=>0,'B'=>0,'R'=>0,'Q'=>0,'J'=>0]];
        for($f=0;$f<Rules::FILES;$f++){
            for($r=0;$r<Rules::RANKS;$r++){
                $pc=$p->get($f,$r); if(!$pc) continue;
                $s=$pc[0]; $t=$pc[1];
                if(isset($count[$s][$t])) $count[$s][$t]++;
            }
        }
        // If either side has pawns/rooks/queens
        foreach(['w','b'] as $s){ if($count[$s]['P']>0 || $count[$s]['R']>0 || $count[$s]['Q']>0) return false; }
        // Allow king only
        if(($count['w']['N']+$count['w']['B']+$count['w']['J']<=1) && ($count['b']['N']+$count['b']['B']+$count['b']['J']<=1)) return true;
        return false;
    }
}
