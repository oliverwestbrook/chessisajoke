# Vendored libraries

Pinned, locally-hosted dependencies (no build step, no CDN runtime dependency).

## three.js — r160 (0.160.0)

Downloaded from unpkg:

- `three/three.module.js`
  - https://unpkg.com/three@0.160.0/build/three.module.js
- `three/addons/controls/OrbitControls.js`
  - https://unpkg.com/three@0.160.0/examples/jsm/controls/OrbitControls.js
- `three/addons/loaders/GLTFLoader.js`  *(present for the future GLTF piece-model seam; not imported yet)*
  - https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js
- `three/addons/utils/BufferGeometryUtils.js`  *(dependency of GLTFLoader)*
  - https://unpkg.com/three@0.160.0/examples/jsm/utils/BufferGeometryUtils.js

Resolved at runtime via the `<script type="importmap">` in `/play/index.php`:

```json
{
  "imports": {
    "three": "/js/vendor/three/three.module.js",
    "three/addons/": "/js/vendor/three/addons/"
  }
}
```

To upgrade: bump the version in all four URLs above, re-download into the same paths,
and re-test `/play/`.
