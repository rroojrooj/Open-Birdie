// Post-processing for GolfScene — bloom + SMAA over the base render.
// Stock three.js passes only (see docs/visual-upgrade-plan.md, Step 1):
//   RenderPass -> UnrealBloomPass -> OutputPass (tone map + sRGB) -> SMAAPass.
// SAO/SSAO are intentionally omitted: the terrain is a flat height grid with
// nothing to self-occlude, and SAO haloes over the 12000m far plane.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';

export class PostFX {
  constructor(renderer, scene, camera) {
    this.renderer = renderer;
    const size = renderer.getSize(new THREE.Vector2());

    // EffectComposer reads renderer.getPixelRatio() and uses HalfFloat targets,
    // so the scene stays HDR/linear until OutputPass tone-maps it.
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));

    // Bloom kept deliberately minimal: the Preetham sky is broadly bright, so
    // anything stronger blooms the whole sky into a haze (verified on-screen).
    // This is just a faint highlight lift on the sun/water; (strength, radius,
    // threshold).
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.05, 0.3, 1.0);
    this.composer.addPass(this.bloom);

    // OutputPass applies renderer.toneMapping + toneMappingExposure and converts
    // to the renderer's output color space (composer render targets are linear).
    this.composer.addPass(new OutputPass());

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
