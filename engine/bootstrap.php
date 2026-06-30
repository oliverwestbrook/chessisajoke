<?php
// Bootstrap with variant-awareness

// detect engine mode early
$GLOBALS['ENGINE_MODE'] = 'joke'; // default

// 1) Explicit mode on request
$reqMode = strtolower((string)($_POST['mode'] ?? $_GET['mode'] ?? ''));
if ($reqMode === 'classic' || $reqMode === 'joke') {
    $GLOBALS['ENGINE_MODE'] = $reqMode;
} else {
    // 2) Infer from saved game JSON if a game id is provided
    $gameId = (string)($_POST['game'] ?? $_GET['game'] ?? '');
    if ($gameId && preg_match('/^[0-9]{10,16}-[0-9a-z]{6}$/', $gameId)) {
        $statePath = __DIR__ . "/storage/state_{$gameId}.json";
        if (is_file($statePath)) {
            $raw = @file_get_contents($statePath);
            $arr = is_string($raw) ? json_decode($raw, true) : null;
            $mode = is_array($arr) ? strtolower((string)($arr['mode'] ?? '')) : '';
            if ($mode === 'classic' || $mode === 'joke') {
                $GLOBALS['ENGINE_MODE'] = $mode;
            }
        }
    }
}

// autoload with variant mapping
spl_autoload_register(function($c){
  $dir = __DIR__;

  // Route variant-sensitive classes
  if ($c === 'Rules') {
    $p = ($GLOBALS['ENGINE_MODE'] === 'classic') ? "$dir/RulesClassic.php" : "$dir/Rules.php";
    if (file_exists($p)) { require_once $p; return; }
  }
  if ($c === 'Engine') {
    $p = ($GLOBALS['ENGINE_MODE'] === 'classic') ? "$dir/EngineClassic.php" : "$dir/Engine.php";
    if (file_exists($p)) { require_once $p; return; }
  }

  // default class map
  $p = $dir . '/' . $c . '.php';
  if (file_exists($p)) { require_once $p; }
});

// helpers
function jsend(bool $ok,array $data=[],string $msg=''): void {
  header('Content-Type: application/json');
  echo json_encode(['status'=>$ok?'success':'error','data'=>$data,'message'=>$msg],
    JSON_UNESCAPED_UNICODE|JSON_UNESCAPED_SLASHES);
  exit;
}

set_error_handler(function($n,$s,$f,$l){
  error_log("PHP[$n] $s @ $f:$l");
  if(ini_get('display_errors')) echo "<pre>PHP[$n] $s @ $f:$l</pre>";
});
set_exception_handler(function($e){
  $m="Uncaught: ".$e->getMessage();
  error_log($m);
  if(ini_get('display_errors')) echo "<pre>$m</pre>";
});

date_default_timezone_set('UTC');
