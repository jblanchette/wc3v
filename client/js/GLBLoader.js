/**
 * GLB (binary glTF 2.0) loader for Three.js.
 * Supports static triangle meshes with embedded textures and multi-primitive meshes.
 * Single-primitive: returns THREE.BufferGeometry (backward compatible).
 * Multi-primitive: returns THREE.Group containing THREE.Mesh children with materials.
 *
 * Usage:
 *   const loader = new GLBLoader();
 *   loader.load('/path/to/model.glb', (result) => {
 *     // result is BufferGeometry (single prim) or THREE.Group (multi prim)
 *     if (result.isGroup) scene.add(result);
 *     else scene.add(new THREE.Mesh(result, material));
 *   });
 */
(function () {
  class GLBLoader {
    load (url, onLoad, onProgress, onError) {
      fetch(url)
        .then(res => {
          if (!res.ok) throw new Error('GLB fetch failed: ' + res.status);
          return res.arrayBuffer();
        })
        .then(ab => {
          const result = this.parse(ab);
          // parse returns a Promise for multi-primitive GLBs (async image loading)
          if (result && result.then) {
            return result.then(group => { if (group && onLoad) onLoad(group); });
          }
          if (result && onLoad) onLoad(result);
        })
        .catch(err => {
          if (onError) onError(err);
        });
    }

    parse (arrayBuffer) {
      const view = new DataView(arrayBuffer);

      // GLB header: magic(4) + version(4) + length(4)
      const magic = view.getUint32(0, true);
      if (magic !== 0x46546C67) throw new Error('Not a GLB file');

      // Chunk 0: JSON
      const jsonLen = view.getUint32(12, true);
      const jsonBytes = new Uint8Array(arrayBuffer, 20, jsonLen);
      const jsonStr = new TextDecoder().decode(jsonBytes);
      const gltf = JSON.parse(jsonStr);

      // Chunk 1: BIN
      const binOffset = 20 + jsonLen;
      const binLen = view.getUint32(binOffset, true);
      const bin = arrayBuffer.slice(binOffset + 8, binOffset + 8 + binLen);

      if (!gltf.meshes || !gltf.meshes.length) return null;
      const primitives = gltf.meshes[0].primitives;
      if (!primitives || !primitives.length) return null;

      // Helper: read accessor → typed array from the binary buffer
      const readAccessor = (accIdx) => {
        const acc = gltf.accessors[accIdx];
        const bv = gltf.bufferViews[acc.bufferView];
        const offset = (bv.byteOffset || 0);
        const count = acc.count;
        const typeCount = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[acc.type];
        const totalElements = count * typeCount;
        const TypedArray = {
          5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
          5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
        }[acc.componentType];
        return { array: new TypedArray(bin, offset, totalElements), acc };
      };

      // Parse a single primitive into BufferGeometry
      const parsePrimitive = (prim) => {
        const geo = new THREE.BufferGeometry();
        if (prim.indices !== undefined) {
          const { array } = readAccessor(prim.indices);
          geo.setIndex(new THREE.BufferAttribute(array, 1));
        }
        if (prim.attributes.POSITION !== undefined) {
          const { array } = readAccessor(prim.attributes.POSITION);
          geo.setAttribute('position', new THREE.BufferAttribute(array, 3));
        }
        if (prim.attributes.NORMAL !== undefined) {
          const { array } = readAccessor(prim.attributes.NORMAL);
          geo.setAttribute('normal', new THREE.BufferAttribute(array, 3));
        }
        if (prim.attributes.TEXCOORD_0 !== undefined) {
          const { array } = readAccessor(prim.attributes.TEXCOORD_0);
          geo.setAttribute('uv', new THREE.BufferAttribute(array, 2));
        }
        return geo;
      };

      // Single primitive — return BufferGeometry (backward compatible)
      if (primitives.length === 1 && !gltf.materials) {
        return parsePrimitive(primitives[0]);
      }

      // Multi-primitive — return Group with materials and textures
      const group = new THREE.Group();

      // Load embedded images — decode each PNG blob into an Image element,
      // then create Three.js textures only after images are ready.
      const imagePromises = [];
      const loadedTextures = {};
      if (gltf.images) {
        for (let i = 0; i < gltf.images.length; i++) {
          const img = gltf.images[i];
          if (img.bufferView !== undefined) {
            const bv = gltf.bufferViews[img.bufferView];
            const imgData = new Uint8Array(bin, bv.byteOffset || 0, bv.byteLength);
            const blob = new Blob([imgData], { type: img.mimeType || 'image/png' });
            const blobUrl = URL.createObjectURL(blob);
            const idx = i;

            imagePromises.push(new Promise(resolve => {
              const imgEl = new Image();
              imgEl.onload = () => {
                const tex = new THREE.Texture(imgEl);
                tex.colorSpace = THREE.LinearSRGBColorSpace;
                tex.flipY = false;
                tex.magFilter = THREE.LinearFilter;
                tex.minFilter = THREE.LinearMipmapLinearFilter;
                tex.generateMipmaps = true;
                tex.needsUpdate = true;
                loadedTextures[idx] = tex;
                URL.revokeObjectURL(blobUrl);
                resolve();
              };
              imgEl.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(); };
              imgEl.src = blobUrl;
            }));
          }
        }
      }

      // Wait for all embedded images to decode, then build materials and group
      return Promise.all(imagePromises).then(() => {

      // WC3 half-Lambert shader material — matches HiveWE's skinned_mesh_sd rendering.
      // Uses (dot(N, -L) + 1) * 0.5 instead of standard Lambert for softer shadows.
      // HiveWE light direction (Z-up): normalize(1, 1, -3)
      // Our converter maps Z-up (x,y,z) → Y-up (x,z,-y), so (1,1,-3) → (1,-3,-1)
      const WC3_LIGHT_DIR = new THREE.Vector3(1, -3, -1).normalize();

      const makeWC3Material = (map, baseColor, doubleSided) => {
        const uniforms = {
          worldMatrix: { value: new THREE.Matrix4() },
          diffuseMap: { value: map },
          baseColor: { value: baseColor || new THREE.Color(1, 1, 1) },
          lightDir: { value: WC3_LIGHT_DIR },
          hasTexture: { value: map ? 1.0 : 0.0 },
          emissiveColor: { value: new THREE.Color(0, 0, 0) },
          emissiveIntensity: { value: 0.0 }
        };

        return new THREE.ShaderMaterial({
          uniforms,
          side: doubleSided ? THREE.DoubleSide : THREE.FrontSide,
          vertexShader: `
            uniform mat4 worldMatrix;
            varying vec2 vUV;
            varying vec3 vNormal;
            void main() {
              vUV = uv;
              // Transform normal to world space using the model's world matrix.
              // HiveWE SD shader uses model-space normals — for static buildings
              // world-space normals with world-space light is equivalent and
              // keeps lighting camera-independent.
              vNormal = normalize(mat3(worldMatrix) * normal);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `,
          fragmentShader: `
            uniform sampler2D diffuseMap;
            uniform vec3 baseColor;
            uniform vec3 lightDir;
            uniform float hasTexture;
            uniform vec3 emissiveColor;
            uniform float emissiveIntensity;
            varying vec2 vUV;
            varying vec3 vNormal;
            void main() {
              vec4 texColor = hasTexture > 0.5 ? texture2D(diffuseMap, vUV) : vec4(baseColor, 1.0);
              if (texColor.a < 0.01) discard;

              // WC3 half-Lambert: (dot(N, -L) + 1) * 0.5
              // Maps [-1,1] → [0,1], preventing harsh shadows.
              // Matches HiveWE skinned_mesh_sd.frag exactly.
              float halfLambert = (dot(normalize(vNormal), -lightDir) + 1.0) * 0.5;

              // Ambient floor so shadowed faces don't go fully dark.
              // THREE.js AmbientLight/HemisphereLight don't affect ShaderMaterial,
              // so we bake a minimum brightness here. 0.35 ambient + 0.65 directional
              // keeps the WC3 cartoony feel with readable shadow detail.
              float lighting = mix(0.5, 1.0, halfLambert);

              // Multiply in sRGB space — matches WC3 engine (no gamma correction).
              // Texture is marked LinearSRGBColorSpace so values pass through raw.
              vec3 finalColor = texColor.rgb * lighting;
              finalColor += emissiveColor * emissiveIntensity;
              gl_FragColor = vec4(finalColor, texColor.a);
            }
          `
        });
      };

      // Resolve material → WC3-style shader material
      const resolveMaterial = (matIdx) => {
        if (matIdx === undefined || !gltf.materials || !gltf.materials[matIdx]) {
          return makeWC3Material(null, new THREE.Color(0.55, 0.55, 0.55), true);
        }
        const gMat = gltf.materials[matIdx];
        const pbr = gMat.pbrMetallicRoughness || {};
        const doubleSided = !!gMat.doubleSided;

        let map = null;
        if (pbr.baseColorTexture) {
          const texInfo = gltf.textures[pbr.baseColorTexture.index];
          if (texInfo && loadedTextures[texInfo.source] !== undefined) {
            map = loadedTextures[texInfo.source];
          }
        }

        let baseColor = new THREE.Color(1, 1, 1);
        if (pbr.baseColorFactor && !map) {
          const f = pbr.baseColorFactor;
          baseColor = new THREE.Color(f[0], f[1], f[2]);
        }

        return makeWC3Material(map, baseColor, doubleSided);
      };

      for (const prim of primitives) {
        const geo = parsePrimitive(prim);
        const mat = resolveMaterial(prim.material);
        const mesh = new THREE.Mesh(geo, mat);
        // Sync the worldMatrix uniform before each render so normals
        // are correctly transformed to world space for lighting.
        mesh.onBeforeRender = () => {
          if (mesh.material.uniforms && mesh.material.uniforms.worldMatrix) {
            mesh.material.uniforms.worldMatrix.value.copy(mesh.matrixWorld);
          }
        };
        group.add(mesh);
      }

      return group;
      }); // end Promise.all(imagePromises)
    }
  }

  window.GLBLoader = GLBLoader;
})();
