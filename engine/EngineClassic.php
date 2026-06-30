<?php
// Classic chess engine
final class Engine {

    public static function applyMove(Position $pos, Move $mv): array {
        // basic validation
        $pc=$pos->get($mv->fromF,$mv->fromR); if(!$pc) return ['ok'=>false,'msg'=>'No piece on source'];
        $side=Rules::pieceSide($pc); if($side!==$pos->sideToMove) return ['ok'=>false,'msg'=>'Not your turn'];
        if(method_exists($pos,'isFrozen') && $pos->isFrozen($mv->fromF,$mv->fromR)) return ['ok'=>false,'msg'=>'Piece is frozen'];

        // legal set
        $legal=self::generateLegalMoves($pos,$mv->fromF,$mv->fromR);
        $isLegal=false; $isCastle=false; $isEP=false;
        foreach($legal as $m){
            if($m->toF===$mv->toF && $m->toR===$mv->toR){
                $isLegal=true; $isCastle=$m->isCastle; $isEP=$m->isCroissant; break;
            }
        }
        if(!$isLegal) return ['ok'=>false,'msg'=>'Illegal move'];

        $next=$pos->cloneDeep();

        // if mover had a pending EP right and didn't take it
        $expireEPAfter=false;
        if(!empty($next->croissantRight) && ($next->croissantRight['allowedFor']??'')===$side) $expireEPAfter=true;

        // make the move on a copy
        $captured=self::makeOnBoard($next,$pc,$mv->fromF,$mv->fromR,$mv->toF,$mv->toR,$isCastle,$isEP);

        // halfmove clock
        $ptype=Rules::pieceType($pc);
        if($ptype==='P' || $captured) $next->halfmoveClock=0; else $next->halfmoveClock++;

        // en passant right creation
        if($ptype==='P' && abs($mv->toR-$mv->fromR)===2 && $mv->fromR===self::startRank($side)){
            $opp=($side==='w')?'b':'w';
            $passedR = $mv->fromR + self::pawnDir($side); // square the pawn passed through
            $next->croissantRight=['allowedFor'=>$opp,'epF'=>$mv->toF,'epR'=>$passedR];
        } else {
            if($expireEPAfter) $next->croissantRight=null;
        }

        // promotion
        if ($ptype==='P' && $mv->toR === Rules::promotionRank($side)) {
            $choices = Rules::promotionChoices();
            $promo = $mv->promotion ?? null;
            if (!$promo || !in_array($promo, $choices, true)) {
                // Do not finalize the move
                return ['ok'=>false,'msg'=>'Promotion required'];
            }
            // replace pawn with promoted piece
            $next->set($mv->toF, $mv->toR, $side.$promo);
        }

        // switch turn
        $next->sideToMove = ($pos->sideToMove==='w')?'b':'w';

        // game-state evaluation
        self::evaluateAndMarkGameEnd($next);

        return ['ok'=>true,'msg'=>'OK','pos'=>$next];
    }

    public static function generateLegalMoves(Position $p,int $f,int $r): array {
        $pc=$p->get($f,$r); if(!$pc) return [];
        if(method_exists($p,'isFrozen') && $p->isFrozen($f,$r)) return [];
        $s=Rules::pieceSide($pc); $t=Rules::pieceType($pc);
        $moves = [
            'P'=>array_merge(self::pawnPushes($p,$f,$r,$s),self::pawnCaptures($p,$f,$r,$s),self::pawnEnPassant($p,$f,$r,$s)),
            'N'=>self::knightLike($p,$f,$r,$s),
            'B'=>self::sliders($p,$f,$r,$s,[[1,1],[1,-1],[-1,1],[-1,-1]]),
            'R'=>self::sliders($p,$f,$r,$s,[[1,0],[-1,0],[0,1],[0,-1]]),
            'Q'=>array_merge(self::sliders($p,$f,$r,$s,[[1,0],[-1,0],[0,1],[0,-1]]),self::sliders($p,$f,$r,$s,[[1,1],[1,-1],[-1,1],[-1,-1]])),
            'K'=>array_merge(self::kingSteps($p,$f,$r,$s),self::castling($p,$f,$r,$s)),
        ][$t] ?? [];

        // can't capture own piece
        $moves=array_values(array_filter($moves,function($m)use($p,$s){
            $dst=$p->get($m->toF,$m->toR);
            return (!$dst) || Rules::pieceSide($dst)!==$s;
        }));

        // filter out moves that leave own king in check
        $legal=[];
        foreach($moves as $m){
            $test=$p->cloneDeep();
            $pc=$test->get($f,$r);
            $isCastle=$m->isCastle ?? false;
            $isEP=$m->isCroissant ?? false;
            self::makeOnBoard($test,$pc,$f,$r,$m->toF,$m->toR,$isCastle,$isEP);
            if(!self::inCheck($test,$s)) $legal[]=$m;
        }
        return $legal;
    }

