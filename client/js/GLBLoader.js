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

      // Skinned/animated GLB (units) → build SkinnedMesh + Skeleton + clips.
      // Static GLBs (buildings/trees) fall through to the legacy path below.
      if (gltf.skins && gltf.skins.length) {
        return this.parseSkinned(gltf, bin);
      }

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
              // Buildings are rendered as InstancedMesh (one draw call per
              // model+team). three.js defines USE_INSTANCING and the
              // instanceMatrix attribute for instanced objects regardless of
              // material. Instance transforms are translation-only, so the
              // normal transform above stays correct (worldMatrix = identity).
              #ifdef USE_INSTANCING
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
              #else
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
              #endif
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

    // Parse a skinned + animated GLB into a Three.js skeleton, SkinnedMesh(es),
    // and AnimationClip[]. Returns a Promise resolving to:
    //   { isSkinnedResult, root, placementNode, skinnedMeshes, animations, skeleton }
    // - `root` is a Group containing the bone hierarchy + the SkinnedMeshes; add
    //   it to the scene at origin.
    // - `placementNode` is the wrapper (bone root, Z-up->Y-up + scale). Move THIS
    //   to position a unit on terrain — never the SkinnedMesh (would double-transform).
    parseSkinned (gltf, binAB) {
      const COMPONENT = {
        5120: Int8Array, 5121: Uint8Array, 5122: Int16Array,
        5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array
      };
      const TYPE_COUNT = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };

      // Accessor read → tightly-packed typed array. Handles gltf-transform's
      // interleaved vertex bufferViews (byteStride) by de-interleaving, and is
      // alignment-safe (slices copy into fresh buffers).
      const readAcc = (accIdx) => {
        const acc = gltf.accessors[accIdx];
        const bv = gltf.bufferViews[acc.bufferView];
        const TypedArray = COMPONENT[acc.componentType];
        const comps = TYPE_COUNT[acc.type];
        const elemBytes = comps * TypedArray.BYTES_PER_ELEMENT;
        const base = (bv.byteOffset || 0) + (acc.byteOffset || 0);
        const stride = bv.byteStride || elemBytes;
        if (stride === elemBytes) {
          return new TypedArray(binAB.slice(base, base + acc.count * elemBytes));
        }
        const out = new TypedArray(acc.count * comps);
        for (let e = 0; e < acc.count; e++) {
          const o = base + e * stride;
          out.set(new TypedArray(binAB.slice(o, o + elemBytes)), e * comps);
        }
        return out;
      };

      const sanitize = (s) => (s || 'node').replace(/[\s.\[\]]/g, '_');

      // --- 1. Node objects (Bone for joints, Object3D otherwise) ---
      const skin = gltf.skins[0];
      const jointSet = new Set(skin.joints);
      const nodeObjs = gltf.nodes.map((n, i) => {
        const obj = jointSet.has(i) ? new THREE.Bone() : new THREE.Object3D();
        obj.name = sanitize(n.name) + '_' + i;
        if (n.translation) obj.position.fromArray(n.translation);
        if (n.rotation) obj.quaternion.fromArray(n.rotation);
        if (n.scale) obj.scale.fromArray(n.scale);
        return obj;
      });
      gltf.nodes.forEach((n, i) => {
        if (n.children) n.children.forEach(ci => nodeObjs[i].add(nodeObjs[ci]));
      });

      // --- 2. Skeleton (bones in skin.joints order + inverse bind matrices) ---
      const bones = skin.joints.map(ji => nodeObjs[ji]);
      const ibm = readAcc(skin.inverseBindMatrices);
      const boneInverses = [];
      for (let i = 0; i < bones.length; i++) {
        boneInverses.push(new THREE.Matrix4().fromArray(ibm, i * 16));
      }
      const skeleton = new THREE.Skeleton(bones, boneInverses);

      // --- 3. Decode embedded textures (async), then build meshes/materials ---
      const loadedTextures = {};
      const imagePromises = [];
      if (gltf.images) {
        gltf.images.forEach((img, idx) => {
          if (img.bufferView === undefined) return;
          const bv = gltf.bufferViews[img.bufferView];
          const imgData = new Uint8Array(binAB, bv.byteOffset || 0, bv.byteLength);
          const blobUrl = URL.createObjectURL(new Blob([imgData], { type: img.mimeType || 'image/png' }));
          imagePromises.push(new Promise(resolve => {
            const el = new Image();
            el.onload = () => {
              const tex = new THREE.Texture(el);
              tex.colorSpace = THREE.SRGBColorSpace;
              tex.flipY = false;
              tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
              tex.needsUpdate = true;
              loadedTextures[idx] = tex;
              URL.revokeObjectURL(blobUrl);
              resolve();
            };
            el.onerror = () => { URL.revokeObjectURL(blobUrl); resolve(); };
            el.src = blobUrl;
          }));
        });
      }

      const materialFor = (matIdx) => {
        let map = null;
        if (matIdx !== undefined && gltf.materials && gltf.materials[matIdx]) {
          const pbr = gltf.materials[matIdx].pbrMetallicRoughness || {};
          if (pbr.baseColorTexture) {
            const t = gltf.textures[pbr.baseColorTexture.index];
            if (t && loadedTextures[t.source]) map = loadedTextures[t.source];
          }
        }
        return new THREE.MeshStandardMaterial({
          map, color: map ? 0xffffff : 0x999999,
          roughness: 1, metalness: 0, side: THREE.DoubleSide
        });
      };

      return Promise.all(imagePromises).then(() => {
        const root = new THREE.Group();
        root.name = 'unit-root';

        // Scene roots (wrapper holding bones + the skinned-mesh node).
        const sceneDef = gltf.scenes[gltf.scene || 0];
        let placementNode = null;
        let meshNodeIdx = -1;
        gltf.nodes.forEach((n, i) => { if (n.mesh !== undefined && n.skin !== undefined) meshNodeIdx = i; });

        // --- 4. Build SkinnedMeshes (one per primitive), bind skeleton ---
        const skinnedMeshes = [];
        const meshDef = gltf.meshes[gltf.nodes[meshNodeIdx].mesh];
        const meshHolder = nodeObjs[meshNodeIdx]; // Object3D, identity root
        for (const prim of meshDef.primitives) {
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.BufferAttribute(readAcc(prim.attributes.POSITION), 3));
          if (prim.attributes.NORMAL !== undefined) geo.setAttribute('normal', new THREE.BufferAttribute(readAcc(prim.attributes.NORMAL), 3));
          if (prim.attributes.TEXCOORD_0 !== undefined) geo.setAttribute('uv', new THREE.BufferAttribute(readAcc(prim.attributes.TEXCOORD_0), 2));
          geo.setAttribute('skinIndex', new THREE.BufferAttribute(readAcc(prim.attributes.JOINTS_0), 4));
          geo.setAttribute('skinWeight', new THREE.BufferAttribute(readAcc(prim.attributes.WEIGHTS_0), 4));
          if (prim.indices !== undefined) geo.setIndex(new THREE.BufferAttribute(readAcc(prim.indices), 1));

          const sm = new THREE.SkinnedMesh(geo, materialFor(prim.material));
          sm.frustumCulled = false; // skinned bounds drift; avoid false culling
          sm.bind(skeleton, new THREE.Matrix4()); // identity bindMatrix (mesh node is identity)
          skinnedMeshes.push(sm);
          meshHolder.add(sm);
        }

        // Assemble graph: add scene roots to `root`. Identify the wrapper.
        sceneDef.nodes.forEach(ri => {
          root.add(nodeObjs[ri]);
          if (ri !== meshNodeIdx) placementNode = nodeObjs[ri];
        });
        // The skeleton bones must live under root for world matrices to update.
        // They already do (wrapper -> bones). meshHolder is also a scene root.

        // --- 5. Animation clips ---
        const animations = [];
        if (gltf.animations) {
          for (const animDef of gltf.animations) {
            const tracks = [];
            for (const ch of animDef.channels) {
              const target = nodeObjs[ch.target.node];
              if (!target) continue;
              const samp = animDef.samplers[ch.sampler];
              const times = readAcc(samp.input);
              const values = readAcc(samp.output);
              const prop = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[ch.target.path];
              if (!prop) continue;
              const name = target.name + '.' + prop;
              const Track = ch.target.path === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
              tracks.push(new Track(name, times, values));
            }
            animations.push(new THREE.AnimationClip(animDef.name || 'clip', -1, tracks));
          }
        }

        return { isSkinnedResult: true, root, placementNode, skinnedMeshes, animations, skeleton };
      });
    }
  }

  window.GLBLoader = GLBLoader;
})();
