<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Chess is a Joke</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <link rel="stylesheet" href="../css/style.css">
	<link rel="icon" type="image/png" href="/favicon.png">
  </head>
  <body>
    <div id="stage">
			<div id="black-top-clock"></div>
			<div class="board-wrap">
      	<canvas id="board"></canvas>
      </div>
			<div id="clock">
			  <span class="clock-item">
			    <span class="label">WHITE</span>
			    <span class="time" id="whiteTime">10:00</span>
			  </span>
			  <span class="clock-item" id="blackBottom">
			    <span class="label">BLACK</span>
			    <span class="time" id="blackTime">10:00</span>
			  </span>
			</div>
			<div id="menu">
				<div class="actions">
				  <button onclick="newGame()">New Game</button>
				</div>
			</div>
		
    </div>
    <script type="importmap">
    {
      "imports": {
        "three": "/js/vendor/three/three.module.js",
        "three/addons/": "/js/vendor/three/addons/"
      }
    }
    </script>
    <script type="module" src="../js/client.js?v=1.31.0"></script>
  </body>
</html>