    private static function pawnDir(string $s): int { return $s==='w'?+1:-1; }
    private static function startRank(string $s): int { return $s==='w'?1:6; }

    private static function pawnPushes(Position $p,int $f,int $r,string $s): array {
        $res=[]; $d=self::pawnDir($s);
        $tf=$f; $tr=$r+$d;
        if(Rules::inBounds($tf,$tr) && !$p->get($tf,$tr)){
            $res[]=Move::make($f,$r,$tf,$tr);
            if($r===self::startRank($s)){
                $tr2=$r+2*$d;
                if(Rules::inBounds($tf,$tr2) && !$p->get($tf,$tr2)) $res[]=Move::make($f,$r,$tf,$tr2);
            }
        }
        return $res;
    }

    private static function pawnCaptures(Position $p,int $f,int $r,string $s): array {
        $res=[]; $d=self::pawnDir($s);
        foreach([-1,1]as$df){
            $tf=$f+$df; $tr=$r+$d;
            if(!Rules::inBounds($tf,$tr))continue;
            $dst=$p->get($tf,$tr);
            if($dst && Rules::pieceSide($dst)!==$s) $res[]=Move::make($f,$r,$tf,$tr);
        }
        return $res;
    }

    // En Passant
    private static function pawnEnPassant(Position $p,int $f,int $r,string $s): array {
        $res=[];
        $cr=$p->croissantRight ?? null;
        if(!$cr || ($cr['allowedFor']??'')!==$s) return $res;

        $epF = $cr['epF'] ?? null;
        $epR = $cr['epR'] ?? null;
        if(!is_int($epF) || !is_int($epR)) return $res;

        // Capturing pawn must be on the rank just behind the EP square
        $requiredR = $epR - self::pawnDir($s);
        if($r!==$requiredR || abs($f-$epF)!==1) return $res;

        // Destination is the EP square
        if(!Rules::inBounds($epF,$epR)) return $res;
        if($p->get($epF,$epR)) return $res;

        // There must be an opponent pawn on the square beyond the EP square
        $opp = ($s==='w')?'b':'w';
        $dirOpp = self::pawnDir($opp);
        $captF=$epF; $captR=$epR + $dirOpp;
        $capt = Rules::inBounds($captF,$captR) ? $p->get($captF,$captR) : null;
        if(!$capt || Rules::pieceType($capt)!=='P' || Rules::pieceSide($capt)!==$opp) return $res;

        $m=Move::make($f,$r,$epF,$epR); $m->isCroissant=true; // reuse flag to signal EP
        $res[]=$m;
        return $res;
    }

    private static function knightLike(Position $p,int $f,int $r,string $s): array {
        $res=[];
        foreach(Rules::$knightDeltas as [$df,$dr]){
            $tf=$f+$df; $tr=$r+$dr; if(!Rules::inBounds($tf,$tr))continue;
            $res[]=Move::make($f,$r,$tf,$tr);
        }
        return $res;
    }

    private static function sliders(Position $p,int $f,int $r,string $s,array $dirs): array {
        $res=[];
        foreach($dirs as [$df,$dr]){
            $tf=$f+$df; $tr=$r+$dr;
            while(Rules::inBounds($tf,$tr)){
                $res[]=Move::make($f,$r,$tf,$tr);
                if($p->get($tf,$tr))break;
                $tf+=$df; $tr+=$dr;
            }
        }
        return $res;
    }

