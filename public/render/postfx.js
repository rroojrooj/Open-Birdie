// Post-processing for GolfScene — bloom + SMAA over the base render.
// Stock three.js passes only (see docs/visual-upgrade-plan.md, Step 1):
//   RenderPass -> UnrealBloomPass -> OutputPass (tone map + sRGB) -> SMAAPass.
// SAO/SSAO are intentionally omitted: the terrain is a flat height grid with
// nothing to self-occlude, and SAO haloes over the 12000m far plane.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { RENDER_CONFIG } from './config.js';

// Cinematic grade in display space (after tone-map/sRGB): gentle contrast +
// saturation, a warm-highlight / cool-shadow split-tone, and a soft vignette.
const GRADE_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uContrast: { value: 1.08 },
    uSaturation: { value: 1.12 },
    uVignette: { value: 0.32 },
  },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float uContrast, uSaturation, uVignette; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = (c.rgb - 0.5) * uContrast + 0.5;            // contrast
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, uSaturation);                 // saturation
      col += vec3(0.006, 0.004, -0.012) * (1.0 - l);        // warm, desaturated shadows (turf greens, not blue)
      col += vec3(0.028, 0.018, -0.012) * l;                // warm highlights
      float v = smoothstep(0.85, 0.42, length(vUv - 0.5));  // vignette
      col *= mix(1.0, v, uVignette);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }`,
};

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());

    // EffectComposer reads renderer.getPixelRatio() and uses HalfFloat targets,
    // so the scene stays HDR/linear until OutputPass tone-maps it.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // GTAO for contact grounding (tree bases, terrain folds, bunker lips). Small
    // WORLD-space radius + steep falloff so it darkens only nearby contacts and
    // never haloes over the 12000m far plane (the reason plain SAO was omitted).
    if (RENDER_CONFIG.gtao) {
      const gtao = new GTAOPass(scene, camera, size.x, size.y);
      gtao.output = GTAOPass.OUTPUT.Default;
      gtao.updateGtaoMaterial({
        radius: 1.6, distanceExponent: 2.0, thickness: 1.0,
        scale: 1.4, samples: 16, distanceFallOff: 1.0, screenSpaceRadius: false,
      });
      gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 4, radiusExponent: 1, rings: 2, samples: 16 });
      this.composer.addPass(gtao);
    }

    // Bloom kept deliberately minimal: the Preetham sky is broadly bright, so
    // anything stronger blooms the whole sky into a haze (verified on-screen).
    // This is just a faint highlight lift on the sun/water; (strength, radius,
    // threshold).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.05, 0.3, 1.0);
    this.composer.addPass(this.bloom);

    // OutputPass applies renderer.toneMapping + toneMappingExposure and converts
    // to the renderer's output color space (composer render targets are linear).
    this.composer.addPass(new OutputPass());

    // Cinematic grade — after tone-map/sRGB (display space), before SMAA.
    if (RENDER_CONFIG.colorGrade) this.composer.addPass(new ShaderPass(GRADE_SHADER));

    // Composer render targets carry no MSAA; SMAA antialiases the final image.
    // (The last pass renders to the default framebuffer, so preserveDrawingBuffer
    // still captures the composited frame for the screenshot/recording path.)
    this.composer.addPass(new SMAAPass());
  }

  setSize(w, h) {
    // Track the renderer's current pixel ratio, then size the composer; it
    // multiplies by pixelRatio internally and propagates to every pass.
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render() {
    this.composer.render();
  }
}
