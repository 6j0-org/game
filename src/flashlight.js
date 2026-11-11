// Flashlights: the game draws everything unlit (MeshBasicMaterial), so this adds a small shader hook
// that brightens surfaces inside up to FLASH_MAX light cones. Shared uniforms; set them every frame.

import * as THREE from 'three';

export const FLASH_MAX = 4;
export const LAMP_MAX = 8; // the nearest lava lamps light the world
const LAMP_RANGE = 7;
const RANGE_FULL = 4; // full brightness up to here (blocks)
const RANGE_END = 24; // fades out by here

export const flashUniforms = {
  uFlashCount: { value: 0 },
  uFlashPos: { value: Array.from({ length: FLASH_MAX }, () => new THREE.Vector3()) },
  uFlashDir: { value: Array.from({ length: FLASH_MAX }, () => new THREE.Vector3(0, 0, -1)) },
  uFlashStrength: { value: 0 },
  uLampCount: { value: 0 },
  uLampPos: { value: Array.from({ length: LAMP_MAX }, () => new THREE.Vector3()) },
  uLampColor: { value: Array.from({ length: LAMP_MAX }, () => new THREE.Vector3(1, 0.55, 0.5)) },
  uLampStrength: { value: 0 },
};

/** Patches a MeshBasicMaterial so flashlights light it. Returns the material. */
export function withFlashlight(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, flashUniforms);
    shader.vertexShader = `varying vec3 vFlashWorld;\n${shader.vertexShader}`.replace(
      '#include <fog_vertex>',
      '#include <fog_vertex>\n  vFlashWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
    );
    shader.fragmentShader = `
uniform int uFlashCount;
uniform vec3 uFlashPos[${FLASH_MAX}];
uniform vec3 uFlashDir[${FLASH_MAX}];
uniform float uFlashStrength;
uniform int uLampCount;
uniform vec3 uLampPos[${LAMP_MAX}];
uniform vec3 uLampColor[${LAMP_MAX}];
uniform float uLampStrength;
varying vec3 vFlashWorld;
${shader.fragmentShader}`.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
  float flash = 0.0;
  for (int i = 0; i < ${FLASH_MAX}; i++) {
    if (i >= uFlashCount) break;
    vec3 toPoint = vFlashWorld - uFlashPos[i];
    float dist = length(toPoint);
    float cone = smoothstep(0.80, 0.94, dot(toPoint / max(dist, 0.001), uFlashDir[i]));
    flash += cone * (1.0 - smoothstep(${RANGE_FULL.toFixed(1)}, ${RANGE_END.toFixed(1)}, dist));
  }
  // Lava lamps: a warm pink-orange glow that falls off with distance (no shadows: it's a lamp, not a sun).
  vec3 lamp = vec3(0.0);
  for (int i = 0; i < ${LAMP_MAX}; i++) {
    if (i >= uLampCount) break;
    float d = length(vFlashWorld - uLampPos[i]);
    float f = 1.0 - smoothstep(0.3, ${LAMP_RANGE.toFixed(1)}, d);
    lamp += f * f * f * uLampColor[i];
  }
  vec3 lampLight = uLampStrength * min(lamp, vec3(1.2));
  // diffuse is the daylight level; light = daylight + flashlight + lamps.
  diffuseColor.rgb *= vec3(1.0 + uFlashStrength * min(flash, 1.5) / max(diffuse.r, 0.02)) + lampLight / max(diffuse.r, 0.02);`,
    );
  };
  material.customProgramCacheKey = () => 'flashlight';
  return material;
}

/**
 * Sets this frame's lights: `sources` is [{ pos, dir }], nearest first is best; extras are dropped.
 * `daylightMul` is the material daylight multiplier: flashlights fade out as the day gets bright.
 */
export function setFlashlights(sources, daylightMul) {
  const n = Math.min(sources.length, FLASH_MAX);
  flashUniforms.uFlashCount.value = n;
  for (let i = 0; i < n; i++) {
    flashUniforms.uFlashPos.value[i].copy(sources[i].pos);
    flashUniforms.uFlashDir.value[i].copy(sources[i].dir).normalize();
  }
  flashUniforms.uFlashStrength.value = Math.max(0, 0.85 - daylightMul) * 0.9;
}

/** This frame's lights (lava lamps, fluorescent panels): [{ pos, color? }], nearest first. They matter less by day. */
export const LAVA_LAMP_COLOR = new THREE.Vector3(1, 0.55, 0.5);
export function setLamps(sources, daylightMul) {
  const n = Math.min(sources.length, LAMP_MAX);
  flashUniforms.uLampCount.value = n;
  for (let i = 0; i < n; i++) {
    flashUniforms.uLampPos.value[i].copy(sources[i].pos);
    flashUniforms.uLampColor.value[i].copy(sources[i].color || LAVA_LAMP_COLOR);
  }
  flashUniforms.uLampStrength.value = Math.max(0.05, 0.8 - daylightMul) * 0.6;
}