    private static function kingSteps(Position $p,int $f,int $r,string $s): array {
        $res=[];
        for($df=-1;$df<=1;$df++)for($dr=-1;$dr<=1;$dr++){
            if(!$df&&!$dr)continue;
            $tf=$f+$df; $tr=$r+$dr; if(Rules::inBounds($tf,$tr)) $res[]=Move::make($f,$r,$tf,$tr);
        }
        return $res;
    }

    private static function castling(Position $p,int $f,int $r,string $s): array {
        $res=[];
        $kingHomeF=4; // e-file on 8x8
        $maxF = Rules::FILES - 1; // 7
        $canK=($s==='w')?$p->wCastleK:$p->bCastleK; $canQ=($s==='w')?$p->wCastleQ:$p->bCastleQ;

        if($f!==$kingHomeF) return $res;

        // Cannot castle while currently in check
        if(self::inCheck($p,$s)) return $res;

        if($canK){
            // squares between king and rook must be empty
            $empty=true; for($x=$f+1;$x<$maxF;$x++) if($p->get($x,$r)){$empty=false;break;}
            if($empty && !self::pathThroughCheck($p,$s,$f,$r,[$f+1,$f+2])){
                $m=Move::make($f,$r,$f+2,$r); $m->isCastle=true; $res[]=$m;
            }
        }
        if($canQ){
            // squares between king and rook must be empty
            $empty=true; for($x=$f-1;$x>0;$x--) if($p->get($x,$r)){$empty=false;break;}
            if($empty && !self::pathThroughCheck($p,$s,$f,$r,[$f-1,$f-2])){
                $m=Move::make($f,$r,$f-2,$r); $m->isCastle=true; $res[]=$m;
            }
        }
        return $res;
    }

    private static function pathThroughCheck(Position $p,string $s,int $kf,int $kr,array $files): bool {
        $opp = ($s==='w')?'b':'w';
        foreach($files as $tf){ if(self::squareAttacked($p,$opp,$tf,$kr)) return true; }
        return false;
    }

    private static function makeOnBoard(Position $p,string $pc,int $ff,int $fr,int $tf,int $tr,bool $castle,bool $enPassant): ?string {
        $captured=null;
        $maxF = Rules::FILES - 1;

        if($castle){
            $p->set($tf,$tr,$pc); $p->set($ff,$fr,null);
            if($tf>$ff){ $rookSrcF=$maxF; $rookDstF=$tf-1; } else { $rookSrcF=0; $rookDstF=$tf+1; }
            $rook=$p->get($rookSrcF,$tr);
            if($rook && Rules::pieceType($rook)==='R' && Rules::pieceSide($rook)===Rules::pieceSide($pc)){
                $p->set($rookDstF,$tr,$rook); $p->set($rookSrcF,$tr,null);
            }
            if(Rules::pieceSide($pc)==='w'){ $p->wCastleK=false; $p->wCastleQ=false; } else { $p->bCastleK=false; $p->bCastleQ=false; }
            return null;
        }

        if($enPassant){
            // Move to EP square and remove the passed pawn behind it
            $opp = (Rules::pieceSide($pc)==='w')?'b':'w';
            $dirOpp=self::pawnDir($opp);
            $p->set($tf,$tr,$pc); $p->set($ff,$fr,null);
            $capF=$tf; $capR=$tr + $dirOpp;
            $dst=$p->get($capF,$capR);
            if($dst && Rules::pieceType($dst)==='P' && Rules::pieceSide($dst)===$opp){
                $captured=$dst; $p->set($capF,$capR,null);
            }
            // EP right consumed
            $p->croissantRight=null;
            return $captured;
        }

        $dst=$p->get($tf,$tr);
        if($dst){
            $captured=$dst;
        }
        $p->set($tf,$tr,$pc); $p->set($ff,$fr,null);

        // Update castling rights on K / R move or rook capture
        if(Rules::pieceType($pc)==='K'){
            if(Rules::pieceSide($pc)==='w'){ $p->wCastleK=false; $p->wCastleQ=false; }
            else{ $p->bCastleK=false; $p->bCastleQ=false; }
        }
        if(Rules::pieceType($pc)==='R'){
            if(Rules::pieceSide($pc)==='w'){ if($ff===$maxF)$p->wCastleK=false; if($ff===0)$p->wCastleQ=false; }
            else{ if($ff===$maxF)$p->bCastleK=false; if($ff===0)$p->bCastleQ=false; }
        }
        if($dst && Rules::pieceType($dst)==='R'){
            if(Rules::pieceSide($dst)==='w'){ if($tf===$maxF)$p->wCastleK=false; if($tf===0)$p->wCastleQ=false; }
            else{ if($tf===$maxF)$p->bCastleK=false; if($tf===0)$p->bCastleQ=false; }
        }
        return $captured;
    }

    public static function inCheck(Position $p,string $side): bool {
        $k=$p->kingPos[$side]??null; if(!$k) return false;
        $opp=$side==='w'?'b':'w'; return self::squareAttacked($p,$opp,$k[0],$k[1]);
    }

	public static function squareAttacked(Position $p,string $att,int $tf,int $tr): bool {
	    // Knights
	    foreach(Rules::$knightDeltas as [$df,$dr]){
	        $sf=$tf-$df;$sr=$tr-$dr;
	        if(Rules::inBounds($sf,$sr)){
	            $pc=$p->get($sf,$sr);
	            if($pc && Rules::pieceSide($pc)===$att && Rules::pieceType($pc)==='N')
	                return true;
	        }
	    }
	    // Pawns
	    $d=($att==='w')?+1:-1;
	    foreach([-1,+1]as$df){
	        $sf=$tf-$df;$sr=$tr-$d;
	        if(Rules::inBounds($sf,$sr)){
	            $pc=$p->get($sf,$sr);
	            if($pc && Rules::pieceSide($pc)===$att && Rules::pieceType($pc)==='P')
	                return true;
	        }
	    }
	    // King
	    for($df=-1;$df<=1;$df++)for($dr=-1;$dr<=1;$dr++){
	        if(!$df&&!$dr)continue;
	        $sf=$tf-$df;$sr=$tr-$dr;
	        if(Rules::inBounds($sf,$sr)){
	            $pc=$p->get($sf,$sr);
	            if($pc && Rules::pieceSide($pc)===$att && Rules::pieceType($pc)==='K')
	                return true;
	        }
	    }
	    // Sliders
	    $dirs=[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
	    foreach($dirs as [$df,$dr]){
	        $sf=$tf+$df;$sr=$tr+$dr;
	        while(Rules::inBounds($sf,$sr)){
	            $pc=$p->get($sf,$sr);
	            if($pc){
	                if(Rules::pieceSide($pc)===$att){
	                    $t=Rules::pieceType($pc);
	                    $ortho = ($df==0||$dr==0);
	                    $diag  = ($df!=0&&$dr!=0);
	                    if(($ortho && ($t==='R'||$t==='Q')) || ($diag && ($t==='B'||$t==='Q')))
	                        return true;
	                }
	                break;
	            }
	            $sf+=$df;$sr+=$dr;
	        }
	    }
	    return false;
	}

    // Game end evaluation

    private static function evaluateAndMarkGameEnd(Position $p): void {
        if($p->status!=='ongoing') return;

        $side=$p->sideToMove;
        $opp =($side==='w')?'b':'w';

        $hasMove=self::hasAnyLegalMove($p,$side);
        $inCheck=self::inCheck($p,$side);

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

        $p->status='ongoing'; $p->winner=null; $p->reason=null;
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
        $count=['w'=>['P'=>0,'N'=>0,'B'=>0,'R'=>0,'Q'=>0],'b'=>['P'=>0,'N'=>0,'B'=>0,'R'=>0,'Q'=>0]];
        for($f=0;$f<Rules::FILES;$f++){
            for($r=0;$r<Rules::RANKS;$r++){
                $pc=$p->get($f,$r); if(!$pc) continue;
                $s=$pc[0]; $t=$pc[1];
                if(isset($count[$s][$t])) $count[$s][$t]++;
            }
        }
        foreach(['w','b'] as $s){
            if($count[$s]['P']>0 || $count[$s]['R']>0 || $count[$s]['Q']>0) return false;
        }
        if(($count['w']['N']+$count['w']['B']<=1) && ($count['b']['N']+$count['b']['B']<=1)
           && $count['w']['P']==0 && $count['w']['R']==0 && $count['w']['Q']==0
           && $count['b']['P']==0 && $count['b']['R']==0 && $count['b']['Q']==0) return true;

        return false;
    }
}