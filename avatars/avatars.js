import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {VRMSpringBoneImporter} from '@pixiv/three-vrm/lib/three-vrm.module.js';
import {fixSkeletonZForward} from './vrarmik/SkeletonUtils.js';
import PoseManager from './vrarmik/PoseManager.js';
import ShoulderTransforms from './vrarmik/ShoulderTransforms.js';
import LegsManager from './vrarmik/LegsManager.js';
import {world} from '../world.js';
import {Text} from 'troika-three-text';
import MicrophoneWorker from './microphone-worker.js';
import {AudioRecognizer} from '../audio-recognizer.js';
// import skeletonString from './skeleton.js';
import {angleDifference, getVelocityDampingFactor} from '../util.js';
// import physicsManager from '../physics-manager.js';
import easing from '../easing.js';
import CBOR from '../cbor.js';
import Simplex from '../simplex-noise.js';
import {crouchMaxTime, useMaxTime, aimMaxTime, avatarInterpolationFrameRate, avatarInterpolationTimeDelay, avatarInterpolationNumFrames} from '../constants.js';
import {FixedTimeStep} from '../interpolants.js';
import metaversefile from 'metaversefile';
import {
  getSkinnedMeshes,
  getSkeleton,
  getEyePosition,
  getHeight,
  makeBoneMap,
  getTailBones,
  getModelBones,
  // cloneModelBones,
  decorateAnimation,
  // retargetAnimation,
  animationBoneToModelBone,
} from './util.mjs';
import {scene, getRenderer} from '../renderer.js';

const bgVertexShader = `\
  varying vec2 tex_coords;

  void main() {
    tex_coords = uv;
    gl_Position = vec4(position.xy, 1., 1.);
  }
`;
const bgFragmentShader = `\
  varying vec4 v_colour;
  varying vec2 tex_coords;

  uniform sampler2D t0;
  uniform float outline_thickness;
  uniform vec3 outline_colour;
  uniform float outline_threshold;

  #define pixel gl_FragColor
  #define PI 3.1415926535897932384626433832795

  void main() {
    /* float sum = 0.0;
    int passes = 64;
    float passesFloat = float(passes);
    float step = outline_thickness / passesFloat;
    // top
    for (int i = 0; i < passes; ++i) {
      float n = float(i);
      vec2 uv = tex_coords + vec2(-outline_thickness*0.5 + step * n, outline_thickness);
      sum += texture(t0, uv).a;
    }
    // bottom
    for (int i = 0; i < passes; ++i) {
      float n = float(i);
      vec2 uv = tex_coords + vec2(-outline_thickness*0.5 + step * n, -outline_thickness);
      sum += texture(t0, uv).a;
    }
    // left
    for (int i = 0; i < passes; ++i) {
      float n = float(i);
      vec2 uv = tex_coords + vec2(-outline_thickness, -outline_thickness*0.5 + step * n);
      sum += texture(t0, uv).a;
    }
    // right
    for (int i = 0; i < passes; ++i) {
      float n = float(i);
      vec2 uv = tex_coords + vec2(outline_thickness, -outline_thickness*0.5 + step * n);
      sum += texture(t0, uv).a;
    } */

    float sum = 0.0;
    int passes = 32;
    float passesFloat = float(passes);
    float angleStep = 2.0 * PI / passesFloat;
    for (int i = 0; i < passes; ++i) {
        float n = float(i);
        float angle = angleStep * n;

        vec2 uv = tex_coords + vec2(cos(angle), sin(angle)) * outline_thickness;
        sum += texture(t0, uv).a; // / passesFloat;
    }

    if (sum > 0.) {
      pixel = vec4(outline_colour, 1);
    } else {
      discard;
      // pixel = texture(t0, tex_coords);
    }
  }

  /* void main() {
    gl_FragColor = vec4(vUv, 0., 1.);
  } */
`;
const emoteFragmentShader = `\
  uniform float iTime;
  uniform int iFrame;
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  varying vec2 tex_coords;

  // Quick and dirty line experiment to generate electric bolts :)

  // http://extremelearning.com.au/unreasonable-effectiveness-of-quasirandom-sequences/
  float R1seq(int n)
  {
    return fract(float(n) * 0.618033988749894848204586834365641218413556121186522017520);
  }

  vec2 R2seq(int n)
  {
    return fract(vec2(n) * vec2(0.754877666246692760049508896358532874940835564978799543103, 0.569840290998053265911399958119574964216147658520394151385));
  }

  // modified iq's segment: https://www.shadertoy.com/view/ldj3Wh
  vec2 Line(vec2 a, vec2 b, vec2 p, vec2 identity, float sa, float sb)
  {
      vec2 pa = p - a;
      vec2 pb = p - b;
      vec2 ba = b - a;
      float t = clamp(dot(pa,ba)/dot(ba,ba), 0.0, 1.0);    
      vec2 pp = a + ba * t;
      vec2 y = vec2(-identity.y, identity.x);
      float cutoff = max(dot(pb, identity), dot(pa, -identity));
      float s = mix(sa, sb, t);
      return vec2(max(cutoff - .005, abs(dot(y, p - pp)) - s), t);
  }

  float Rythm(float x)
  {
    x = x * 6.28318 * 10.0 / 60.0;
    x = smoothstep(-1.0, 1.0, sin(x));
    x = smoothstep(0.0, 1.0, x);
    x = smoothstep(0.0, 1.0, x);
    x = smoothstep(0.0, 1.0, x);
    x = smoothstep(0.0, 1.0, x);
    return x;
  }

  vec3 Background(vec2 uv, vec2 baseDir, float time)
  {
      uv = uv * vec2(.75, .75);
      vec3 result = vec3(0.91, 0.56, 0.02);
      
      vec2 n = vec2(-baseDir.y, baseDir.x);
      
      result = mix(result, vec3(1.0) - result, Rythm(time));
      
      float lines = texture(iChannel0, vec2(uv.x * 0.1, uv.y * 2.) + vec2(time * 1.35, 0.0)).r;
      result += lines * lines * .75 + lines * lines * lines * .35;    
      // result *= smoothstep(.5, .0, abs(dot(uv, n)));
      
      return result;
  }

  vec3 Magic(float leadTime, vec3 baseColor, vec2 uv, vec2 baseDir, float time, float spread, float freq, float intensity)
  {
      int frame = iFrame / 12;
      
      float speed = -1.5 - ((Rythm(time)) * .5 + .5) * 2.0;
      //speed *= .2;
      vec2 dir = normalize(baseDir);
      
      
      uv -= dir * mix(.1, .3, Rythm(time));
      
      vec2 normal = vec2(-dir.y, dir.x);
      
      vec2 baseOffset = dir * speed * floor(float(iFrame) / 24.0);
      
      vec2 p = uv;
      p.y -= 0.4;
      p += dir * speed * (float(iFrame) / 24.0);
      p -= R2seq(int(floor(float(iFrame)/3.0))) * .05;
      p += normal * sin(time * 12.0) * .05;
              
      float ray = 0.0;
      float glow = 0.0;
      
      p += (texture(iChannel1, p * .015 + leadTime * .25).xy * 2.0 - 1.0) * .1;
      
      float leadIntro = mix(.3, .015, smoothstep(10.0, 14.0, time));
      
      float leadingTime = 1.0 - smoothstep(leadTime - .5, leadTime, time);
      float distanceToLead = dot(uv - .5, dir) - leadingTime * 2.0 - leadIntro;
      float leadingMask = smoothstep(-.85, -.0, distanceToLead);
      
      p += leadingMask * (texture(iChannel1, vec2(time * .01 + leadTime * .35)).xy * 2.0 - 1.0) * .35;
      
      float sizeIntro = smoothstep(13.85, 14.15, time);
      spread *= leadingMask * (1.0 - Rythm(time) * .75) * sizeIntro;
      
      for(int i = -12; i < 10; i++)
      {
      float offsetA = R1seq(i+frame) * 2.0 - 1.0;
          float offsetB = R1seq(i+frame+1) * 2.0 - 1.0;
          
          vec2 a = baseOffset + dir * float(i) * freq + normal * offsetA * spread;
          vec2 b = baseOffset + dir * float(i+1) * freq + normal * offsetB * spread;
          
          float sa = mix(.05, 3.0 * intensity, R1seq(frame*7+i-1)) * .005;
          float sb = mix(.05, 3.0 * intensity, R1seq(frame*7+i)) * .005;
          
          vec2 l = Line(a, b, p, dir, sa, sb);
          float d = .025 * leadingMask;
      
          ray += smoothstep(d, d * .75 - .0001, l.x);
          glow += .5 * leadingMask * smoothstep(d * 20.0, d, l.x);
      }

      ray = clamp(ray, 0.0, 1.0);
      return baseColor * (1.0 + glow * (Rythm(time * 16.0) * .05 + .025)) + vec3(ray) * intensity;
  }

  void mainImage( out vec4 fragColor, in vec2 fragCoord )
  {
      float time = -.25 + floor(iTime * 1.1 * 24.0) / 24.0;
      float intro = 1.; // smoothstep(12.85, 13.15, time);
      // vec2 uv = fragCoord/iResolution.xy;
      vec2 uv = fragCoord;
      
      uv.y -= .075;
      uv.x -= sin(time*4.0) * .2;
      
      vec2 baseDir = normalize(vec2(1., 0.));
      
      vec3 col = Background(uv, baseDir, time) * intro;
      
      float spread = .35 + (sin(time * 10.0) * .5 + .5);
      float freq = .6 - (sin(time * 4.0) * .5 + .5) * .2;
      
      
      float offset = 1.0 - (smoothstep(5.0, 7.0, time) * smoothstep( 14.0, 13.0, time));
      
      spread *= offset;
      
      col = Magic(.5, col, uv + vec2(.4, .1) * offset, baseDir, time, .2, .35, 1.0);
      col = Magic(3.0, col, uv + vec2(.2, .0) * offset, baseDir, time, .05, .15, .55);
      col = Magic(8.0, col, uv + vec2(.2, -.25) * offset, baseDir, time, .05, .15, .35);
      col = Magic(10.0, col, uv + vec2(-.15, -.35) * offset, baseDir, time, .04, .05, .75);
      col = Magic(11.0, col, uv + vec2(-.3, -.15) * offset, baseDir, time, .04, .05, .75);
      col = Magic(12.0, col, uv, baseDir, time, spread * .75, freq, 1.0);

      fragColor = vec4(col,1.0);
  }

  void main() {
    mainImage(gl_FragColor, tex_coords);
  }
`;
const emoteFragmentShader2 = `\
  uniform float iTime;
  uniform int iFrame;
  uniform sampler2D iChannel0;
  uniform sampler2D iChannel1;
  varying vec2 tex_coords;

  const float fps = 30.;
  const float intensityFactor = 0.5; // .8;
  const float minRadius = 0.2; // 0.1;
  const float maxRadius = 0.65;

  float hash( vec2 p ) {return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);} //Pseudo-random
  float smoothNoise( in vec2 p) { //Bilinearly interpolated noise (4 samples)
      vec2 i = floor( p ); vec2 f = fract( p );	
    vec2 u = f*f*(3.0-2.0*f);
      float a = hash( i + vec2(0.0,0.0) );
    float b = hash( i + vec2(1.0,0.0) );
    float c = hash( i + vec2(0.0,1.0) );
    float d = hash( i + vec2(1.0,1.0) );
      return float(a+(b-a)*u.x+(c-a)*u.y+(a-b-c+d)*u.x*u.y)/4.;
  }
  //Funciton to make the noise continuous while wrapping around angle 
  float rotatedMirror(float t, float r){
      //t : 0->1
      t = fract(t+r);
      return 2.*abs(t-0.5);
  }
  //Some continous radial perlin noise
  const mat2 m2 = mat2(0.90,0.44,-0.44,0.90);
  float radialPerlinNoise(float t, float d){
      const float BUMP_MAP_UV_SCALE = 44.2;
      d = pow(d,0.01); //Impression of speed : stretch noise as the distance increases.
      float dOffset = -floor(iTime*fps)/fps; //Time drift (animation)
      vec2 p = vec2(rotatedMirror(t,0.1),d+dOffset);
      float f1 = smoothNoise(p*BUMP_MAP_UV_SCALE);
      p = 2.1*vec2(rotatedMirror(t,0.4),d+dOffset);
      float f2 = smoothNoise(p*BUMP_MAP_UV_SCALE);
      p = 3.7*vec2(rotatedMirror(t,0.8),d+dOffset);
      float f3 = smoothNoise(p*BUMP_MAP_UV_SCALE);
      p = 5.8*vec2(rotatedMirror(t,0.0),d+dOffset);
      float f4 = smoothNoise(p*BUMP_MAP_UV_SCALE);
      return (f1+0.5*f2+0.25*f3+0.125*f4)*3.;
  }
  //Colorize function (transforms BW Intensity to color)
  vec3 colorize(float f){
      f = clamp(f*.95,0.0,1.0);
      vec3 c = mix(vec3(0,0,1.1), vec3(0,1,1), f); //Red-Yellow Gradient
          c = mix(c, vec3(1,1,1), f*4.-3.0);      //While highlights
      vec3 cAttenuated = mix(vec3(0), c, f+0.1);       //Intensity ramp
      return cAttenuated;
  }
  /*vec3 colorize(float f){
      f = clamp(f,0.0,1.0);
      vec3 c = mix(vec3(1.1,0,0), vec3(1,1,0), f); //Red-Yellow Gradient
          c = mix(c, vec3(1,1,1), f*10.-9.);      //While highlights
      vec3 cAttenuated = mix(vec3(0), c, f);       //Intensity ramp
      return cAttenuated;
  }*/
  //Main image.
  void mainImage( out vec4 fragColor, in vec2 fragCoord ){
      // vec2 uv = 2.2*(fragCoord-0.5*vec2(iResolution.xy))/iResolution.xx;
      vec2 uv = 2.2 * ((fragCoord + vec2(0., 0.)) - 0.5);
      float d = dot(uv,uv); //Squared distance
      float t = 0.5+atan(uv.y,uv.x)/6.28; //Normalized Angle
      float v = radialPerlinNoise(t,d);
      //Saturate and offset values
      v = -2.5+v*4.5;
      //Intersity ramp from center
      v = mix(0.,v,intensityFactor*smoothstep(minRadius, maxRadius,d));
      //Colorize (palette remap )
      fragColor.rgb = colorize(v);
      fragColor.a = v;
  }

  void main() {
    mainImage(gl_FragColor, tex_coords);
  }
`;
const labelVertexShader = `\
  uniform float iTime;
  attribute vec3 color;
  varying vec2 tex_coords;
  varying vec3 vColor;

  void main() {
    tex_coords = uv;
    vColor = color;
    gl_Position = vec4(position.xy + vec2(mod(iTime, 1.), 0.), -1., 1.);
  }
`;
const labelFragmentShader = `\
  varying vec2 tex_coords;
  varying vec3 vColor;

  vec2 rotateCCW(vec2 pos, float angle) { 
    float ca = cos(angle),  sa = sin(angle);
    return pos * mat2(ca, sa, -sa, ca);  
  }

  vec2 rotateCCW(vec2 pos, vec2 around, float angle) { 
    pos -= around;
    pos = rotateCCW(pos, angle);
    pos += around;
    return pos;
  }

  // return 1 if v inside the box, return 0 otherwise
  bool insideAABB(vec2 v, vec2 bottomLeft, vec2 topRight) {
      vec2 s = step(bottomLeft, v) - step(topRight, v);
      return s.x * s.y > 0.;   
  }

  bool isPointInTriangle(vec2 point, vec2 a, vec2 b, vec2 c) {
    vec2 v0 = c - a;
    vec2 v1 = b - a;
    vec2 v2 = point - a;

    float dot00 = dot(v0, v0);
    float dot01 = dot(v0, v1);
    float dot02 = dot(v0, v2);
    float dot11 = dot(v1, v1);
    float dot12 = dot(v1, v2);

    float invDenom = 1. / (dot00 * dot11 - dot01 * dot01);
    float u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    float v = (dot00 * dot12 - dot01 * dot02) * invDenom;

    return (u >= 0.) && (v >= 0.) && (u + v < 1.);
  }

  void main() {
    vec3 c;
    if (vColor.r > 0.) {
      /* if (tex_coords.x <= 0.025 || tex_coords.x >= 0.975 || tex_coords.y <= 0.05 || tex_coords.y >= 0.95) {
        c = vec3(0.2);
      } else { */
        c = vec3(0.1 + tex_coords.y * 0.1);
      // }
    } else {
      c = vec3(0.);
    }
    gl_FragColor = vec4(c, 1.0);
  }
`;
const textVertexShader = `\
  uniform float uTroikaOutlineOpacity;
  // attribute vec3 color;
  attribute vec3 offset;
  attribute float scale;
  varying vec2 tex_coords;
  // varying vec3 vColor;

  void main() {
    tex_coords = uv;
    // vColor = color;
    gl_Position = vec4(offset.xy + position.xy * scale + vec2(mod(uTroikaOutlineOpacity, 1.), 0.), -1., 1.);
  }
`;
const textFragmentShader = `\
  void main() {
    gl_FragColor = vec4(vec3(1.), 1.);
  }
`;
async function makeTextMesh(
  text = '',
  material = null,
  font = '/fonts/Bangers-Regular.ttf',
  fontSize = 1,
  letterSpacing = 0,
  anchorX = 'left',
  anchorY = 'middle',
  color = 0x000000,
) {
  const textMesh = new Text();
  textMesh.text = text;
  if (material !== null) {
    textMesh.material = material;
  }
  textMesh.font = font;
  textMesh.fontSize = fontSize;
  textMesh.letterSpacing = letterSpacing;
  textMesh.color = color;
  textMesh.anchorX = anchorX;
  textMesh.anchorY = anchorY;
  textMesh.frustumCulled = false;
  await new Promise(accept => {
    textMesh.sync(accept);
  });
  return textMesh;
}
const bgMesh1 = (() => {
  const textureLoader = new THREE.TextureLoader();
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        iTime: {
          value: 0,
          needsUpdate: false,
        },
        iFrame: {
          value: 0,
          needsUpdate: false,
        },
        iChannel0: {
          value: textureLoader.load('/textures/pebbles.png'),
          // needsUpdate: true,
        },
        iChannel1: {
          value: textureLoader.load('/textures/noise.png'),
          // needsUpdate: true,
        },
      },
      vertexShader: bgVertexShader,
      fragmentShader: emoteFragmentShader,
      depthWrite: false,
      depthTest: false,
    })
  );
  /* quad.material.onBeforeCompile = shader => {
    console.log('got full screen shader', shader);
  }; */
  quad.material.uniforms.iChannel0.value.wrapS = THREE.RepeatWrapping;
  quad.material.uniforms.iChannel0.value.wrapT = THREE.RepeatWrapping;
  quad.material.uniforms.iChannel1.value.wrapS = THREE.RepeatWrapping;
  quad.material.uniforms.iChannel1.value.wrapT = THREE.RepeatWrapping;
  quad.frustumCulled = false;
  return quad;
})();
const bgMesh2 = (() => {
  // const textureLoader = new THREE.TextureLoader();
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        iTime: {
          value: 0,
          needsUpdate: false,
        },
        iFrame: {
          value: 0,
          needsUpdate: false,
        },
        /* iChannel0: {
          value: textureLoader.load('/textures/pebbles.png'),
          // needsUpdate: true,
        },
        iChannel1: {
          value: textureLoader.load('/textures/noise.png'),
          // needsUpdate: true,
        }, */
      },
      vertexShader: bgVertexShader,
      fragmentShader: emoteFragmentShader2,
      depthWrite: false,
      depthTest: false,
      alphaToCoverage: true,
    })
  );
  /* quad.material.onBeforeCompile = shader => {
    console.log('got full screen shader', shader);
  }; */
  /* quad.material.uniforms.iChannel0.value.wrapS = THREE.RepeatWrapping;
  quad.material.uniforms.iChannel0.value.wrapT = THREE.RepeatWrapping;
  quad.material.uniforms.iChannel1.value.wrapS = THREE.RepeatWrapping;
  quad.material.uniforms.iChannel1.value.wrapT = THREE.RepeatWrapping; */
  quad.frustumCulled = false;
  return quad;
})();
const bgMesh3 = (() => {
  const quad = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.ShaderMaterial({
      uniforms: {
        t0: {
          value: null,
          needsUpdate: false,
        },
        outline_thickness: {
          value: 0.02,
          needsUpdate: true,
        },
        outline_colour: {
          value: new THREE.Color(0, 0, 1),
          needsUpdate: true,
        },
        outline_threshold: {
          value: .5,
          needsUpdate: true,
        },
      },
      vertexShader: bgVertexShader,
      fragmentShader: bgFragmentShader,
      depthWrite: false,
      depthTest: false,
      alphaToCoverage: true,
    })
  );
  /* quad.material.onBeforeCompile = shader => {
    console.log('got full screen shader', shader);
  }; */
  quad.frustumCulled = false;
  return quad;
})();
const s1 = 0.4;
const sk1 = 0.2;
const aspectRatio1 = 0.3;
const p1 = new THREE.Vector3(0.45, -0.65, 0);
const s2 = 0.5;
const sk2 = 0.1;
const aspectRatio2 = 0.15;
const p2 = new THREE.Vector3(0.3, -0.8, 0);
const bgMesh4 = (() => {
  const planeGeometry = new THREE.PlaneGeometry(2, 2);
  const _colorGeometry = (g, color) => {
    const colors = new Float32Array(g.attributes.position.count * 3);
    for (let i = 0; i < colors.length; i += 3) {
      color.toArray(colors, i);
    }
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  };
  const g1 = planeGeometry.clone()
    .applyMatrix4(
      new THREE.Matrix4()
        .makeShear(0, 0, sk1, 0, 0, 0)
    )
    .applyMatrix4(
      new THREE.Matrix4()
        .makeScale(s1, s1 * aspectRatio1, 1)
    )
    .applyMatrix4(
      new THREE.Matrix4()
        .makeTranslation(p1.x, p1.y, p1.z)
    );
  _colorGeometry(g1, new THREE.Color(0xFFFFFF));
  const g2 = planeGeometry.clone()
    .applyMatrix4(
      new THREE.Matrix4()
        .makeShear(0, 0, sk2, 0, 0, 0)
    )
    .applyMatrix4(
      new THREE.Matrix4()
        .makeScale(s2, s2 * aspectRatio2, 1)
    )
    .applyMatrix4(
      new THREE.Matrix4()
        .makeTranslation(p2.x, p2.y, p2.z)
    );
  _colorGeometry(g2, new THREE.Color(0x000000));
  const geometry = BufferGeometryUtils.mergeBufferGeometries([
    g2,
    g1,
  ]);
  const quad = new THREE.Mesh(
    geometry,
    new THREE.ShaderMaterial({
      uniforms: {
        iTime: {
          value: 0,
          needsUpdate: false,
        },
        /* outline_thickness: {
          value: 0.02,
          needsUpdate: true,
        },
        outline_colour: {
          value: new THREE.Color(0, 0, 1),
          needsUpdate: true,
        },
        outline_threshold: {
          value: .5,
          needsUpdate: true,
        }, */
      },
      vertexShader: labelVertexShader,
      fragmentShader: labelFragmentShader,
    })
  );
  quad.frustumCulled = false;
  return quad;
})();
const bgMesh5 = (() => {
  const o = new THREE.Object3D();
  
  const _addGeometryOffsets = (g, offset, scale) => {
    const offsets = new Float32Array(g.attributes.position.array.length);
    const scales = new Float32Array(g.attributes.position.count);
    for (let i = 0; i < g.attributes.position.array.length; i += 3) {
      offset.toArray(offsets, i);
      scales[i / 3] = scale;
    }
    g.setAttribute('offset', new THREE.BufferAttribute(offsets, 3));
    g.setAttribute('scale', new THREE.BufferAttribute(scales, 1));
  };
  const textMaterial = new THREE.ShaderMaterial({
    vertexShader: textVertexShader,
    fragmentShader: textFragmentShader,
  });
  (async () => {
    const nameMesh = await makeTextMesh(
      'Scillia',
      textMaterial,
      '/fonts/WinchesterCaps.ttf',
      1.25,
      0.05,
      'center',
      'middle',
      0xFFFFFF,
    );
    _addGeometryOffsets(nameMesh.geometry, p1, s1 * aspectRatio1);
    o.add(nameMesh);
  })();
  (async () => {
    const labelMesh = await makeTextMesh(
      'pledged to the lisk',
      textMaterial,
      '/fonts/Plaza Regular.ttf',
      1,
      0.02,
      'center',
      'middle',
      0xFFFFFF,
    );
    _addGeometryOffsets(labelMesh.geometry, p2, s2 * aspectRatio2);
    o.add(labelMesh);
  })();
  return o;
})();
const outlineMaterial = (() => {
  var wVertex = THREE.ShaderLib["standard"].vertexShader;
  var wFragment = THREE.ShaderLib["standard"].fragmentShader;
  var wUniforms = THREE.UniformsUtils.clone(THREE.ShaderLib["standard"].uniforms);
  wUniforms.iTime = {
    value: 0,
    needsUpdate: false,
  };
  wVertex =
    `

          attribute vec3 offset;
          attribute vec4 orientation;

          vec3 applyQuaternionToVector(vec4 q, vec3 v){
              return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
          }

        ` + wVertex;

  wVertex = wVertex.replace(
    "#include <project_vertex>",
    `
          vec3 vPosition = applyQuaternionToVector(orientation, transformed);
    
          vec4 mvPosition = modelViewMatrix * vec4(vPosition, 1.0);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(offset + vPosition, 1.0);
          
        `
  );
  wFragment = `\
    void main() {
      gl_FragColor = vec4(1., 0., 0., 1.);
    }
  `;
  var instanceMaterial = new THREE.ShaderMaterial({
    uniforms: wUniforms,
    vertexShader: wVertex,
    fragmentShader: wFragment,
    lights: true,
    // depthPacking: THREE.RGBADepthPacking,
    name: "detail-material",
    // fog: true,
    extensions: {
      derivatives: true,
    },
    side: THREE.BackSide,
  });
  instanceMaterial.onBeforeCompile = () => {
    console.log('before compile');
  };
  return instanceMaterial;
})();

const mmdCanvases = [];
const mmdCanvasContexts = [];
const avatarRenderTargets = [];
const animationFileNames = `\
'Running' by CorruptedDestiny/2.vpd
'Running' by CorruptedDestiny/3.vpd
'Running' by CorruptedDestiny/4.vpd
'Running' by CorruptedDestiny/5.vpd
'Running' by CorruptedDestiny/6.vpd
'Running' by CorruptedDestiny/First step.vpd
'The Random Factor' by CorruptedDestiny/Jump, YEAH.vpd
'The Random Factor' by CorruptedDestiny/Peace up dude.vpd
'The Random Factor' by CorruptedDestiny/Randomness.vpd
'To Lie' by CorruptedDestiny/Fetal Position.vpd
'To Lie' by CorruptedDestiny/Semi Fetal Position.vpd
'To Lie' by CorruptedDestiny/Sleeping on Back Open.vpd
'To Lie' by CorruptedDestiny/Sleeping on Back.vpd
'To Lie' by CorruptedDestiny/Sleeping on Stomach.vpd
Floating Pose Pack - Snorlaxin/1.vpd
Floating Pose Pack - Snorlaxin/10.vpd
Floating Pose Pack - Snorlaxin/11.vpd
Floating Pose Pack - Snorlaxin/12.vpd
Floating Pose Pack - Snorlaxin/2.vpd
Floating Pose Pack - Snorlaxin/3.vpd
Floating Pose Pack - Snorlaxin/4.vpd
Floating Pose Pack - Snorlaxin/5-ver2.vpd
Floating Pose Pack - Snorlaxin/5.vpd
Floating Pose Pack - Snorlaxin/6.vpd
Floating Pose Pack - Snorlaxin/7.vpd
Floating Pose Pack - Snorlaxin/8.vpd
Floating Pose Pack - Snorlaxin/9.vpd
General Poses 1/Casting.vpd
General Poses 1/Cross my heart.vpd
General Poses 1/Drawing 1.vpd
General Poses 1/Drawing 2.vpd
General Poses 1/Drawing Pose Reference 1.vpd
General Poses 1/Drawing Pose Reference 2.vpd
General Poses 1/Element Bending.vpd
General Poses 1/Frankenstocking 2-1.vpd
General Poses 1/Frankenstocking 2-2.vpd
General Poses 1/Heaven knows, I tried.vpd
General Poses 1/Here I stand in the light of day.vpd
General Poses 1/I'm Devious.vpd
General Poses 1/Look Ma No Hands.vpd
General Poses 1/Magical Girl.vpd
General Poses 1/Monster Girl 2 1.vpd
General Poses 1/Monster Girl 2 2.vpd
General Poses 1/Monster Girl.vpd
General Poses 1/No No 1.vpd
General Poses 1/No No 2.vpd
General Poses 1/Number 1.vpd
General Poses 1/Offer Up 1.vpd
General Poses 1/Offer Up 2.vpd
General Poses 1/Peace.vpd
General Poses 1/Rawr 1.vpd
General Poses 1/Rawr 2.vpd
General Poses 1/Rawr 3.vpd
General Poses 1/Red Purse 1.vpd
General Poses 1/Red Purse 2.vpd
General Poses 1/Sky's Falling 1.vpd
General Poses 1/Sky's Falling 2.vpd
General Poses 1/Sneaking Around 1.vpd
General Poses 1/Sneaking Around 2.vpd
General Poses 1/Sneaking Around 3.vpd
General Poses 1/ssppooonn.vpd
General Poses 1/Start Somthing 1.vpd
General Poses 1/Start Somthing 2.vpd
General Poses 1/Start Somthing 3.vpd
General Poses 1/Turn away and slam the door.vpd
General Poses 1/Witch Brew 1.vpd
General Poses 1/Witch Brew 2.vpd
General Poses 1/Witch Brew 3.vpd
General Poses 1/Witch Brew 4.vpd
General Poses 1/Witch Brew 5.vpd
General Poses 1/Witch Brew 6.vpd
General Poses 1/Witch Brew 7.vpd
General Poses 1/Witch Brew 8.vpd
General Poses 1/With Wings Pose 1.vpd
General Poses 1/With Wings Pose 2.vpd
JuuRenka's Ultimate Pose Pack/R1.vpd
JuuRenka's Ultimate Pose Pack/R10.vpd
JuuRenka's Ultimate Pose Pack/R11.vpd
JuuRenka's Ultimate Pose Pack/R12.vpd
JuuRenka's Ultimate Pose Pack/R13.vpd
JuuRenka's Ultimate Pose Pack/R14.vpd
JuuRenka's Ultimate Pose Pack/R15.vpd
JuuRenka's Ultimate Pose Pack/R16.vpd
JuuRenka's Ultimate Pose Pack/R17.vpd
JuuRenka's Ultimate Pose Pack/R18.vpd
JuuRenka's Ultimate Pose Pack/R19.vpd
JuuRenka's Ultimate Pose Pack/R2.vpd
JuuRenka's Ultimate Pose Pack/R20.vpd
JuuRenka's Ultimate Pose Pack/R21.vpd
JuuRenka's Ultimate Pose Pack/R22.vpd
JuuRenka's Ultimate Pose Pack/R23.vpd
JuuRenka's Ultimate Pose Pack/R24.vpd
JuuRenka's Ultimate Pose Pack/R25.vpd
JuuRenka's Ultimate Pose Pack/R26.vpd
JuuRenka's Ultimate Pose Pack/R27.vpd
JuuRenka's Ultimate Pose Pack/R28.vpd
JuuRenka's Ultimate Pose Pack/R29.vpd
JuuRenka's Ultimate Pose Pack/R3.vpd
JuuRenka's Ultimate Pose Pack/R30.vpd
JuuRenka's Ultimate Pose Pack/R31.vpd
JuuRenka's Ultimate Pose Pack/R32.vpd
JuuRenka's Ultimate Pose Pack/R33.vpd
JuuRenka's Ultimate Pose Pack/R34.vpd
JuuRenka's Ultimate Pose Pack/R35.vpd
JuuRenka's Ultimate Pose Pack/R4.vpd
JuuRenka's Ultimate Pose Pack/R5.vpd
JuuRenka's Ultimate Pose Pack/R6.vpd
JuuRenka's Ultimate Pose Pack/R7.vpd
JuuRenka's Ultimate Pose Pack/R8.vpd
JuuRenka's Ultimate Pose Pack/R9.vpd
Pose Pack 2 by OzzWalcito/1.vpd
Pose Pack 2 by OzzWalcito/10.vpd
Pose Pack 2 by OzzWalcito/11.vpd
Pose Pack 2 by OzzWalcito/12.vpd
Pose Pack 2 by OzzWalcito/13.vpd
Pose Pack 2 by OzzWalcito/14.vpd
Pose Pack 2 by OzzWalcito/15.vpd
Pose Pack 2 by OzzWalcito/16.vpd
Pose Pack 2 by OzzWalcito/17.vpd
Pose Pack 2 by OzzWalcito/18.vpd
Pose Pack 2 by OzzWalcito/19.vpd
Pose Pack 2 by OzzWalcito/2.vpd
Pose Pack 2 by OzzWalcito/20.vpd
Pose Pack 2 by OzzWalcito/21.vpd
Pose Pack 2 by OzzWalcito/22.vpd
Pose Pack 2 by OzzWalcito/23_1.vpd
Pose Pack 2 by OzzWalcito/23_2.vpd
Pose Pack 2 by OzzWalcito/24.vpd
Pose Pack 2 by OzzWalcito/25.vpd
Pose Pack 2 by OzzWalcito/26.vpd
Pose Pack 2 by OzzWalcito/27.vpd
Pose Pack 2 by OzzWalcito/28.vpd
Pose Pack 2 by OzzWalcito/29.vpd
Pose Pack 2 by OzzWalcito/3.vpd
Pose Pack 2 by OzzWalcito/30.vpd
Pose Pack 2 by OzzWalcito/4.vpd
Pose Pack 2 by OzzWalcito/5.vpd
Pose Pack 2 by OzzWalcito/6.vpd
Pose Pack 2 by OzzWalcito/7.vpd
Pose Pack 2 by OzzWalcito/8.vpd
Pose Pack 2 by OzzWalcito/9.vpd
Pose Pack 6 - Snorlaxin/1.vpd
Pose Pack 6 - Snorlaxin/10.vpd
Pose Pack 6 - Snorlaxin/2.vpd
Pose Pack 6 - Snorlaxin/3.vpd
Pose Pack 6 - Snorlaxin/4.vpd
Pose Pack 6 - Snorlaxin/5.vpd
Pose Pack 6 - Snorlaxin/6.vpd
Pose Pack 6 - Snorlaxin/7.vpd
Pose Pack 6 - Snorlaxin/8.vpd
Pose Pack 6 - Snorlaxin/9.vpd
Resting Pose Pack - Snorlaxin/1.vpd
Resting Pose Pack - Snorlaxin/10.vpd
Resting Pose Pack - Snorlaxin/11.vpd
Resting Pose Pack - Snorlaxin/12.vpd
Resting Pose Pack - Snorlaxin/13.vpd
Resting Pose Pack - Snorlaxin/14.vpd
Resting Pose Pack - Snorlaxin/2.vpd
Resting Pose Pack - Snorlaxin/3.vpd
Resting Pose Pack - Snorlaxin/4.vpd
Resting Pose Pack - Snorlaxin/5.vpd
Resting Pose Pack - Snorlaxin/6.vpd
Resting Pose Pack - Snorlaxin/7.vpd
Resting Pose Pack - Snorlaxin/8.vpd
Resting Pose Pack - Snorlaxin/9.vpd
Seated Poses/1.vpd
Seated Poses/2.vpd
Seated Poses/3.vpd
Seated Poses/4.vpd
ThatOneBun Posepack/1.vpd
ThatOneBun Posepack/10.vpd
ThatOneBun Posepack/11.vpd
ThatOneBun Posepack/12.vpd
ThatOneBun Posepack/13.vpd
ThatOneBun Posepack/14.vpd
ThatOneBun Posepack/15.vpd
ThatOneBun Posepack/16.vpd
ThatOneBun Posepack/17.vpd
ThatOneBun Posepack/18.vpd
ThatOneBun Posepack/19.vpd
ThatOneBun Posepack/2.vpd
ThatOneBun Posepack/20.vpd
ThatOneBun Posepack/21.vpd
ThatOneBun Posepack/22.vpd
ThatOneBun Posepack/23.vpd
ThatOneBun Posepack/24.vpd
ThatOneBun Posepack/25.vpd
ThatOneBun Posepack/26.vpd
ThatOneBun Posepack/27.vpd
ThatOneBun Posepack/28.vpd
ThatOneBun Posepack/29.vpd
ThatOneBun Posepack/3.vpd
ThatOneBun Posepack/30.vpd
ThatOneBun Posepack/31.vpd
ThatOneBun Posepack/32.vpd
ThatOneBun Posepack/33.vpd
ThatOneBun Posepack/34.vpd
ThatOneBun Posepack/35.vpd
ThatOneBun Posepack/36.vpd
ThatOneBun Posepack/37.vpd
ThatOneBun Posepack/38.vpd
ThatOneBun Posepack/39.vpd
ThatOneBun Posepack/4.vpd
ThatOneBun Posepack/40.vpd
ThatOneBun Posepack/41.vpd
ThatOneBun Posepack/42.vpd
ThatOneBun Posepack/43.vpd
ThatOneBun Posepack/5.vpd
ThatOneBun Posepack/6.vpd
ThatOneBun Posepack/7.vpd
ThatOneBun Posepack/8.vpd
ThatOneBun Posepack/9.vpd
ThatOneBun Posepack/Scoot's pick/Darinka.vpd
ThatOneBun Posepack/Scoot's pick/Frizerka.vpd
ThatOneBun Posepack/Scoot's pick/Jebac.vpd
ThatOneBun Posepack/Scoot's pick/Snezana.vpd
ThatOneBun Posepack/Scoot's pick/Spizdi.vpd
ThatOneBun Posepack/Scoot's pick/Strina.vpd
ThatOneBun Posepack/Scoot's pick/Vesna.vpd
Trust Me Pose Pack/1.vpd
Trust Me Pose Pack/10.vpd
Trust Me Pose Pack/11 (Boy).vpd
Trust Me Pose Pack/12 (Girl).vpd
Trust Me Pose Pack/13.vpd
Trust Me Pose Pack/14.vpd
Trust Me Pose Pack/15 (Final Pose).vpd
Trust Me Pose Pack/2.vpd
Trust Me Pose Pack/3.vpd
Trust Me Pose Pack/4.vpd
Trust Me Pose Pack/5.vpd
Trust Me Pose Pack/6.vpd
Trust Me Pose Pack/7 (Left).vpd
Trust Me Pose Pack/8 (Right).vpd
Trust Me Pose Pack/9.vpd
Twins/Twins.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 1.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 10.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 11.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 12.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 13.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 14.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 15.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 2.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 3.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 4.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 5.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 6.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 7.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 8.vpd
Yoga Pose Pack - Snorlaxin/Yoga Pose 9.vpd`.split('\n');

let mmdAnimation = null;
import {MMDLoader} from 'three/examples/jsm/loaders/MMDLoader.js';
const mmdLoader = new MMDLoader();
mmdLoader.load(
	// path to PMD/PMX file
	'/avatars/Miku_Hatsune_Ver2.pmd',
  function(mesh) {
    console.log('got', mesh);
    mesh.position.set(0, 0, 0);
    mesh.scale.setScalar(0.07);
    mesh.updateMatrixWorld();
		scene.add(mesh);

    mmdLoader.loadVPD('/poses/' + animationFileNames[30], false, o => {
      console.log('got animation', o);
      
      for (const bone of o.bones) {
        const {name, translation, quaternion} = bone;
        const targetBone = mesh.skeleton.bones.find(b => b.name === name);
        if (targetBone) {
          // targetBone.position.fromArray(translation);
          targetBone.quaternion.fromArray(quaternion);
          // targetBone.updateMatrixWorld();
        } else {
          //console.warn('no bone', name);
        }
      }
      mesh.updateMatrixWorld();

      const _getBone = name => mesh.skeleton.bones.find(b => b.name === name);
      mmdAnimation = {
        Root: _getBone('センター'),
    
        Hips: _getBone('下半身'),
        /* Spine,
        Chest, */
        Chest: _getBone('上半身'),
        Neck: _getBone('首'),
        Head: _getBone('頭'),
        Eye_L: _getBone('左目'),
        Eye_R: _getBone('右目'),

        Left_shoulder: _getBone('左肩'),
        Left_arm: _getBone('左腕'),
        Left_elbow: _getBone('左ひじ'),
        Left_wrist: _getBone('左手首'),
        Left_thumb2: _getBone('左親指２'),
        Left_thumb1: _getBone('左親指１'),
        // Left_thumb0,
        Left_indexFinger3: _getBone('左人指３'),
        Left_indexFinger2: _getBone('左人指２'),
        Left_indexFinger1: _getBone('左人指１'),
        Left_middleFinger3: _getBone('左中指３'),
        Left_middleFinger2: _getBone('左中指２'),
        Left_middleFinger1: _getBone('左中指１'),
        Left_ringFinger3: _getBone('左薬指３'),
        Left_ringFinger2: _getBone('左薬指２'),
        Left_ringFinger1: _getBone('左薬指１'),
        Left_littleFinger3: _getBone('左小指３'),
        Left_littleFinger2: _getBone('左小指２'),
        Left_littleFinger1: _getBone('左小指１'),
        Left_leg: _getBone('左足'),
        Left_knee: _getBone('左ひざ'),
        Left_ankle: _getBone('左足首'),
    
        Right_shoulder: _getBone('右肩'),
        Right_arm: _getBone('右腕'),
        Right_elbow: _getBone('右ひじ'),
        Right_wrist: _getBone('右手首'),
        Right_thumb2: _getBone('右親指２'),
        Right_thumb1: _getBone('右親指１'),
        // Right_thumb0,
        Right_indexFinger3: _getBone('右人指３'),
        Right_indexFinger2: _getBone('右人指２'),
        Right_indexFinger1: _getBone('右人指１'),
        Right_middleFinger3: _getBone('右中指３'),
        Right_middleFinger2: _getBone('右中指２'),
        Right_middleFinger1: _getBone('右中指１'),
        Right_ringFinger3: _getBone('右薬指３'),
        Right_ringFinger2: _getBone('右薬指２'),
        Right_ringFinger1: _getBone('右薬指１'),
        Right_littleFinger3: _getBone('右小指３'),
        Right_littleFinger2: _getBone('右小指２'),
        Right_littleFinger1: _getBone('右小指１'),
        Right_leg: _getBone('右足'),
        Right_knee: _getBone('右ひざ'),
        Right_ankle: _getBone('右足首'),
        Left_toe: _getBone('左つま先'),
        Right_toe: _getBone('右つま先'),
      };
      for (const k in mmdAnimation) {
        if (!mmdAnimation[k]) {
          console.warn('no bone', k);
        }
      }
    }, function onprogress() {}, function(error) {
      console.warn('animation load fail', error);
    });
	},
	// called when loading is in progresses
	function (xhr) {
		// console.log( ( xhr.loaded / xhr.total * 100 ) + '% loaded' );
	},
	// called when loading has errors
	function(error) {
		console.warn('An error happened', error);
	}
);

const localVector = new THREE.Vector3();
const localVector2 = new THREE.Vector3();
const localVector3 = new THREE.Vector3();
const localQuaternion = new THREE.Quaternion();
const localQuaternion2 = new THREE.Quaternion();
const localQuaternion3 = new THREE.Quaternion();
const localQuaternion4 = new THREE.Quaternion();
const localQuaternion5 = new THREE.Quaternion();
const localQuaternion6 = new THREE.Quaternion();
const localEuler = new THREE.Euler();
const localEuler2 = new THREE.Euler();
const localMatrix = new THREE.Matrix4();
const localMatrix2 = new THREE.Matrix4();

// const y180Quaternion = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const maxIdleVelocity = 0.01;
const maxEyeTargetTime = 2000;

VRMSpringBoneImporter.prototype._createSpringBone = (_createSpringBone => {
  const localVector = new THREE.Vector3();
  return function(a, b) {
    const bone = _createSpringBone.apply(this, arguments);
    const initialDragForce = bone.dragForce;
    const initialStiffnessForce = bone.stiffnessForce;
    // const initialGravityPower = bone.gravityPower;
    
    const localPlayer = metaversefile.useLocalPlayer();
    Object.defineProperty(bone, 'stiffnessForce', {
      get() {
        localVector.set(localPlayer.characterPhysics.velocity.x, 0, localPlayer.characterPhysics.velocity.z);
        const f = Math.pow(Math.min(Math.max(localVector.length()*2 - Math.abs(localPlayer.characterPhysics.velocity.y)*0.5, 0), 4), 2);
        return initialStiffnessForce * (0.1 + 0.1*f);
      },
      set(v) {},
    });
    Object.defineProperty(bone, 'dragForce', {
      get() {
        return initialDragForce * 0.7;
      },
      set(v) {},
    });
    
    return bone;
  };
})(VRMSpringBoneImporter.prototype._createSpringBone);

const _makeSimplexes = numSimplexes => {
  const result = Array(numSimplexes);
  for (let i = 0; i < numSimplexes; i++) {
    result[i] = new Simplex(i + '');
  }
  return result;
};
const simplexes = _makeSimplexes(5);

const upVector = new THREE.Vector3(0, 1, 0);
const upRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI*0.5);
const downRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI*0.5);
const leftRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI*0.5);
const rightRotation = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI*0.5);
const cubicBezier = easing(0, 1, 0, 1);
const defaultSitAnimation = 'chair';
const defaultUseAnimation = 'combo';
const defaultDanceAnimation = 'dansu';
const defaultThrowAnimation = 'throw';
// const defaultCrouchAnimation = 'crouch';
const defaultActivateAnimation = 'activate';
const defaultNarutoRunAnimation = 'narutoRun';
const defaultchargeJumpAnimation = 'chargeJump';
const defaultStandChargeAnimation = 'standCharge';


const infinityUpVector = new THREE.Vector3(0, Infinity, 0);
// const crouchMagnitude = 0.2;
/* const animationsSelectMap = {
  crouch: {
    'Crouch Idle.fbx': new THREE.Vector3(0, 0, 0),
    'Sneaking Forward.fbx': new THREE.Vector3(0, 0, -crouchMagnitude),
    'Sneaking Forward reverse.fbx': new THREE.Vector3(0, 0, crouchMagnitude),
    'Crouched Sneaking Left.fbx': new THREE.Vector3(-crouchMagnitude, 0, 0),
    'Crouched Sneaking Right.fbx': new THREE.Vector3(crouchMagnitude, 0, 0),
  },
  stand: {
    'idle.fbx': new THREE.Vector3(0, 0, 0),
    'jump.fbx': new THREE.Vector3(0, 1, 0),

    'left strafe walking.fbx': new THREE.Vector3(-0.5, 0, 0),
    'left strafe.fbx': new THREE.Vector3(-1, 0, 0),
    'right strafe walking.fbx': new THREE.Vector3(0.5, 0, 0),
    'right strafe.fbx': new THREE.Vector3(1, 0, 0),

    'Fast Run.fbx': new THREE.Vector3(0, 0, -1),
    'walking.fbx': new THREE.Vector3(0, 0, -0.5),

    'running backwards.fbx': new THREE.Vector3(0, 0, 1),
    'walking backwards.fbx': new THREE.Vector3(0, 0, 0.5),

    'left strafe walking reverse.fbx': new THREE.Vector3(-Infinity, 0, 0),
    'left strafe reverse.fbx': new THREE.Vector3(-Infinity, 0, 0),
    'right strafe walking reverse.fbx': new THREE.Vector3(Infinity, 0, 0),
    'right strafe reverse.fbx': new THREE.Vector3(Infinity, 0, 0),
  },
};
const animationsDistanceMap = {
  'idle.fbx': new THREE.Vector3(0, 0, 0),
  'jump.fbx': new THREE.Vector3(0, 1, 0),

  'left strafe walking.fbx': new THREE.Vector3(-0.5, 0, 0),
  'left strafe.fbx': new THREE.Vector3(-1, 0, 0),
  'right strafe walking.fbx': new THREE.Vector3(0.5, 0, 0),
  'right strafe.fbx': new THREE.Vector3(1, 0, 0),

  'Fast Run.fbx': new THREE.Vector3(0, 0, -1),
  'walking.fbx': new THREE.Vector3(0, 0, -0.5),

  'running backwards.fbx': new THREE.Vector3(0, 0, 1),
  'walking backwards.fbx': new THREE.Vector3(0, 0, 0.5),

  'left strafe walking reverse.fbx': new THREE.Vector3(-1, 0, 1).normalize().multiplyScalar(2),
  'left strafe reverse.fbx': new THREE.Vector3(-1, 0, 1).normalize().multiplyScalar(3),
  'right strafe walking reverse.fbx': new THREE.Vector3(1, 0, 1).normalize().multiplyScalar(2),
  'right strafe reverse.fbx': new THREE.Vector3(1, 0, 1).normalize().multiplyScalar(3),
  
  'Crouch Idle.fbx': new THREE.Vector3(0, 0, 0),
  'Sneaking Forward.fbx': new THREE.Vector3(0, 0, -crouchMagnitude),
  'Sneaking Forward reverse.fbx': new THREE.Vector3(0, 0, crouchMagnitude),
  'Crouched Sneaking Left.fbx': new THREE.Vector3(-crouchMagnitude, 0, 0),
  'Crouched Sneaking Left reverse.fbx': new THREE.Vector3(-crouchMagnitude, 0, crouchMagnitude),
  'Crouched Sneaking Right.fbx': new THREE.Vector3(crouchMagnitude, 0, 0),
  'Crouched Sneaking Right reverse.fbx': new THREE.Vector3(crouchMagnitude, 0, crouchMagnitude),
}; */
const animationsAngleArrays = {
  walk: [
    {name: 'left strafe walking.fbx', angle: Math.PI/2},
    {name: 'right strafe walking.fbx', angle: -Math.PI/2},

    {name: 'walking.fbx', angle: 0},
    {name: 'walking backwards.fbx', angle: Math.PI},

    // {name: 'left strafe walking reverse.fbx', angle: Math.PI*3/4},
    // {name: 'right strafe walking reverse.fbx', angle: -Math.PI*3/4},
  ],
  run: [
    {name: 'left strafe.fbx', angle: Math.PI/2},
    {name: 'right strafe.fbx', angle: -Math.PI/2},

    {name: 'Fast Run.fbx', angle: 0},
    {name: 'running backwards.fbx', angle: Math.PI},

    // {name: 'left strafe reverse.fbx', angle: Math.PI*3/4},
    // {name: 'right strafe reverse.fbx', angle: -Math.PI*3/4},
  ],
  crouch: [
    {name: 'Crouched Sneaking Left.fbx', angle: Math.PI/2},
    {name: 'Crouched Sneaking Right.fbx', angle: -Math.PI/2},
    
    {name: 'Sneaking Forward.fbx', angle: 0},
    {name: 'Sneaking Forward reverse.fbx', angle: Math.PI},
    
    // {name: 'Crouched Sneaking Left reverse.fbx', angle: Math.PI*3/4},
    // {name: 'Crouched Sneaking Right reverse.fbx', angle: -Math.PI*3/4},
  ],
};
const animationsAngleArraysMirror = {
  walk: [
    {name: 'left strafe walking reverse.fbx', matchAngle: -Math.PI/2, angle: -Math.PI/2},
    {name: 'right strafe walking reverse.fbx', matchAngle: Math.PI/2, angle: Math.PI/2},
  ],
  run: [
    {name: 'left strafe reverse.fbx', matchAngle: -Math.PI/2, angle: -Math.PI/2},
    {name: 'right strafe reverse.fbx', matchAngle: Math.PI/2, angle: Math.PI/2},
  ],
  crouch: [
    {name: 'Crouched Sneaking Left reverse.fbx', matchAngle: -Math.PI/2, angle: -Math.PI/2},
    {name: 'Crouched Sneaking Right reverse.fbx', matchAngle: Math.PI/2, angle: Math.PI/2},
  ],
};
const animationsIdleArrays = {
  reset: {name: 'reset.fbx'},
  walk: {name: 'idle.fbx'},
  run: {name: 'idle.fbx'},
  crouch: {name: 'Crouch Idle.fbx'},
};

let animations;
let animationsBaseModel;
let jumpAnimation;
let floatAnimation;
let useAnimations;
let aimAnimations;
let sitAnimations;
let danceAnimations;
let throwAnimations;
let crouchAnimations;
let activateAnimations;
let narutoRunAnimations;
let jumpAnimationSegments;
let chargeJump;
let standCharge;
let fallLoop;
let swordSideSlash;
let swordTopDownSlash;
const loadPromise = (async () => {
  await Promise.resolve(); // wait for metaversefile to be defined
  
  await Promise.all([
    (async () => {
      const res = await fetch('../animations/animations.cbor');
      const arrayBuffer = await res.arrayBuffer();
      animations = CBOR.decode(arrayBuffer).animations
        .map(a => THREE.AnimationClip.parse(a));
    })(),
    (async () => {
      const srcUrl = '../animations/animations-skeleton.glb';
      
      let o;
      try {
        o = await new Promise((accept, reject) => {
          const {gltfLoader} = metaversefile.useLoaders();
          gltfLoader.load(srcUrl, accept, function onprogress() {}, reject);
        });
      } catch(err) {
        console.warn(err);
      }
      if (o) {
        animationsBaseModel = o;
      }
    })(),
  ]);

  for (const k in animationsAngleArrays) {
    const as = animationsAngleArrays[k];
    for (const a of as) {
      a.animation = animations.find(animation => animation.name === a.name);
    }
  }
  for (const k in animationsAngleArraysMirror) {
    const as = animationsAngleArraysMirror[k];
    for (const a of as) {
      a.animation = animations.find(animation => animation.name === a.name);
    }
  }
  for (const k in animationsIdleArrays) {
    animationsIdleArrays[k].animation = animations.find(animation => animation.name === animationsIdleArrays[k].name);
  }

  const _normalizeAnimationDurations = (animations, baseAnimation, factor = 1) => {
    for (let i = 1; i < animations.length; i++) {
      const animation = animations[i];
      const oldDuration = animation.duration;
      const newDuration = baseAnimation.duration;
      for (const track of animation.tracks) {
        const {times} = track;
        for (let j = 0; j < times.length; j++) {
          times[j] *= newDuration / oldDuration * factor;
        }
      }
      animation.duration = newDuration * factor;
    }
  };
  const walkingAnimations = [
    `walking.fbx`,
    `left strafe walking.fbx`,
    `right strafe walking.fbx`,
  ].map(name => animations.find(a => a.name === name));
  _normalizeAnimationDurations(walkingAnimations, walkingAnimations[0]);
  const walkingBackwardAnimations = [
    `walking backwards.fbx`,
    `left strafe walking reverse.fbx`,
    `right strafe walking reverse.fbx`,
  ].map(name => animations.find(a => a.name === name));
  _normalizeAnimationDurations(walkingBackwardAnimations, walkingBackwardAnimations[0]);
  const runningAnimations = [
    `Fast Run.fbx`,
    `left strafe.fbx`,
    `right strafe.fbx`,
  ].map(name => animations.find(a => a.name === name));
  _normalizeAnimationDurations(runningAnimations, runningAnimations[0]);
  const runningBackwardAnimations = [
    `running backwards.fbx`,
    `left strafe reverse.fbx`,
    `right strafe reverse.fbx`,
  ].map(name => animations.find(a => a.name === name));
  _normalizeAnimationDurations(runningBackwardAnimations, runningBackwardAnimations[0]);
  const crouchingForwardAnimations = [
    `Sneaking Forward.fbx`,
    `Crouched Sneaking Left.fbx`,
    `Crouched Sneaking Right.fbx`,
  ].map(name => animations.find(a => a.name === name));
  _normalizeAnimationDurations(crouchingForwardAnimations, crouchingForwardAnimations[0], 0.5);
  const crouchingBackwardAnimations = [
    `Sneaking Forward reverse.fbx`,
    `Crouched Sneaking Left reverse.fbx`,
    `Crouched Sneaking Right reverse.fbx`,
  ].map(name => animations.find(a => a.name === name));
  _normalizeAnimationDurations(crouchingBackwardAnimations, crouchingBackwardAnimations[0], 0.5);
  for (const animation of animations) {
    decorateAnimation(animation);
  }


  jumpAnimationSegments = {
    chargeJump: animations.find(a => a.isChargeJump),
    chargeJumpFall: animations.find(a => a.isChargeJumpFall),
    isFallLoop: animations.find(a => a.isFallLoop),
    isLanding: animations.find(a => a.isLanding)
  }

  chargeJump = animations.find(a => a.isChargeJump);
  standCharge = animations.find(a => a.isStandCharge);
  fallLoop = animations.find(a => a.isFallLoop);
  swordSideSlash = animations.find(a => a.isSwordSideSlash);
  swordTopDownSlash = animations.find(a => a.isSwordTopDownSlash)

  function mergeAnimations(a, b) {
    const o = {};
    for (const k in a) {
      o[k] = a[k];
    }
    for (const k in b) {
      o[k] = b[k];
    }
    return o;
  }

  jumpAnimation = animations.find(a => a.isJump);
  // sittingAnimation = animations.find(a => a.isSitting);
  floatAnimation = animations.find(a => a.isFloat);
  // rifleAnimation = animations.find(a => a.isRifle);
  // hitAnimation = animations.find(a => a.isHit);
  aimAnimations = {
    swordSideIdle: animations.find(a => a.name === 'sword_idle_side.fbx'),
    swordSideIdleStatic: animations.find(a => a.name === 'sword_idle_side_static.fbx'),
    swordSideSlash: animations.find(a => a.name === 'sword_side_slash.fbx'),
    swordSideSlashStep: animations.find(a => a.name === 'sword_side_slash_step.fbx'),
    swordTopDownSlash: animations.find(a => a.name === 'sword_topdown_slash.fbx'),
    swordTopDownSlashStep: animations.find(a => a.name === 'sword_topdown_slash_step.fbx'),
    swordUndraw: animations.find(a => a.name === 'sword_undraw.fbx'),
  };
  useAnimations = mergeAnimations({
    combo: animations.find(a => a.isCombo),
    slash: animations.find(a => a.isSlash),
    rifle: animations.find(a => a.isRifle),
    pistol: animations.find(a => a.isPistol),
    magic: animations.find(a => a.isMagic),
    drink: animations.find(a => a.isDrinking),
  }, aimAnimations);
  sitAnimations = {
    chair: animations.find(a => a.isSitting),
    saddle: animations.find(a => a.isSitting),
    stand: animations.find(a => a.isSkateboarding),
  };
  danceAnimations = {
    dansu: animations.find(a => a.isDancing),
  };
  throwAnimations = {
    throw: animations.find(a => a.isThrow),
  };
  crouchAnimations = {
    crouch: animations.find(a => a.isCrouch),
  };
  activateAnimations = {
    grab_forward: {animation:animations.find(a => a.name === 'grab_forward.fbx'), speedFactor: 1.2},
    grab_down: {animation:animations.find(a => a.name === 'grab_down.fbx'), speedFactor: 1.7},
    grab_up: {animation:animations.find(a => a.name === 'grab_up.fbx'), speedFactor: 1.2},
    grab_left: {animation:animations.find(a => a.name === 'grab_left.fbx'), speedFactor: 1.2},
    grab_right: {animation:animations.find(a => a.name === 'grab_right.fbx'), speedFactor: 1.2},
  };
  narutoRunAnimations = {
    narutoRun: animations.find(a => a.isNarutoRun),
  };
  {
    const down10QuaternionArray = new THREE.Quaternion()
      .setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI*0.1)
      .toArray();
    [
      'mixamorigSpine1.quaternion',
      'mixamorigSpine2.quaternion',
    ].forEach(k => {
      narutoRunAnimations.narutoRun.interpolants[k].evaluate = t => down10QuaternionArray;
    });
  }
})().catch(err => {
  console.log('load avatar animations error', err);
});

const _localizeMatrixWorld = bone => {
  bone.matrix.copy(bone.matrixWorld);
  if (bone.parent) {
    bone.matrix.premultiply(bone.parent.matrixWorld.clone().invert());
  }
  bone.matrix.decompose(bone.position, bone.quaternion, bone.scale);

  for (let i = 0; i < bone.children.length; i++) {
    _localizeMatrixWorld(bone.children[i]);
  }
};
const _findBoneDeep = (bones, boneName) => {
  for (let i = 0; i < bones.length; i++) {
    const bone = bones[i];
    if (bone.name === boneName) {
      return bone;
    } else {
      const deepBone = _findBoneDeep(bone.children, boneName);
      if (deepBone) {
        return deepBone;
      }
    }
  }
  return null;
};
const copySkeleton = (src, dst) => {
  for (let i = 0; i < src.bones.length; i++) {
    const srcBone = src.bones[i];
    const dstBone = _findBoneDeep(dst.bones, srcBone.name);
    dstBone.matrixWorld.copy(srcBone.matrixWorld);
  }

  // const armature = dst.bones[0].parent;
  // _localizeMatrixWorld(armature);

  dst.calculateInverses();
};

const cubeGeometry = new THREE.ConeBufferGeometry(0.05, 0.2, 3)
  .applyMatrix4(new THREE.Matrix4().makeRotationFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(0, 0, 1)))
  );
const cubeGeometryPositions = cubeGeometry.attributes.position.array;
const numCubeGeometryPositions = cubeGeometryPositions.length;
const srcCubeGeometries = {};
/* const _makeDebugMeshes = () => {
  const geometries = [];
  const _makeCubeMesh = (color, scale = 1) => {
    color = new THREE.Color(color);

    let srcGeometry = srcCubeGeometries[scale];
    if (!srcGeometry) {
      srcGeometry = cubeGeometry.clone()
        .applyMatrix4(localMatrix.makeScale(scale, scale, scale));
      srcCubeGeometries[scale] = srcGeometry;
    }
    const geometry = srcGeometry.clone();
    const colors = new Float32Array(cubeGeometry.attributes.position.array.length);
    for (let i = 0; i < colors.length; i += 3) {
      color.toArray(colors, i);
    }
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const index = geometries.length;
    geometries.push(geometry);
    return [index, srcGeometry];
  };
  const fingerScale = 0.25;
  const attributes = {
    eyes: _makeCubeMesh(0xFF0000),
    head: _makeCubeMesh(0xFF8080),

    chest: _makeCubeMesh(0xFFFF00),
    upperChest: _makeCubeMesh(0x808000),
    leftShoulder: _makeCubeMesh(0x00FF00),
    rightShoulder: _makeCubeMesh(0x008000),
    leftUpperArm: _makeCubeMesh(0x00FFFF),
    rightUpperArm: _makeCubeMesh(0x008080),
    leftLowerArm: _makeCubeMesh(0x0000FF),
    rightLowerArm: _makeCubeMesh(0x000080),
    leftHand: _makeCubeMesh(0xFFFFFF),
    rightHand: _makeCubeMesh(0x808080),

    leftThumb2: _makeCubeMesh(0xFF0000, fingerScale),
    leftThumb1: _makeCubeMesh(0x00FF00, fingerScale),
    leftThumb0: _makeCubeMesh(0x0000FF, fingerScale),
    leftIndexFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    leftIndexFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    leftIndexFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    leftMiddleFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    leftMiddleFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    leftMiddleFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    leftRingFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    leftRingFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    leftRingFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    leftLittleFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    leftLittleFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    leftLittleFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    rightThumb2: _makeCubeMesh(0xFF0000, fingerScale),
    rightThumb1: _makeCubeMesh(0x00FF00, fingerScale),
    rightThumb0: _makeCubeMesh(0x0000FF, fingerScale),
    rightIndexFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    rightIndexFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    rightIndexFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    rightMiddleFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    rightMiddleFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    rightMiddleFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    rightRingFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    rightRingFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    rightRingFinger1: _makeCubeMesh(0x0000FF, fingerScale),
    rightLittleFinger3: _makeCubeMesh(0xFF0000, fingerScale),
    rightLittleFinger2: _makeCubeMesh(0x00FF00, fingerScale),
    rightLittleFinger1: _makeCubeMesh(0x0000FF, fingerScale),

    hips: _makeCubeMesh(0xFF0000),
    leftUpperLeg: _makeCubeMesh(0xFFFF00),
    rightUpperLeg: _makeCubeMesh(0x808000),
    leftLowerLeg: _makeCubeMesh(0x00FF00),
    rightLowerLeg: _makeCubeMesh(0x008000),
    leftFoot: _makeCubeMesh(0xFFFFFF),
    rightFoot: _makeCubeMesh(0x808080),
  };
  const geometry = BufferGeometryUtils.mergeBufferGeometries(geometries);
  for (const k in attributes) {
    const [index, srcGeometry] = attributes[k];
    const attribute = new THREE.BufferAttribute(
      new Float32Array(geometry.attributes.position.array.buffer, geometry.attributes.position.array.byteOffset + index*numCubeGeometryPositions*Float32Array.BYTES_PER_ELEMENT, numCubeGeometryPositions),
      3
    );
    attribute.srcGeometry = srcGeometry;
    attribute.visible = true;
    attributes[k] = attribute;
  }
  const material = new THREE.MeshPhongMaterial({
    flatShading: true,
    vertexColors: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.attributes = attributes;
  return mesh;
}; */
/* const _traverseChild = (bone, distance) => {
  if (distance <= 0) {
    return bone;
  } else {
    for (let i = 0; i < bone.children.length; i++) {
      const child = bone.children[i];
      const subchild = _traverseChild(child, distance - 1);
      if (subchild !== null) {
        return subchild;
      }
    }
    return null;
  }
}; */
const _findArmature = bone => {
  for (;; bone = bone.parent) {
    if (!bone.isBone) {
      return bone;
    }
  }
  return null; // can't happen
};

/* const _exportBone = bone => {
  return [bone.name, bone.position.toArray().concat(bone.quaternion.toArray()).concat(bone.scale.toArray()), bone.children.map(b => _exportBone(b))];
};
const _exportSkeleton = skeleton => {
  const hips = _findHips(skeleton);
  const armature = _findArmature(hips);
  return JSON.stringify(_exportBone(armature));
};
const _importObject = (b, Cons, ChildCons) => {
  const [name, array, children] = b;
  const bone = new Cons();
  bone.name = name;
  bone.position.fromArray(array, 0);
  bone.quaternion.fromArray(array, 3);
  bone.scale.fromArray(array, 3+4);
  for (let i = 0; i < children.length; i++) {
    bone.add(_importObject(children[i], ChildCons, ChildCons));
  }
  return bone;
};
const _importArmature = b => _importObject(b, THREE.Object3D, THREE.Bone);
const _importSkeleton = s => {
  const armature = _importArmature(JSON.parse(s));
  return new THREE.Skeleton(armature.children);
}; */

class AnimationMapping {
  constructor(animationTrackName, boneName, isTop, isPosition) {
    this.animationTrackName = animationTrackName;
    this.boneName = boneName;
    this.isTop = isTop;
    this.isPosition = isPosition;
  }
  clone() {
    return new AnimationMapping(this.animationTrackName, this.boneName, this.isTop, this.isPosition);
  }
}
const _getLerpFn = isPosition => isPosition ? THREE.Vector3.prototype.lerp : THREE.Quaternion.prototype.slerp;
const animationMappingConfig = [
  new AnimationMapping('mixamorigHips.position', 'Hips', false, true),
  new AnimationMapping('mixamorigHips.quaternion', 'Hips', false, false),
  new AnimationMapping('mixamorigSpine.quaternion', 'Spine', true, false),
  new AnimationMapping('mixamorigSpine1.quaternion', 'Chest', true, false),
  new AnimationMapping('mixamorigSpine2.quaternion', 'UpperChest', true, false),
  new AnimationMapping('mixamorigNeck.quaternion', 'Neck', true, false),
  new AnimationMapping('mixamorigHead.quaternion', 'Head', true, false),

  new AnimationMapping('mixamorigLeftShoulder.quaternion', 'Left_shoulder', true, false),
  new AnimationMapping('mixamorigLeftArm.quaternion', 'Left_arm', true, false),
  new AnimationMapping('mixamorigLeftForeArm.quaternion', 'Left_elbow', true, false),
  new AnimationMapping('mixamorigLeftHand.quaternion', 'Left_wrist', true, false),
  new AnimationMapping('mixamorigLeftHandMiddle1.quaternion', 'Left_middleFinger1', true, false),
  new AnimationMapping('mixamorigLeftHandMiddle2.quaternion', 'Left_middleFinger2', true, false),
  new AnimationMapping('mixamorigLeftHandMiddle3.quaternion', 'Left_middleFinger3', true, false),
  new AnimationMapping('mixamorigLeftHandThumb1.quaternion', 'Left_thumb0', true, false),
  new AnimationMapping('mixamorigLeftHandThumb2.quaternion', 'Left_thumb1', true, false),
  new AnimationMapping('mixamorigLeftHandThumb3.quaternion', 'Left_thumb2', true, false),
  new AnimationMapping('mixamorigLeftHandIndex1.quaternion', 'Left_indexFinger1', true, false),
  new AnimationMapping('mixamorigLeftHandIndex2.quaternion', 'Left_indexFinger2', true, false),
  new AnimationMapping('mixamorigLeftHandIndex3.quaternion', 'Left_indexFinger3', true, false),
  new AnimationMapping('mixamorigLeftHandRing1.quaternion', 'Left_ringFinger1', true, false),
  new AnimationMapping('mixamorigLeftHandRing2.quaternion', 'Left_ringFinger2', true, false),
  new AnimationMapping('mixamorigLeftHandRing3.quaternion', 'Left_ringFinger3', true, false),
  new AnimationMapping('mixamorigLeftHandPinky1.quaternion', 'Left_littleFinger1', true, false),
  new AnimationMapping('mixamorigLeftHandPinky2.quaternion', 'Left_littleFinger2', true, false),
  new AnimationMapping('mixamorigLeftHandPinky3.quaternion', 'Left_littleFinger3', true, false),

  new AnimationMapping('mixamorigRightShoulder.quaternion', 'Right_shoulder', true, false),
  new AnimationMapping('mixamorigRightArm.quaternion', 'Right_arm', true, false),
  new AnimationMapping('mixamorigRightForeArm.quaternion', 'Right_elbow', true, false),
  new AnimationMapping('mixamorigRightHand.quaternion', 'Right_wrist', true, false),
  new AnimationMapping('mixamorigRightHandMiddle1.quaternion', 'Right_middleFinger1', true, false),
  new AnimationMapping('mixamorigRightHandMiddle2.quaternion', 'Right_middleFinger2', true, false),
  new AnimationMapping('mixamorigRightHandMiddle3.quaternion', 'Right_middleFinger3', true, false),
  new AnimationMapping('mixamorigRightHandThumb1.quaternion', 'Left_thumb0', true, false),
  new AnimationMapping('mixamorigRightHandThumb2.quaternion', 'Left_thumb1', true, false),
  new AnimationMapping('mixamorigRightHandThumb3.quaternion', 'Left_thumb2', true, false),
  new AnimationMapping('mixamorigRightHandIndex1.quaternion', 'Right_indexFinger1', true, false),
  new AnimationMapping('mixamorigRightHandIndex2.quaternion', 'Right_indexFinger2', true, false),
  new AnimationMapping('mixamorigRightHandIndex3.quaternion', 'Right_indexFinger3', true, false),
  new AnimationMapping('mixamorigRightHandRing1.quaternion', 'Right_ringFinger1', true, false),
  new AnimationMapping('mixamorigRightHandRing2.quaternion', 'Right_ringFinger2', true, false),
  new AnimationMapping('mixamorigRightHandRing3.quaternion', 'Right_ringFinger3', true, false),
  new AnimationMapping('mixamorigRightHandPinky1.quaternion', 'Right_littleFinger1', true, false),
  new AnimationMapping('mixamorigRightHandPinky2.quaternion', 'Right_littleFinger2', true, false),
  new AnimationMapping('mixamorigRightHandPinky3.quaternion', 'Right_littleFinger3', true, false),

  new AnimationMapping('mixamorigRightUpLeg.quaternion', 'Right_leg', false, false),
  new AnimationMapping('mixamorigRightLeg.quaternion', 'Right_knee', false, false),
  new AnimationMapping('mixamorigRightFoot.quaternion', 'Right_ankle', false, false),
  new AnimationMapping('mixamorigRightToeBase.quaternion', 'Right_toe', false, false),

  new AnimationMapping('mixamorigLeftUpLeg.quaternion', 'Left_leg', false, false),
  new AnimationMapping('mixamorigLeftLeg.quaternion', 'Left_knee', false, false),
  new AnimationMapping('mixamorigLeftFoot.quaternion', 'Left_ankle', false, false),
  new AnimationMapping('mixamorigLeftToeBase.quaternion', 'Left_toe', false, false),
];

class Avatar {
	constructor(object, options = {}) {
    if (!object) {
      object = {};
    }
    if (!object.parser) {
      object.parser = {
        json: {
          extensions: {},
        },
      };
    }
    
    this.object = object;
    const model = (() => {
      let o = object;
      if (o && !o.isMesh) {
        o = o.scene;
      }
      /* if (!o) {
        const scene = new THREE.Scene();

        const skinnedMesh = new THREE.Object3D();
        skinnedMesh.isSkinnedMesh = true;
        skinnedMesh.skeleton = null;
        skinnedMesh.bind = function(skeleton) {
          this.skeleton = skeleton;
        };
        skinnedMesh.bind(_importSkeleton(skeletonString));
        scene.add(skinnedMesh);

        const hips = _findHips(skinnedMesh.skeleton);
        const armature = _findArmature(hips);
        scene.add(armature);

        o = scene;
      } */
      return o;
    })();
    this.model = model;
    this.options = options;
    
    const vrmExtension = object?.parser?.json?.extensions?.VRM;

    const {
      skinnedMeshes,
      skeleton,
      modelBones,
      foundModelBones,
      flipZ,
      flipY,
      flipLeg,
      tailBones,
      armature,
      armatureQuaternion,
      armatureMatrixInverse,
      // retargetedAnimations,
    } = Avatar.bindAvatar(object);
    this.skinnedMeshes = skinnedMeshes;
    this.skeleton = skeleton;
    this.modelBones = modelBones;
    this.foundModelBones = foundModelBones;
    this.flipZ = flipZ;
    this.flipY = flipY;
    this.flipLeg = flipLeg;
    // this.retargetedAnimations = retargetedAnimations;
    this.vowels = Float32Array.from([1, 0, 0, 0, 0]);

    /* if (options.debug) {
      const debugMeshes = _makeDebugMeshes();
      this.model.add(debugMeshes);
      this.debugMeshes = debugMeshes;
    } else {
      this.debugMeshes = null;
    } */

    modelBones.Root.traverse(o => {
      o.savedPosition = o.position.clone();
      o.savedMatrixWorld = o.matrixWorld.clone();
    });

		this.poseManager = new PoseManager();
		this.shoulderTransforms = new ShoulderTransforms(this);
		this.legsManager = new LegsManager(this);
    
    const fingerBoneMap = {
      left: [
        {
          bones: [this.poseManager.vrTransforms.leftHand.leftThumb0, this.poseManager.vrTransforms.leftHand.leftThumb1, this.poseManager.vrTransforms.leftHand.leftThumb2],
          finger: 'thumb',
        },
        {
          bones: [this.poseManager.vrTransforms.leftHand.leftIndexFinger1, this.poseManager.vrTransforms.leftHand.leftIndexFinger2, this.poseManager.vrTransforms.leftHand.leftIndexFinger3],
          finger: 'index',
        },
        {
          bones: [this.poseManager.vrTransforms.leftHand.leftMiddleFinger1, this.poseManager.vrTransforms.leftHand.leftMiddleFinger2, this.poseManager.vrTransforms.leftHand.leftMiddleFinger3],
          finger: 'middle',
        },
        {
          bones: [this.poseManager.vrTransforms.leftHand.leftRingFinger1, this.poseManager.vrTransforms.leftHand.leftRingFinger2, this.poseManager.vrTransforms.leftHand.leftRingFinger3],
          finger: 'ring',
        },
        {
          bones: [this.poseManager.vrTransforms.leftHand.leftLittleFinger1, this.poseManager.vrTransforms.leftHand.leftLittleFinger2, this.poseManager.vrTransforms.leftHand.leftLittleFinger3],
          finger: 'little',
        },
      ],
      right: [
        {
          bones: [this.poseManager.vrTransforms.rightHand.rightThumb0, this.poseManager.vrTransforms.rightHand.rightThumb1, this.poseManager.vrTransforms.rightHand.rightThumb2],
          finger: 'thumb',
        },
        {
          bones: [this.poseManager.vrTransforms.rightHand.rightIndexFinger1, this.poseManager.vrTransforms.rightHand.rightIndexFinger2, this.poseManager.vrTransforms.rightHand.rightIndexFinger3],
          finger: 'index',
        },
        {
          bones: [this.poseManager.vrTransforms.rightHand.rightMiddleFinger1, this.poseManager.vrTransforms.rightHand.rightMiddleFinger2, this.poseManager.vrTransforms.rightHand.rightMiddleFinger3],
          finger: 'middle',
        },
        {
          bones: [this.poseManager.vrTransforms.rightHand.rightRingFinger1, this.poseManager.vrTransforms.rightHand.rightRingFinger2, this.poseManager.vrTransforms.rightHand.rightRingFinger3],
          finger: 'ring',
        },
        {
          bones: [this.poseManager.vrTransforms.rightHand.rightLittleFinger1, this.poseManager.vrTransforms.rightHand.rightLittleFinger2, this.poseManager.vrTransforms.rightHand.rightLittleFinger3],
          finger: 'little',
        },
      ],
    };
    this.fingerBoneMap = fingerBoneMap;
    
    /* const allHairBones = [];
    const _recurseAllHairBones = bones => {
      for (let i = 0; i < bones.length; i++) {
        const bone = bones[i];
        if (/hair/i.test(bone.name)) {
          allHairBones.push(bone);
        }
        _recurseAllHairBones(bone.children);
      }
    };
    _recurseAllHairBones(skeleton.bones); */
    const hairBones = tailBones.filter(bone => /hair/i.test(bone.name)).map(bone => {
      for (; bone; bone = bone.parent) {
        if (bone.parent === modelBones.Head) {
          return bone;
        }
      }
      return null;
    }).filter(bone => bone);
    // this.allHairBones = allHairBones;
    this.hairBones = hairBones;
    
    this.eyeTarget = new THREE.Vector3();
    this.eyeTargetInverted = false;
    this.eyeTargetEnabled = false;

    this.springBoneManager = null;
    this.springBoneTimeStep = new FixedTimeStep(timeDiff => {
      const timeDiffS = timeDiff / 1000;
      this.springBoneManager.lateUpdate(timeDiffS);
    }, avatarInterpolationFrameRate);
    let springBoneManagerPromise = null;
    if (options.hair) {
      new Promise((accept, reject) => {
        /* if (!object.parser.json.extensions) {
          object.parser.json.extensions = {};
        }
        if (!object.parser.json.extensions.VRM) {
          object.parser.json.extensions.VRM = {
            secondaryAnimation: {
              boneGroups: this.hairBones.map(hairBone => {
                const boneIndices = [];
                const _recurse = bone => {
                  boneIndices.push(this.allHairBones.indexOf(bone));
                  if (bone.children.length > 0) {
                    _recurse(bone.children[0]);
                  }
                };
                _recurse(hairBone);
                return {
                  comment: hairBone.name,
                  stiffiness: 0.5,
                  gravityPower: 0.2,
                  gravityDir: {
                    x: 0,
                    y: -1,
                    z: 0
                  },
                  dragForce: 0.3,
                  center: -1,
                  hitRadius: 0.02,
                  bones: boneIndices,
                  colliderGroups: [],
                };
              }),
            },
          };
          object.parser.getDependency = async (type, nodeIndex) => {
            if (type === 'node') {
              return this.allHairBones[nodeIndex];
            } else {
              throw new Error('unsupported type');
            }
          };
        } */

        springBoneManagerPromise = new VRMSpringBoneImporter().import(object)
          .then(springBoneManager => {
            this.springBoneManager = springBoneManager;
          });
      });
    }


    const _getOffset = (bone, parent = bone?.parent) => bone && bone.getWorldPosition(new THREE.Vector3()).sub(parent.getWorldPosition(new THREE.Vector3()));

    this.initializeBonePositions({
      hips: _getOffset(modelBones.Hips),
      spine: _getOffset(modelBones.Spine),
      chest: _getOffset(modelBones.Chest),
      upperChest: _getOffset(modelBones.UpperChest),
      neck: _getOffset(modelBones.Neck),
      head: _getOffset(modelBones.Head),
      // eyes: _getOffset(modelBones.Head), // yes, head
      eyel: _getOffset(modelBones.Eye_L),
      eyer: _getOffset(modelBones.Eye_R),

      leftShoulder: _getOffset(modelBones.Right_shoulder),
      leftUpperArm: _getOffset(modelBones.Right_arm),
      leftLowerArm: _getOffset(modelBones.Right_elbow),
      leftHand: _getOffset(modelBones.Right_wrist),
      leftThumb2: _getOffset(modelBones.Right_thumb2),
      leftThumb1: _getOffset(modelBones.Right_thumb1),
      leftThumb0: _getOffset(modelBones.Right_thumb0),
      leftIndexFinger1: _getOffset(modelBones.Right_indexFinger1),
      leftIndexFinger2: _getOffset(modelBones.Right_indexFinger2),
      leftIndexFinger3: _getOffset(modelBones.Right_indexFinger3),
      leftMiddleFinger1: _getOffset(modelBones.Right_middleFinger1),
      leftMiddleFinger2: _getOffset(modelBones.Right_middleFinger2),
      leftMiddleFinger3: _getOffset(modelBones.Right_middleFinger3),
      leftRingFinger1: _getOffset(modelBones.Right_ringFinger1),
      leftRingFinger2: _getOffset(modelBones.Right_ringFinger2),
      leftRingFinger3: _getOffset(modelBones.Right_ringFinger3),
      leftLittleFinger1: _getOffset(modelBones.Right_littleFinger1),
      leftLittleFinger2: _getOffset(modelBones.Right_littleFinger2),
      leftLittleFinger3: _getOffset(modelBones.Right_littleFinger3),

      rightShoulder: _getOffset(modelBones.Left_shoulder),
      rightUpperArm: _getOffset(modelBones.Left_arm),
      rightLowerArm: _getOffset(modelBones.Left_elbow),
      rightHand: _getOffset(modelBones.Left_wrist),
      rightThumb2: _getOffset(modelBones.Left_thumb2),
      rightThumb1: _getOffset(modelBones.Left_thumb1),
      rightThumb0: _getOffset(modelBones.Left_thumb0),
      rightIndexFinger1: _getOffset(modelBones.Left_indexFinger1),
      rightIndexFinger2: _getOffset(modelBones.Left_indexFinger2),
      rightIndexFinger3: _getOffset(modelBones.Left_indexFinger3),
      rightMiddleFinger1: _getOffset(modelBones.Left_middleFinger1),
      rightMiddleFinger2: _getOffset(modelBones.Left_middleFinger2),
      rightMiddleFinger3: _getOffset(modelBones.Left_middleFinger3),
      rightRingFinger1: _getOffset(modelBones.Left_ringFinger1),
      rightRingFinger2: _getOffset(modelBones.Left_ringFinger2),
      rightRingFinger3: _getOffset(modelBones.Left_ringFinger3),
      rightLittleFinger1: _getOffset(modelBones.Left_littleFinger1),
      rightLittleFinger2: _getOffset(modelBones.Left_littleFinger2),
      rightLittleFinger3: _getOffset(modelBones.Left_littleFinger3),

      leftUpperLeg: _getOffset(modelBones.Right_leg),
      leftLowerLeg: _getOffset(modelBones.Right_knee),
      leftFoot: _getOffset(modelBones.Right_ankle),

      rightUpperLeg: _getOffset(modelBones.Left_leg),
      rightLowerLeg: _getOffset(modelBones.Left_knee),
      rightFoot: _getOffset(modelBones.Left_ankle),
      
      leftToe: _getOffset(modelBones.Left_toe),
      rightToe: _getOffset(modelBones.Right_toe),
    });

    // height is defined as eyes to root
    this.height = getHeight(object);
    this.shoulderWidth = modelBones.Left_arm.getWorldPosition(new THREE.Vector3()).distanceTo(modelBones.Right_arm.getWorldPosition(new THREE.Vector3()));
    this.leftArmLength = this.shoulderTransforms.leftArm.armLength;
    this.rightArmLength = this.shoulderTransforms.rightArm.armLength;
    let indexDistance = modelBones.Left_indexFinger1 ? modelBones.Left_indexFinger1.getWorldPosition(new THREE.Vector3()).distanceTo(modelBones.Left_wrist.getWorldPosition(new THREE.Vector3())) : 0;
    let handWidth = (modelBones.Left_indexFinger1 && modelBones.Left_littleFinger1)? modelBones.Left_indexFinger1.getWorldPosition(new THREE.Vector3()).distanceTo(modelBones.Left_littleFinger1.getWorldPosition(new THREE.Vector3())) : 0;
    this.handOffsetLeft = new THREE.Vector3(handWidth*0.7, -handWidth*0.75, indexDistance*0.5);
    this.handOffsetRight = new THREE.Vector3(-handWidth*0.7, -handWidth*0.75, indexDistance*0.5);
    const eyePosition = getEyePosition(this.modelBones);
    this.eyeToHipsOffset = modelBones.Hips.getWorldPosition(new THREE.Vector3()).sub(eyePosition);

    const _makeInput = () => {
      const result = new THREE.Object3D();
      result.pointer = 0;
      result.grip = 0;
      result.enabled = false;
      return result;
    };
		this.inputs = {
      hmd: _makeInput(),
			leftGamepad: _makeInput(),
			rightGamepad: _makeInput(),
		};
    this.sdkInputs = {
      hmd: this.poseManager.vrTransforms.head,
			leftGamepad: this.poseManager.vrTransforms.leftHand,
			rightGamepad: this.poseManager.vrTransforms.rightHand,
    };
    this.sdkInputs.hmd.scaleFactor = 1;
    this.lastModelScaleFactor = 1;
		/* this.outputs = {
			// eyes: this.shoulderTransforms.eyes,
      eyel: this.shoulderTransforms.eyel,
      eyer: this.shoulderTransforms.eyer,
      head: this.shoulderTransforms.head,
      hips: this.shoulderTransforms.hips,
      root: this.shoulderTransforms.root,
      spine: this.shoulderTransforms.spine,
      chest: this.shoulderTransforms.chest,
      upperChest: this.shoulderTransforms.chest,
      neck: this.shoulderTransforms.neck,
      leftShoulder: this.shoulderTransforms.leftShoulderAnchor,
      leftUpperArm: this.shoulderTransforms.leftArm.upperArm,
      leftLowerArm: this.shoulderTransforms.leftArm.lowerArm,
      leftHand: this.shoulderTransforms.leftArm.hand,
      rightShoulder: this.shoulderTransforms.rightShoulderAnchor,
      rightUpperArm: this.shoulderTransforms.rightArm.upperArm,
      rightLowerArm: this.shoulderTransforms.rightArm.lowerArm,
      rightHand: this.shoulderTransforms.rightArm.hand,
      leftUpperLeg: this.legsManager.leftLeg.upperLeg,
      leftLowerLeg: this.legsManager.leftLeg.lowerLeg,
      leftFoot: this.legsManager.leftLeg.foot,
      leftToe: this.legsManager.leftLeg.toe,
      rightUpperLeg: this.legsManager.rightLeg.upperLeg,
      rightLowerLeg: this.legsManager.rightLeg.lowerLeg,
      rightFoot: this.legsManager.rightLeg.foot,
      rightToe: this.legsManager.rightLeg.toe,
      leftThumb2: this.shoulderTransforms.rightArm.thumb2,
      leftThumb1: this.shoulderTransforms.rightArm.thumb1,
      leftThumb0: this.shoulderTransforms.rightArm.thumb0,
      leftIndexFinger3: this.shoulderTransforms.rightArm.indexFinger3,
      leftIndexFinger2: this.shoulderTransforms.rightArm.indexFinger2,
      leftIndexFinger1: this.shoulderTransforms.rightArm.indexFinger1,
      leftMiddleFinger3: this.shoulderTransforms.rightArm.middleFinger3,
      leftMiddleFinger2: this.shoulderTransforms.rightArm.middleFinger2,
      leftMiddleFinger1: this.shoulderTransforms.rightArm.middleFinger1,
      leftRingFinger3: this.shoulderTransforms.rightArm.ringFinger3,
      leftRingFinger2: this.shoulderTransforms.rightArm.ringFinger2,
      leftRingFinger1: this.shoulderTransforms.rightArm.ringFinger1,
      leftLittleFinger3: this.shoulderTransforms.rightArm.littleFinger3,
      leftLittleFinger2: this.shoulderTransforms.rightArm.littleFinger2,
      leftLittleFinger1: this.shoulderTransforms.rightArm.littleFinger1,
      rightThumb2: this.shoulderTransforms.leftArm.thumb2,
      rightThumb1: this.shoulderTransforms.leftArm.thumb1,
      rightThumb0: this.shoulderTransforms.leftArm.thumb0,
      rightIndexFinger3: this.shoulderTransforms.leftArm.indexFinger3,
      rightIndexFinger2: this.shoulderTransforms.leftArm.indexFinger2,
      rightIndexFinger1: this.shoulderTransforms.leftArm.indexFinger1,
      rightMiddleFinger3: this.shoulderTransforms.leftArm.middleFinger3,
      rightMiddleFinger2: this.shoulderTransforms.leftArm.middleFinger2,
      rightMiddleFinger1: this.shoulderTransforms.leftArm.middleFinger1,
      rightRingFinger3: this.shoulderTransforms.leftArm.ringFinger3,
      rightRingFinger2: this.shoulderTransforms.leftArm.ringFinger2,
      rightRingFinger1: this.shoulderTransforms.leftArm.ringFinger1,
      rightLittleFinger3: this.shoulderTransforms.leftArm.littleFinger3,
      rightLittleFinger2: this.shoulderTransforms.leftArm.littleFinger2,
      rightLittleFinger1: this.shoulderTransforms.leftArm.littleFinger1,
		}; */
		this.modelBoneOutputs = {
      Root: this.shoulderTransforms.root,

	    Hips: this.shoulderTransforms.hips,
	    Spine: this.shoulderTransforms.spine,
	    Chest: this.shoulderTransforms.chest,
	    UpperChest: this.shoulderTransforms.upperChest,
	    Neck: this.shoulderTransforms.neck,
	    Head: this.shoulderTransforms.head,
      Eye_L: this.shoulderTransforms.eyel,
      Eye_R: this.shoulderTransforms.eyer,

	    Left_shoulder: this.shoulderTransforms.rightShoulderAnchor,
	    Left_arm: this.shoulderTransforms.rightArm.upperArm,
	    Left_elbow: this.shoulderTransforms.rightArm.lowerArm,
	    Left_wrist: this.shoulderTransforms.rightArm.hand,
      Left_thumb2: this.shoulderTransforms.rightArm.thumb2,
      Left_thumb1: this.shoulderTransforms.rightArm.thumb1,
      Left_thumb0: this.shoulderTransforms.rightArm.thumb0,
      Left_indexFinger3: this.shoulderTransforms.rightArm.indexFinger3,
      Left_indexFinger2: this.shoulderTransforms.rightArm.indexFinger2,
      Left_indexFinger1: this.shoulderTransforms.rightArm.indexFinger1,
      Left_middleFinger3: this.shoulderTransforms.rightArm.middleFinger3,
      Left_middleFinger2: this.shoulderTransforms.rightArm.middleFinger2,
      Left_middleFinger1: this.shoulderTransforms.rightArm.middleFinger1,
      Left_ringFinger3: this.shoulderTransforms.rightArm.ringFinger3,
      Left_ringFinger2: this.shoulderTransforms.rightArm.ringFinger2,
      Left_ringFinger1: this.shoulderTransforms.rightArm.ringFinger1,
      Left_littleFinger3: this.shoulderTransforms.rightArm.littleFinger3,
      Left_littleFinger2: this.shoulderTransforms.rightArm.littleFinger2,
      Left_littleFinger1: this.shoulderTransforms.rightArm.littleFinger1,
	    Left_leg: this.legsManager.rightLeg.upperLeg,
	    Left_knee: this.legsManager.rightLeg.lowerLeg,
	    Left_ankle: this.legsManager.rightLeg.foot,

	    Right_shoulder: this.shoulderTransforms.leftShoulderAnchor,
	    Right_arm: this.shoulderTransforms.leftArm.upperArm,
	    Right_elbow: this.shoulderTransforms.leftArm.lowerArm,
	    Right_wrist: this.shoulderTransforms.leftArm.hand,
      Right_thumb2: this.shoulderTransforms.leftArm.thumb2,
      Right_thumb1: this.shoulderTransforms.leftArm.thumb1,
      Right_thumb0: this.shoulderTransforms.leftArm.thumb0,
      Right_indexFinger3: this.shoulderTransforms.leftArm.indexFinger3,
      Right_indexFinger2: this.shoulderTransforms.leftArm.indexFinger2,
      Right_indexFinger1: this.shoulderTransforms.leftArm.indexFinger1,
      Right_middleFinger3: this.shoulderTransforms.leftArm.middleFinger3,
      Right_middleFinger2: this.shoulderTransforms.leftArm.middleFinger2,
      Right_middleFinger1: this.shoulderTransforms.leftArm.middleFinger1,
      Right_ringFinger3: this.shoulderTransforms.leftArm.ringFinger3,
      Right_ringFinger2: this.shoulderTransforms.leftArm.ringFinger2,
      Right_ringFinger1: this.shoulderTransforms.leftArm.ringFinger1,
      Right_littleFinger3: this.shoulderTransforms.leftArm.littleFinger3,
      Right_littleFinger2: this.shoulderTransforms.leftArm.littleFinger2,
      Right_littleFinger1: this.shoulderTransforms.leftArm.littleFinger1,
	    Right_leg: this.legsManager.leftLeg.upperLeg,
	    Right_knee: this.legsManager.leftLeg.lowerLeg,
	    Right_ankle: this.legsManager.leftLeg.foot,
      Left_toe: this.legsManager.leftLeg.toe,
      Right_toe: this.legsManager.rightLeg.toe,
	  };

    this.emotes = [];
    if (this.options.visemes) {
      // ["Neutral", "A", "I", "U", "E", "O", "Blink", "Blink_L", "Blink_R", "Angry", "Fun", "Joy", "Sorrow", "Surprised"]
      const _getBlendShapeIndexForPresetName = presetName => {
        const blendShapes = vrmExtension && vrmExtension.blendShapeMaster && vrmExtension.blendShapeMaster.blendShapeGroups;
        if (Array.isArray(blendShapes)) {
          const shape = blendShapes.find(blendShape => blendShape.presetName === presetName);
          if (shape && shape.binds && shape.binds.length > 0 && typeof shape.binds[0].index === 'number') {
            return shape.binds[0].index;
          } else {
            return -1;
          }
        } else {
          return -1;
        }
      };
      /* const _getBlendShapeIndexForName = name => {
        const blendShapes = vrmExtension && vrmExtension.blendShapeMaster && vrmExtension.blendShapeMaster.blendShapeGroups;
        if (Array.isArray(blendShapes)) {
          const shape = blendShapes.find(blendShape => blendShape.name.toLowerCase() === name);
          if (shape && shape.binds && shape.binds.length > 0 && typeof shape.binds[0].index === 'number') {
            return shape.binds[0].index;
          } else {
            return null;
          }
        } else {
          return null;
        }
      }; */
      
      this.skinnedMeshesVisemeMappings = this.skinnedMeshes.map(o => {
        const {morphTargetDictionary, morphTargetInfluences} = o;
        if (morphTargetDictionary && morphTargetInfluences) {
          const blinkLeftIndex = _getBlendShapeIndexForPresetName('blink_l');
          const blinkRightIndex = _getBlendShapeIndexForPresetName('blink_r');
          const aIndex = _getBlendShapeIndexForPresetName('a');
          const eIndex = _getBlendShapeIndexForPresetName('e');
          const iIndex = _getBlendShapeIndexForPresetName('i');
          const oIndex = _getBlendShapeIndexForPresetName('o');
          const uIndex = _getBlendShapeIndexForPresetName('u');
          const neutralIndex = _getBlendShapeIndexForPresetName('neutral');
          const angryIndex = _getBlendShapeIndexForPresetName('angry');
          const funIndex = _getBlendShapeIndexForPresetName('fun');
          const joyIndex = _getBlendShapeIndexForPresetName('joy');
          const sorrowIndex = _getBlendShapeIndexForPresetName('sorrow');
          // const surprisedIndex = _getBlendShapeIndexForName('surprised');
          // const extraIndex = _getBlendShapeIndexForName('extra');
          return [
            morphTargetInfluences,
            blinkLeftIndex,
            blinkRightIndex,
            aIndex,
            eIndex,
            iIndex,
            oIndex,
            uIndex,
            neutralIndex,
            angryIndex,
            funIndex,
            joyIndex,
            sorrowIndex,
            // surprisedIndex,
            // extraIndex,
          ];
        } else {
          return null;
        }
      });
    } else {
      this.skinnedMeshesVisemeMappings = [];
    }

    this.microphoneWorker = null;
    this.volume = -1;
    
    this.now = 0;

    this.shoulderTransforms.Start();
    this.legsManager.Start();

    if (options.top !== undefined) {
      this.setTopEnabled(!!options.top);
    }
    if (options.bottom !== undefined) {
      this.setBottomEnabled(!!options.bottom);
    }

    /* this.decapitated = false;
    if (options.decapitate) {
      if (springBoneManagerPromise) {
        springBoneManagerPromise.then(() => {
          this.decapitate();
        });
      } else {
        this.decapitate();
      }
    } */

    this.animationMappings = animationMappingConfig.map(animationMapping => {
      animationMapping = animationMapping.clone();
      const isPosition = /\.position$/.test(animationMapping.animationTrackName);
      animationMapping.dst = this.modelBoneOutputs[animationMapping.boneName][isPosition ? 'position' : 'quaternion'];
      animationMapping.lerpFn = _getLerpFn(isPosition);
      return animationMapping;
    });

    // shared state
    this.direction = new THREE.Vector3();
    this.jumpState = false;
    this.jumpTime = NaN;
    this.flyState = false;
    this.flyTime = NaN;
    this.useTime = NaN;
    this.useAnimation = null;
    this.sitState = false;
    this.sitAnimation = null;
    // this.activateState = false;
    this.activateTime = 0;
    this.danceState = false;
    this.danceTime = 0;
    this.danceAnimation = null;
    this.throwState = null;
    this.throwTime = 0;
    this.crouchTime = crouchMaxTime;
    this.sitTarget = new THREE.Object3D();
    this.fakeSpeechValue = 0;
    this.fakeSpeechSmoothed = 0;
    this.narutoRunState = false;
    this.chargeJumpState = false;
    this.chargeJumpTime = 0;
    this.narutoRunTime = 0;
    // this.standChargeState = false;
    // this.standChargeTime = 0;
    this.fallLoopState = false;
    this.fallLoopTime = 0;
    // this.swordSideSlashState = false;
    // this.swordSideSlashTime = 0;
    // this.swordTopDownSlashState = false;
    // this.swordTopDownSlashTime = 0;
    this.aimTime = NaN;
    this.aimAnimation = null;
    // this.aimDirection = new THREE.Vector3();
    
    // internal state
    this.lastPosition = new THREE.Vector3();
    this.velocity = new THREE.Vector3();
    this.lastMoveTime = 0;
    this.lastIsBackward = false;
    this.lastBackwardFactor = 0;
    this.backwardAnimationSpec = null;
    this.startEyeTargetQuaternion = new THREE.Quaternion();
    this.lastNeedsEyeTarget = false;
    this.lastEyeTargetTime = 0;
  }
  static bindAvatar(object) {
    const model = object.scene;
    model.updateMatrixWorld(true);
    
    const skinnedMeshes = getSkinnedMeshes(object);
    const skeleton = getSkeleton(object);
    const boneMap = makeBoneMap(object);
    const tailBones = getTailBones(object);
    const modelBones = getModelBones(object);
    
    /* const retargetedAnimations = animations
      .filter(a => a.name === 'idle.fbx')
      .map(a => retargetAnimation(a, animationsBaseModel, object)); */
    
    const foundModelBones = {};
    for (const k in modelBones) {
      const v = modelBones[k];
      if (v) {
        foundModelBones[k] = v;
      }
    }

	  const armature = _findArmature(modelBones.Root);

    // const eyeDirection = getEyePosition(this.modelBones).sub(Head.getWorldPosition(new Vector3()));
    const leftArmDirection = modelBones.Left_wrist.getWorldPosition(new THREE.Vector3())
      .sub(modelBones.Head.getWorldPosition(new THREE.Vector3()));
	  const flipZ = leftArmDirection.x < 0;//eyeDirection.z < 0;
    const armatureDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(armature.quaternion);
    const flipY = armatureDirection.z < -0.5;
    const legDirection = new THREE.Vector3(0, 0, -1).applyQuaternion(
      modelBones.Left_leg.getWorldQuaternion(new THREE.Quaternion())
        .premultiply(armature.quaternion.clone().invert())
      );
    const flipLeg = legDirection.y < 0.5;
	  // console.log('flip', flipZ, flipY, flipLeg);
	  /* this.flipZ = flipZ;
	  this.flipY = flipY;
    this.flipLeg = flipLeg; */

    const armatureQuaternion = armature.quaternion.clone();
    const armatureMatrixInverse = armature.matrixWorld.clone().invert();
    armature.position.set(0, 0, 0);
    armature.quaternion.set(0, 0, 0, 1);
    armature.scale.set(1, 1, 1);
    armature.updateMatrix();

    /* const _findFingerBone = (r, left) => {
      const fingerTipBone = tailBones
        .filter(bone => r.test(bone.name) && _findClosestParentBone(bone, bone => bone === modelBones.Left_wrist || bone === modelBones.Right_wrist))
        .sort((a, b) => {
          const aName = a.name.replace(r, '');
          const aLeftBalance = _countCharacters(aName, /l/i) - _countCharacters(aName, /r/i);
          const bName = b.name.replace(r, '');
          const bLeftBalance = _countCharacters(bName, /l/i) - _countCharacters(bName, /r/i);
          if (!left) {
            return aLeftBalance - bLeftBalance;
          } else {
            return bLeftBalance - aLeftBalance;
          }
        });
      const fingerRootBone = fingerTipBone.length > 0 ? _findFurthestParentBone(fingerTipBone[0], bone => r.test(bone.name)) : null;
      return fingerRootBone;
    }; */
    /* const fingerBones = {
      left: {
        thumb: _findFingerBone(/thumb/gi, true),
        index: _findFingerBone(/index/gi, true),
        middle: _findFingerBone(/middle/gi, true),
        ring: _findFingerBone(/ring/gi, true),
        little: _findFingerBone(/little/gi, true) || _findFingerBone(/pinky/gi, true),
      },
      right: {
        thumb: _findFingerBone(/thumb/gi, false),
        index: _findFingerBone(/index/gi, false),
        middle: _findFingerBone(/middle/gi, false),
        ring: _findFingerBone(/ring/gi, false),
        little: _findFingerBone(/little/gi, false) || _findFingerBone(/pinky/gi, false),
      },
    };
    this.fingerBones = fingerBones; */

    const preRotations = {};
    const _ensurePrerotation = k => {
      const boneName = modelBones[k].name;
      if (!preRotations[boneName]) {
        preRotations[boneName] = new THREE.Quaternion();
      }
      return preRotations[boneName];
    };
    if (flipY) {
      _ensurePrerotation('Hips').premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI/2));
    }
    if (flipZ) {
      _ensurePrerotation('Hips').premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
    }
    if (flipLeg) {
      ['Left_leg', 'Right_leg'].forEach(k => {
        _ensurePrerotation(k).premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI/2));
      });
    }

    const _recurseBoneAttachments = o => {
      for (const child of o.children) {
        if (child.isBone) {
          _recurseBoneAttachments(child);
        } else {
          child.matrix
            .premultiply(localMatrix.compose(localVector.set(0, 0, 0), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI), localVector2.set(1, 1, 1)))
            .decompose(child.position, child.quaternion, child.scale);
        }
      }
    };
    _recurseBoneAttachments(modelBones['Hips']);

    const qrArm = flipZ ? modelBones.Left_arm : modelBones.Right_arm;
    const qrElbow = flipZ ? modelBones.Left_elbow : modelBones.Right_elbow;
    const qrWrist = flipZ ? modelBones.Left_wrist : modelBones.Right_wrist;
    const qr = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI/2)
      .premultiply(
        new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
          new THREE.Vector3(0, 0, 0),
          qrElbow.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse)
            .sub(qrArm.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse))
            .applyQuaternion(armatureQuaternion),
          new THREE.Vector3(0, 1, 0),
        ))
      );
    const qr2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI/2)
      .premultiply(
        new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
          new THREE.Vector3(0, 0, 0),
          qrWrist.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse)
            .sub(qrElbow.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse))
            .applyQuaternion(armatureQuaternion),
          new THREE.Vector3(0, 1, 0),
        ))
      );
    const qlArm = flipZ ? modelBones.Right_arm : modelBones.Left_arm;
    const qlElbow = flipZ ? modelBones.Right_elbow : modelBones.Left_elbow;
    const qlWrist = flipZ ? modelBones.Right_wrist : modelBones.Left_wrist;
    const ql = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI/2)
      .premultiply(
        new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
          new THREE.Vector3(0, 0, 0),
          qlElbow.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse)
            .sub(qlArm.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse))
            .applyQuaternion(armatureQuaternion),
          new THREE.Vector3(0, 1, 0),
        ))
      );
    const ql2 = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI/2)
      .premultiply(
        new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(
          new THREE.Vector3(0, 0, 0),
          qlWrist.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse)
            .sub(qlElbow.getWorldPosition(new THREE.Vector3()).applyMatrix4(armatureMatrixInverse))
            .applyQuaternion(armatureQuaternion),
          new THREE.Vector3(0, 1, 0),
        ))
      );

    _ensurePrerotation('Right_arm')
      .multiply(qr.clone().invert());
    _ensurePrerotation('Right_elbow')
      .multiply(qr.clone())
      .premultiply(qr2.clone().invert());
    _ensurePrerotation('Left_arm')
      .multiply(ql.clone().invert());
    _ensurePrerotation('Left_elbow')
      .multiply(ql.clone())
      .premultiply(ql2.clone().invert());

    _ensurePrerotation('Left_leg').premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0),  -Math.PI/2));
    _ensurePrerotation('Right_leg').premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0),  -Math.PI/2));

    for (const k in preRotations) {
      preRotations[k].invert();
    }
	  fixSkeletonZForward(armature.children[0], {
	    preRotations,
	  });
	  model.traverse(o => {
	    if (o.isSkinnedMesh) {
	      o.bind((o.skeleton.bones.length === skeleton.bones.length && o.skeleton.bones.every((bone, i) => bone === skeleton.bones[i])) ? skeleton : o.skeleton);
	    }
	  });
    if (flipY) {
      modelBones.Hips.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI/2));
    }
	  if (!flipZ) {
	    /* ['Left_arm', 'Right_arm'].forEach((name, i) => {
		    const bone = modelBones[name];
		    if (bone) {
		      bone.quaternion.premultiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), (i === 0 ? 1 : -1) * Math.PI*0.25));
		    }
		  }); */
		} else {
		  modelBones.Hips.quaternion.premultiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI));
		}
    modelBones.Right_arm.quaternion.premultiply(qr.clone().invert());
    modelBones.Right_elbow.quaternion
      .premultiply(qr)
      .premultiply(qr2.clone().invert());
    modelBones.Left_arm.quaternion.premultiply(ql.clone().invert());
    modelBones.Left_elbow.quaternion
      .premultiply(ql)
      .premultiply(ql2.clone().invert());
	  model.updateMatrixWorld(true);
    
    modelBones.Root.traverse(bone => {
      bone.initialQuaternion = bone.quaternion.clone();
    });
    
    return {
      skinnedMeshes,
      skeleton,
      modelBones,
      foundModelBones,
      flipZ,
      flipY,
      flipLeg,
      tailBones,
      armature,
      armatureQuaternion,
      armatureMatrixInverse,
      // retargetedAnimations,
    };
  }
  static applyModelBoneOutputs(modelBones, modelBoneOutputs, /*topEnabled,*/ bottomEnabled, lHandEnabled, rHandEnabled) {
    for (const k in modelBones) {
      const modelBone = modelBones[k];
      const modelBoneOutput = modelBoneOutputs[k];

      modelBone.position.copy(modelBoneOutput.position);
      modelBone.quaternion.multiplyQuaternions(
        modelBoneOutput.quaternion,
        modelBone.initialQuaternion
      );

      // if (topEnabled) {
        if (k === 'Left_wrist') {
          if (rHandEnabled) {
            modelBone.quaternion.multiply(leftRotation); // center
          }
        } else if (k === 'Right_wrist') {
          if (lHandEnabled) {
            modelBone.quaternion.multiply(rightRotation); // center
          }
        }
      // }
      if (bottomEnabled) {
        if (k === 'Left_ankle' || k === 'Right_ankle') {
          modelBone.quaternion.multiply(upRotation);
        }
      }
    }
    modelBones.Root.updateMatrixWorld();
  }
  static modelBoneRenames = {
    spine: 'Spine',
    chest: 'Chest',
    upperChest: 'UpperChest',
    neck: 'Neck',
    head: 'Head',

    leftShoulder: 'Right_shoulder',
    leftUpperArm: 'Right_arm',
    leftLowerArm: 'Right_elbow',
    leftHand: 'Right_wrist',
    leftThumb2: 'Right_thumb2',
    leftThumb1: 'Right_thumb1',
    leftThumb0: 'Right_thumb0',
    leftIndexFinger1: 'Right_indexFinger1',
    leftIndexFinger2: 'Right_indexFinger2',
    leftIndexFinger3: 'Right_indexFinger3',
    leftMiddleFinger1: 'Right_middleFinger1',
    leftMiddleFinger2: 'Right_middleFinger2',
    leftMiddleFinger3: 'Right_middleFinger3',
    leftRingFinger1: 'Right_ringFinger1',
    leftRingFinger2: 'Right_ringFinger2',
    leftRingFinger3: 'Right_ringFinger3',
    leftLittleFinger1: 'Right_littleFinger1',
    leftLittleFinger2: 'Right_littleFinger2',
    leftLittleFinger3: 'Right_littleFinger3',

    rightShoulder: 'Left_shoulder',
    rightUpperArm: 'Left_arm',
    rightLowerArm: 'Left_elbow',
    rightHand: 'Left_wrist',
    rightThumb2: 'Left_thumb2',
    rightThumb1: 'Left_thumb1',
    rightThumb0: 'Left_thumb0',
    rightIndexFinger1: 'Left_indexFinger1',
    rightIndexFinger2: 'Left_indexFinger2',
    rightIndexFinger3: 'Left_indexFinger3',
    rightMiddleFinger1: 'Left_middleFinger1',
    rightMiddleFinger2: 'Left_middleFinger2',
    rightMiddleFinger3: 'Left_middleFinger3',
    rightRingFinger1: 'Left_ringFinger1',
    rightRingFinger2: 'Left_ringFinger2',
    rightRingFinger3: 'Left_ringFinger3',
    rightLittleFinger1: 'Left_littleFinger1',
    rightLittleFinger2: 'Left_littleFinger2',
    rightLittleFinger3: 'Left_littleFinger3',

    leftUpperLeg: 'Right_leg',
    leftLowerLeg: 'Right_knee',
    leftFoot: 'Right_ankle',

    rightUpperLeg: 'Left_leg',
    rightLowerLeg: 'Left_knee',
    rightFoot: 'Left_ankle',

    leftToe: 'Left_toe',
    rightToe: 'Right_toe'
  }
  initializeBonePositions(setups) {
    this.shoulderTransforms.hips.position.copy(setups.hips);
    this.shoulderTransforms.spine.position.copy(setups.spine);
    this.shoulderTransforms.chest.position.copy(setups.chest);
    if (setups.upperChest) this.shoulderTransforms.upperChest.position.copy(setups.upperChest);
    this.shoulderTransforms.neck.position.copy(setups.neck);
    this.shoulderTransforms.head.position.copy(setups.head);
    // this.shoulderTransforms.eyes.position.copy(setups.eyes);
    if (setups.eyel) this.shoulderTransforms.eyel.position.copy(setups.eyel);
    if (setups.eyer) this.shoulderTransforms.eyer.position.copy(setups.eyer);

    if (setups.leftShoulder) this.shoulderTransforms.leftShoulderAnchor.position.copy(setups.leftShoulder);
    this.shoulderTransforms.leftArm.upperArm.position.copy(setups.leftUpperArm);
    this.shoulderTransforms.leftArm.lowerArm.position.copy(setups.leftLowerArm);
    this.shoulderTransforms.leftArm.hand.position.copy(setups.leftHand);
    if (setups.leftThumb2) this.shoulderTransforms.leftArm.thumb2.position.copy(setups.leftThumb2);
    if (setups.leftThumb1) this.shoulderTransforms.leftArm.thumb1.position.copy(setups.leftThumb1);
    if (setups.leftThumb0) this.shoulderTransforms.leftArm.thumb0.position.copy(setups.leftThumb0);
    if (setups.leftIndexFinger3) this.shoulderTransforms.leftArm.indexFinger3.position.copy(setups.leftIndexFinger3);
    if (setups.leftIndexFinger2) this.shoulderTransforms.leftArm.indexFinger2.position.copy(setups.leftIndexFinger2);
    if (setups.leftIndexFinger1) this.shoulderTransforms.leftArm.indexFinger1.position.copy(setups.leftIndexFinger1);
    if (setups.leftMiddleFinger3) this.shoulderTransforms.leftArm.middleFinger3.position.copy(setups.leftMiddleFinger3);
    if (setups.leftMiddleFinger2) this.shoulderTransforms.leftArm.middleFinger2.position.copy(setups.leftMiddleFinger2);
    if (setups.leftMiddleFinger1) this.shoulderTransforms.leftArm.middleFinger1.position.copy(setups.leftMiddleFinger1);
    if (setups.leftRingFinger3) this.shoulderTransforms.leftArm.ringFinger3.position.copy(setups.leftRingFinger3);
    if (setups.leftRingFinger2) this.shoulderTransforms.leftArm.ringFinger2.position.copy(setups.leftRingFinger2);
    if (setups.leftRingFinger1) this.shoulderTransforms.leftArm.ringFinger1.position.copy(setups.leftRingFinger1);
    if (setups.leftLittleFinger3) this.shoulderTransforms.leftArm.littleFinger3.position.copy(setups.leftLittleFinger3);
    if (setups.leftLittleFinger2) this.shoulderTransforms.leftArm.littleFinger2.position.copy(setups.leftLittleFinger2);
    if (setups.leftLittleFinger1) this.shoulderTransforms.leftArm.littleFinger1.position.copy(setups.leftLittleFinger1);

    if (setups.rightShoulder) this.shoulderTransforms.rightShoulderAnchor.position.copy(setups.rightShoulder);
    this.shoulderTransforms.rightArm.upperArm.position.copy(setups.rightUpperArm);
    this.shoulderTransforms.rightArm.lowerArm.position.copy(setups.rightLowerArm);
    this.shoulderTransforms.rightArm.hand.position.copy(setups.rightHand);
    if (setups.rightThumb2) this.shoulderTransforms.rightArm.thumb2.position.copy(setups.rightThumb2);
    if (setups.rightThumb1) this.shoulderTransforms.rightArm.thumb1.position.copy(setups.rightThumb1);
    if (setups.rightThumb0) this.shoulderTransforms.rightArm.thumb0.position.copy(setups.rightThumb0);
    if (setups.rightIndexFinger3) this.shoulderTransforms.rightArm.indexFinger3.position.copy(setups.rightIndexFinger3);
    if (setups.rightIndexFinger2) this.shoulderTransforms.rightArm.indexFinger2.position.copy(setups.rightIndexFinger2);
    if (setups.rightIndexFinger1) this.shoulderTransforms.rightArm.indexFinger1.position.copy(setups.rightIndexFinger1);
    if (setups.rightMiddleFinger3) this.shoulderTransforms.rightArm.middleFinger3.position.copy(setups.rightMiddleFinger3);
    if (setups.rightMiddleFinger2) this.shoulderTransforms.rightArm.middleFinger2.position.copy(setups.rightMiddleFinger2);
    if (setups.rightMiddleFinger1) this.shoulderTransforms.rightArm.middleFinger1.position.copy(setups.rightMiddleFinger1);
    if (setups.rightRingFinger3) this.shoulderTransforms.rightArm.ringFinger3.position.copy(setups.rightRingFinger3);
    if (setups.rightRingFinger2) this.shoulderTransforms.rightArm.ringFinger2.position.copy(setups.rightRingFinger2);
    if (setups.rightRingFinger1) this.shoulderTransforms.rightArm.ringFinger1.position.copy(setups.rightRingFinger1);
    if (setups.rightLittleFinger3) this.shoulderTransforms.rightArm.littleFinger3.position.copy(setups.rightLittleFinger3);
    if (setups.rightLittleFinger2) this.shoulderTransforms.rightArm.littleFinger2.position.copy(setups.rightLittleFinger2);
    if (setups.rightLittleFinger1) this.shoulderTransforms.rightArm.littleFinger1.position.copy(setups.rightLittleFinger1);

    this.legsManager.leftLeg.upperLeg.position.copy(setups.leftUpperLeg);
    this.legsManager.leftLeg.lowerLeg.position.copy(setups.leftLowerLeg);
    this.legsManager.leftLeg.foot.position.copy(setups.leftFoot);
    if (setups.leftToe) this.legsManager.leftLeg.toe.position.copy(setups.leftToe);

    this.legsManager.rightLeg.upperLeg.position.copy(setups.rightUpperLeg);
    this.legsManager.rightLeg.lowerLeg.position.copy(setups.rightLowerLeg);
    this.legsManager.rightLeg.foot.position.copy(setups.rightFoot);
    if (setups.rightToe) this.legsManager.rightLeg.toe.position.copy(setups.rightToe);

    this.shoulderTransforms.root.updateMatrixWorld();
  }
  setHandEnabled(i, enabled) {
    this.shoulderTransforms.handsEnabled[i] = enabled;
  }
  getHandEnabled(i) {
    return this.shoulderTransforms.handsEnabled[i];
  }
  setTopEnabled(enabled) {
    this.shoulderTransforms.enabled = enabled;
  }
  getTopEnabled() {
    return this.shoulderTransforms.enabled;
  }
  setBottomEnabled(enabled) {
    this.legsManager.enabled = enabled;
  }
  getBottomEnabled() {
    return this.legsManager.enabled;
  }
  getAngle() {
    localEuler.setFromRotationMatrix(
      localMatrix.lookAt(
        localVector.set(0, 0, 0),
        this.direction,
        localVector2.set(0, 1, 0)
      ),
      'YXZ'
    );
    return localEuler.y;
  }
  update(timeDiff) {
    const {now} = this;
    const timeDiffS = timeDiff / 1000;
    const currentSpeed = localVector.set(this.velocity.x, 0, this.velocity.z).length();
    
    // walk = 0.29
    // run = 0.88
    // walk backward = 0.20
    // run backward = 0.61
    const idleSpeed = 0;
    const walkSpeed = 0.25;
    const runSpeed = 0.7;
    const idleWalkFactor = Math.min(Math.max((currentSpeed - idleSpeed) / (walkSpeed - idleSpeed), 0), 1);
    const walkRunFactor = Math.min(Math.max((currentSpeed - walkSpeed) / (runSpeed - walkSpeed), 0), 1);
    // console.log('current speed', currentSpeed, idleWalkFactor, walkRunFactor);

    const _updatePosition = () => {
      const currentPosition = this.inputs.hmd.position;
      const currentQuaternion = this.inputs.hmd.quaternion;
      
      const positionDiff = localVector.copy(this.lastPosition)
        .sub(currentPosition)
        .divideScalar(timeDiffS)
        .multiplyScalar(0.1);
      localEuler.setFromQuaternion(currentQuaternion, 'YXZ');
      localEuler.x = 0;
      localEuler.z = 0;
      localEuler.y += Math.PI;
      localEuler2.set(-localEuler.x, -localEuler.y, -localEuler.z, localEuler.order);
      positionDiff.applyEuler(localEuler2);
      this.velocity.copy(positionDiff);
      this.lastPosition.copy(currentPosition);
      this.direction.copy(positionDiff).normalize();

      if (this.velocity.length() > maxIdleVelocity) {
        this.lastMoveTime = now;
      }
    };
    _updatePosition();
    
    const _applyAnimation = () => {
      const runSpeed = 0.5;
      const angle = this.getAngle();
      const timeSeconds = now/1000;
      
      const _getAnimationKey = crouchState => {
        if (crouchState) {
          return 'crouch';
        } else {
          if (currentSpeed >= runSpeed) {
            return 'run';
          } else {
            return 'walk';
          }
        }
      };
      const _getClosest2AnimationAngles = key => {
        const animationAngleArray = animationsAngleArrays[key];
        animationAngleArray.sort((a, b) => {
          const aDistance = Math.abs(angleDifference(angle, a.angle));
          const bDistance = Math.abs(angleDifference(angle, b.angle));
          return aDistance - bDistance;
        });
        const closest2AnimationAngles = animationAngleArray.slice(0, 2);
        return closest2AnimationAngles;
      };
      const _getMirrorAnimationAngles = (animationAngles, key) => {
        const animations = animationAngles.map(({animation}) => animation);
        const animationAngleArrayMirror = animationsAngleArraysMirror[key];
        
        const backwardIndex = animations.findIndex(a => a.isBackward);
        if (backwardIndex !== -1) {
          // const backwardAnimationAngle = animationAngles[backwardIndex];
          // const angleToBackwardAnimation = Math.abs(angleDifference(angle, backwardAnimationAngle.angle));
          // if (angleToBackwardAnimation < Math.PI * 0.3) {
            const sideIndex = backwardIndex === 0 ? 1 : 0;
            const wrongAngle = animationAngles[sideIndex].angle;
            const newAnimationAngle = animationAngleArrayMirror.find(animationAngle => animationAngle.matchAngle === wrongAngle);
            animationAngles = animationAngles.slice();
            animationAngles[sideIndex] = newAnimationAngle;
            // animations[sideIndex] = newAnimationAngle.animation;
            // return {
              // return animationAngles;
              // angleToBackwardAnimation,
            // };
          // }
        }
        // return {
          return animationAngles;
          // angleToBackwardAnimation: Infinity,
        // ;
      };
      const _getAngleToBackwardAnimation = animationAngles => {
        const animations = animationAngles.map(({animation}) => animation);
        
        const backwardIndex = animations.findIndex(a => a.isBackward);
        if (backwardIndex !== -1) {
          const backwardAnimationAngle = animationAngles[backwardIndex];
          const angleToBackwardAnimation = Math.abs(angleDifference(angle, backwardAnimationAngle.angle));
          return angleToBackwardAnimation;
        } else {
          return Infinity;
        }
      };
      const _getIdleAnimation = key => animationsIdleArrays[key].animation;
      /* const _getIdleAnimation = key => {
        if (key === 'walk' || key === 'run') {
          const name = animationsIdleArrays[key].name;
          return this.retargetedAnimations.find(a => a.name === name);
        } else {
          return animationsIdleArrays[key].animation;
        }
      }; */
      const _get7wayBlend = (
        horizontalWalkAnimationAngles,
        horizontalWalkAnimationAnglesMirror,
        horizontalRunAnimationAngles,
        horizontalRunAnimationAnglesMirror,
        idleAnimation,
        // mirrorFactor,
        // angleFactor,
        // walkRunFactor,
        // idleWalkFactor,
        k,
        lerpFn,
        isPosition,
        target
      ) => {
        // WALK
        // normal horizontal walk blend
        {
          const t1 = timeSeconds % horizontalWalkAnimationAngles[0].animation.duration;
          const src1 = horizontalWalkAnimationAngles[0].animation.interpolants[k];
          const v1 = src1.evaluate(t1);

          const t2 = timeSeconds % horizontalWalkAnimationAngles[1].animation.duration;
          const src2 = horizontalWalkAnimationAngles[1].animation.interpolants[k];
          const v2 = src2.evaluate(t2);
          
          lerpFn
            .call(
              localQuaternion3.fromArray(v2),
              localQuaternion4.fromArray(v1),
              angleFactor
            );
        }
          
        // mirror horizontal blend (backwards walk)
        {
          const t1 = timeSeconds % horizontalWalkAnimationAnglesMirror[0].animation.duration;
          const src1 = horizontalWalkAnimationAnglesMirror[0].animation.interpolants[k];
          const v1 = src1.evaluate(t1);

          const t2 = timeSeconds % horizontalWalkAnimationAnglesMirror[1].animation.duration;
          const src2 = horizontalWalkAnimationAnglesMirror[1].animation.interpolants[k];
          const v2 = src2.evaluate(t2);

          lerpFn
            .call(
              localQuaternion4.fromArray(v2),
              localQuaternion5.fromArray(v1),
              angleFactor
            );
        }

        // blend mirrors together to get a smooth walk
        lerpFn
          .call(
            localQuaternion5.copy(localQuaternion3), // Result is in localQuaternion5
            localQuaternion4,
            mirrorFactor
          );

        // RUN
        // normal horizontal run blend
        {
          const t1 = timeSeconds % horizontalRunAnimationAngles[0].animation.duration;
          const src1 = horizontalRunAnimationAngles[0].animation.interpolants[k];
          const v1 = src1.evaluate(t1);

          const t2 = timeSeconds % horizontalRunAnimationAngles[1].animation.duration;
          const src2 = horizontalRunAnimationAngles[1].animation.interpolants[k];
          const v2 = src2.evaluate(t2);
          
          lerpFn
            .call(
              localQuaternion3.fromArray(v2),
              localQuaternion4.fromArray(v1),
              angleFactor
            );
        }
          
        // mirror horizontal blend (backwards run)
        {
          const t1 = timeSeconds % horizontalRunAnimationAnglesMirror[0].animation.duration;
          const src1 = horizontalRunAnimationAnglesMirror[0].animation.interpolants[k];
          const v1 = src1.evaluate(t1);

          const t2 = timeSeconds % horizontalRunAnimationAnglesMirror[1].animation.duration;
          const src2 = horizontalRunAnimationAnglesMirror[1].animation.interpolants[k];
          const v2 = src2.evaluate(t2);

          lerpFn
            .call(
              localQuaternion4.fromArray(v2),
              localQuaternion6.fromArray(v1),
              angleFactor
            );
        }

        // blend mirrors together to get a smooth run
        lerpFn
          .call(
            localQuaternion6.copy(localQuaternion3), // Result is in localQuaternion6
            localQuaternion4,
            mirrorFactor
          );

        // Blend walk/run
        lerpFn
          .call(
            localQuaternion4.copy(localQuaternion5), // Result is in localQuaternion4
            localQuaternion6,
            walkRunFactor
          );

        // blend the smooth walk/run with idle
        {
          const timeSinceLastMove = now - this.lastMoveTime;
          const timeSinceLastMoveSeconds = timeSinceLastMove / 1000;
          const t3 = timeSinceLastMoveSeconds % idleAnimation.duration;
          const src3 = idleAnimation.interpolants[k];
          const v3 = src3.evaluate(t3);

          target.fromArray(v3);
          if (isPosition) {
            // target.x = 0;
            // target.z = 0;

            localQuaternion4.x = 0;
            localQuaternion4.z = 0;
          }

          lerpFn
            .call(
              target,
              localQuaternion4,
              idleWalkFactor
            );
        }
      };
      
      // stand
      const key = _getAnimationKey(false);
      const keyWalkAnimationAngles = _getClosest2AnimationAngles('walk');
      const keyWalkAnimationAnglesMirror = _getMirrorAnimationAngles(keyWalkAnimationAngles, 'walk');

      const keyRunAnimationAngles = _getClosest2AnimationAngles('run');
      const keyRunAnimationAnglesMirror = _getMirrorAnimationAngles(keyRunAnimationAngles, 'run');
      
      const idleAnimation = _getIdleAnimation('walk');

      // walk sound effect
      {
        const soundManager = metaversefile.useSoundManager();
        const currAniTime = timeSeconds % idleAnimation.duration;

        if (currentSpeed > 0.1) {
          if (key === 'walk') {
            if (currAniTime > 0.26 && currAniTime < 0.4)
              soundManager.playStepSound(1);
            if (currAniTime > 0.76 && currAniTime < 0.9)
              soundManager.playStepSound(2);
            if (currAniTime > 1.26 && currAniTime < 1.4)
              soundManager.playStepSound(3);
            if (currAniTime > 1.76 && currAniTime < 1.9)
              soundManager.playStepSound(4);
            if (currAniTime > 2.26 && currAniTime < 2.5)
              soundManager.playStepSound(5);
          }
          if (key === 'run') {
            if (currAniTime > 0.16 && currAniTime < 0.3)
              soundManager.playStepSound(1);
            if (currAniTime > 0.43 && currAniTime < 0.45)
              soundManager.playStepSound(2);
            if (currAniTime > 0.693 && currAniTime < 0.8)
              soundManager.playStepSound(3);
            if (currAniTime > 0.963 && currAniTime < 1.1)
              soundManager.playStepSound(4);
            if (currAniTime > 1.226 && currAniTime < 1.3)
              soundManager.playStepSound(5);
            if (currAniTime > 1.496 && currAniTime < 1.6)
              soundManager.playStepSound(6);
            if (currAniTime > 1.759 && currAniTime < 1.9)
              soundManager.playStepSound(7);
            if (currAniTime > 2.029 && currAniTime < 2.1)
              soundManager.playStepSound(8);
            if (currAniTime > 2.292 && currAniTime < 2.4)
              soundManager.playStepSound(9);
          }
        }
      }
      
      // crouch
      // const keyOther = _getAnimationKey(true);
      const keyAnimationAnglesOther = _getClosest2AnimationAngles('crouch');
      const keyAnimationAnglesOtherMirror = _getMirrorAnimationAngles(keyAnimationAnglesOther, 'crouch');
      const idleAnimationOther = _getIdleAnimation('crouch');
      
      const angleToClosestAnimation = Math.abs(angleDifference(angle, keyWalkAnimationAnglesMirror[0].angle));
      const angleBetweenAnimations = Math.abs(angleDifference(keyWalkAnimationAnglesMirror[0].angle, keyWalkAnimationAnglesMirror[1].angle));
      const angleFactor = (angleBetweenAnimations - angleToClosestAnimation) / angleBetweenAnimations;
      const crouchFactor = Math.min(Math.max(1 - (this.crouchTime / crouchMaxTime), 0), 1);
      const isBackward = _getAngleToBackwardAnimation(keyWalkAnimationAnglesMirror) < Math.PI*0.4;
      if (isBackward !== this.lastIsBackward) {
        this.backwardAnimationSpec = {
          startFactor: this.lastBackwardFactor,
          endFactor: isBackward ? 1 : 0,
          startTime: now,
          endTime: now + 150,
        };
        this.lastIsBackward = isBackward;
      }
      let mirrorFactor;
      if (this.backwardAnimationSpec) {
        const f = (now - this.backwardAnimationSpec.startTime) / (this.backwardAnimationSpec.endTime - this.backwardAnimationSpec.startTime);
        if (f >= 1) {
          mirrorFactor = this.backwardAnimationSpec.endFactor;
          this.backwardAnimationSpec = null;
        } else {
          mirrorFactor = this.backwardAnimationSpec.startFactor +
            Math.pow(
              f,
              0.5
            ) * (this.backwardAnimationSpec.endFactor - this.backwardAnimationSpec.startFactor);
        }
      } else {
        mirrorFactor = isBackward ? 1 : 0;
      }
      this.lastBackwardFactor = mirrorFactor;

      const _getHorizontalBlend = (k, lerpFn, isPosition, target) => {
        _get7wayBlend(
          keyWalkAnimationAngles,
          keyWalkAnimationAnglesMirror,
          keyRunAnimationAngles,
          keyRunAnimationAnglesMirror,
          idleAnimation,
          // mirrorFactor,
          // angleFactor,
          // walkRunFactor,
          // idleWalkFactor,
          k,
          lerpFn,
          isPosition,
          localQuaternion
        );
        _get7wayBlend(
          keyAnimationAnglesOther,
          keyAnimationAnglesOtherMirror,
          keyAnimationAnglesOther,
          keyAnimationAnglesOtherMirror,
          idleAnimationOther,
          // mirrorFactor,
          // angleFactor,
          // walkRunFactor,
          // idleWalkFactor,
          k,
          lerpFn,
          isPosition,
          localQuaternion2
        );
        
        //_get5wayBlend(keyAnimationAnglesOther, keyAnimationAnglesOtherMirror, idleAnimationOther, mirrorFactor, angleFactor, speedFactor, k, lerpFn, localQuaternion2);
        
        lerpFn
          .call(
            target.copy(localQuaternion),
            localQuaternion2,
            crouchFactor
          );

      };
      const _clearXZ = (dst, isPosition) => {
        if (isPosition) {
          dst.x = 0;
          dst.z = 0;
        }
      };
      const _getApplyFn = () => {
        if (this.jumpState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
            } = spec;
            // console.log('JumpState', spec)

            const t2 = this.jumpTime/1000 * 0.6 + 0.7;
            const src2 = jumpAnimation.interpolants[k];
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }
        if (this.sitState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
            } = spec;
            
            const sitAnimation = sitAnimations[this.sitAnimation || defaultSitAnimation];
            const src2 = sitAnimation.interpolants[k];
            const v2 = src2.evaluate(1);

            dst.fromArray(v2);
          }
        }
        if (this.narutoRunState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
              isPosition,
            } = spec;
            
            const narutoRunAnimation = narutoRunAnimations[defaultNarutoRunAnimation];
            const src2 = narutoRunAnimation.interpolants[k];
            const t2 = (this.narutoRunTime / 1000 * 4) % narutoRunAnimation.duration;
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);

            _clearXZ(dst, isPosition);
          };
        }

        if (this.danceState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
            } = spec;

            const danceAnimation = danceAnimations[this.danceAnimation || defaultDanceAnimation];
            const src2 = danceAnimation.interpolants[k];
            const t2 = (this.danceTime/1000) % danceAnimation.duration;
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }

        /* if (this.standChargeState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              isTop,
            } = spec;

            const t2 = (this.standChargeTime/1000) ;
            const src2 = standCharge.interpolants[k];
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }
        if (this.swordSideSlashState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              isTop,
            } = spec;

            const t2 = (this.swordSideSlashTime/1000) ;
            const src2 = swordSideSlash.interpolants[k];
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }
        if (this.swordTopDownSlashState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              isTop,
            } = spec;

            const t2 = (this.swordTopDownSlashTime/1000) ;
            const src2 = swordTopDownSlash.interpolants[k];
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        } */
        if (this.fallLoopState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
            } = spec;

            const t2 = (this.fallLoopTime/1000) ;
            const src2 = fallLoop.interpolants[k];
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }
        /* if (this.chargeJumpState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              isTop,
            } = spec;

            
            const t2 = (this.chargeJumpTime/1000) ;
            const src2 = chargeJump.interpolants[k];
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        } */
        if (this.jumpState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
            } = spec;
            

            const throwAnimation = throwAnimations[this.throwAnimation || defaultThrowAnimation];
            const danceAnimation = danceAnimations[0];
            const src2 = throwAnimation.interpolants[k];
            const t2 = (this.danceTime/1000) ;
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }
        if (this.throwState) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
            } = spec;
            
            const throwAnimation = throwAnimations[this.throwAnimation || defaultThrowAnimation];
            const src2 = throwAnimation.interpolants[k];
            const t2 = this.throwTime/1000;
            const v2 = src2.evaluate(t2);

            dst.fromArray(v2);
          };
        }
        const _handleDefault = spec => {
          const {
            animationTrackName: k,
            dst,
            // isTop,
            lerpFn,
            isPosition,
          } = spec;
          
          _getHorizontalBlend(k, lerpFn, isPosition, dst);
        };
        // console.log('got aim time', this.useAnimation, this.useTime, this.aimAnimation, this.aimTime);
        if (this.useAnimation) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
              isPosition,
            } = spec;
            
            const isCombo = Array.isArray(this.useAnimation);
            const useAnimationName = isCombo ? this.useAnimation[this.useAnimationIndex] : this.useAnimation;
            const useAnimation = (useAnimationName && useAnimations[useAnimationName]);
            _handleDefault(spec);
            const t2 = (() => {
              if (isCombo) {
                return Math.min(this.useTime/1000, useAnimation.duration);
              } else {
                return (this.useTime/1000) % useAnimation.duration;
              }
            })();
            if (!isPosition) {
              if (useAnimation) {
                const src2 = useAnimation.interpolants[k];
                const v2 = src2.evaluate(t2);

                const idleAnimation = _getIdleAnimation('walk');
                const t3 = 0;
                const src3 = idleAnimation.interpolants[k];
                const v3 = src3.evaluate(t3);

                dst
                  .premultiply(localQuaternion2.fromArray(v3).invert())
                  .premultiply(localQuaternion2.fromArray(v2));
              } /* else {
                _handleDefault(spec);
              } */
            } else {
              const src2 = useAnimation.interpolants[k];
              const v2 = src2.evaluate(t2);
              localVector2.fromArray(v2);
              _clearXZ(localVector2, isPosition);

              const idleAnimation = _getIdleAnimation('walk');
              const t3 = 0;
              const src3 = idleAnimation.interpolants[k];
              const v3 = src3.evaluate(t3);
              localVector3.fromArray(v3);
              
              dst
                .sub(localVector3)
                .add(localVector2);
            }
          };
        } else if (this.aimAnimation) {
          return spec => {
            const {
              animationTrackName: k,
              dst,
              // isTop,
              isPosition,
            } = spec;
            
            const aimAnimation = (this.aimAnimation && aimAnimations[this.aimAnimation]);
            _handleDefault(spec);
            const t2 = (this.aimTime/aimMaxTime) % aimAnimation.duration;
            if (!isPosition) {
              if (aimAnimation) {
                const src2 = aimAnimation.interpolants[k];
                const v2 = src2.evaluate(t2);

                const idleAnimation = _getIdleAnimation('walk');
                const t3 = 0;
                const src3 = idleAnimation.interpolants[k];
                const v3 = src3.evaluate(t3);
                
                dst
                  .premultiply(localQuaternion2.fromArray(v3).invert())
                  .premultiply(localQuaternion2.fromArray(v2));
              } /* else {
                _handleDefault(spec);
              } */
            } else {
              const src2 = aimAnimation.interpolants[k];
              const v2 = src2.evaluate(t2);

              const idleAnimation = _getIdleAnimation('walk');
              const t3 = 0;
              const src3 = idleAnimation.interpolants[k];
              const v3 = src3.evaluate(t3);

              dst
                .sub(localVector2.fromArray(v3))
                .add(localVector2.fromArray(v2));
            }
          };
        }
        return _handleDefault;
      };
      const applyFn = _getApplyFn();
      const _blendFly = spec => {
        const {
          animationTrackName: k,
          dst,
          // isTop,
          lerpFn,
        } = spec;
        
        if (this.flyState || (this.flyTime >= 0 && this.flyTime < 1000)) {
          const t2 = this.flyTime/1000;
          const f = this.flyState ? Math.min(cubicBezier(t2), 1) : (1 - Math.min(cubicBezier(t2), 1));
          const src2 = floatAnimation.interpolants[k];
          const v2 = src2.evaluate(t2 % floatAnimation.duration);

          lerpFn
            .call(
              dst,
              localQuaternion.fromArray(v2),
              f
            );
        }
      };

      const _blendActivateAction = spec => {
        const {
          animationTrackName: k,
          dst,
          // isTop,
          lerpFn,
        } = spec;
        
        if (this.activateTime > 0) {
          
            const localPlayer = metaversefile.useLocalPlayer();

            let defaultAnimation = "grab_forward";

            if (localPlayer.getAction('activate').animationName) {
              defaultAnimation = localPlayer.getAction('activate').animationName;
            }

            const activateAnimation = activateAnimations[defaultAnimation].animation;
            const src2 = activateAnimation.interpolants[k];
            const t2 = ((this.activateTime / 1000) * activateAnimations[defaultAnimation].speedFactor) % activateAnimation.duration;
            const v2 = src2.evaluate(t2);

            const f = this.activateTime > 0 ? Math.min(cubicBezier(t2), 1) : (1 - Math.min(cubicBezier(t2), 1));

            lerpFn
              .call(
                dst,
                localQuaternion.fromArray(v2),
                f
              );
        }
      };
      /* const _blendNoise = spec => {
        
      }; */

      for (const spec of this.animationMappings) {
        const {
          animationTrackName: k,
          dst,
          // isTop,
          isPosition,
        } = spec;
        
        applyFn(spec);
        // _blendNoise(spec);
        _blendFly(spec);
        _blendActivateAction(spec);
        
        // ignore all animation position except y
        if (isPosition) {
          if (!this.jumpState) {
            // animations position is height-relative
            dst.y *= this.height; // XXX this could be made perfect by measuring from foot to hips instead
          } else {
            // force height in the jump case to overide the animation
            dst.y = this.height * 0.55;
          }
        }
      }
    };
    _applyAnimation();

    const noiseAnimation = animations.find(a => a.name === 't-pose_rot.fbx');
    const noiseTime = (now/1000) % noiseAnimation.duration;
    const _overwritePose = pose => {
      for (const spec of this.animationMappings) {
        const {
          animationTrackName: k,
          dst,
          // isTop,
          isPosition,
        } = spec;

        const boneName = animationBoneToModelBone[spec.animationTrackName.replace(/\.[\s\S]*$/, '')];
        const srcBone = pose[boneName];
        if (srcBone) {
          if (isPosition) {
            dst.x = 0;
            dst.z = 0;
          } else {
            dst.copy(srcBone.quaternion);
          }
        } else {
          // console.log('no source bone', boneName);
          if (isPosition) {
            dst.set(0, 0, 0);
          } else {
            dst.set(0, 0, 0, 1);
          }
        }

        if (!isPosition) {
          const src2 = noiseAnimation.interpolants[k];
          const v2 = src2.evaluate(noiseTime);
          dst.multiply(localQuaternion.fromArray(v2));
        }
      }

      /* this.modelBoneOutputs.Left_arm.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          -Math.PI * 0.25
        )
      );
      this.modelBoneOutputs.Right_arm.quaternion.multiply(
        new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 0, 1),
          Math.PI * 0.25 
        )
      ); */
    };
    if (mmdAnimation && this.object.asset.generator === 'UniGLTF-1.28') {
      _overwritePose(mmdAnimation);

      const renderer = getRenderer();
      const size = renderer.getSize(new THREE.Vector2());
      // a Vector2 representing the largest power of two less than or equal to the current canvas size
      const sizePowerOfTwo = new THREE.Vector2(
        Math.pow(2, Math.floor(Math.log(size.x) / Math.log(2))),
        Math.pow(2, Math.floor(Math.log(size.y) / Math.log(2))),
      );
      const sideSize = 512;
      if (sizePowerOfTwo.x < sideSize || sizePowerOfTwo.y < sideSize) {
        throw new Error('renderer is too small');
      }

      // push old state
      const oldParent = this.model.parent;
      const oldRenderTarget = renderer.getRenderTarget();
      const oldViewport = renderer.getViewport(new THREE.Vector4());
      const oldWorldLightParent = world.lights.parent;

      // setup
      const sideAvatarScene = new THREE.Scene();
      sideAvatarScene.overrideMaterial = outlineMaterial;

      const sideScene = new THREE.Scene();
      sideScene.add(bgMesh1);
      sideScene.add(bgMesh2);
      sideScene.add(bgMesh3);
      sideScene.add(bgMesh4);
      sideScene.add(bgMesh5);

      const sideCamera = new THREE.PerspectiveCamera();
      sideCamera.position.y = 1.2;
      sideCamera.position.z = 2;
      sideCamera.updateMatrixWorld();

      // console.log('got object', this.object, this.model);

      // render
      const pixelRatio = renderer.getPixelRatio();
      const numCanvases = 1;
      for (let i = 0; i < numCanvases; i++) {
        const x = i % sideSize;
        const y = Math.floor(i / sideSize);
        const dx = x * sideSize;
        const dy = y * sideSize;
        
        let mmdCanvas = mmdCanvases[i];
        let ctx = mmdCanvasContexts[i];
        if (!mmdCanvas) {
          mmdCanvas = document.createElement('canvas');
          mmdCanvas.width = sideSize;
          mmdCanvas.height = sideSize;
          mmdCanvas.style.cssText = `\
            position: absolute;
            width: ${sideSize}px;
            height: ${sideSize}px;
            top: ${dy.toFixed(8)}px;
            left: ${dx.toFixed(8)}px;
          `;
          ctx = mmdCanvas.getContext('2d');
          mmdCanvases[i] = mmdCanvas;
          mmdCanvasContexts[i] = ctx;

          document.body.appendChild(mmdCanvas);
        }
        let avatarRenderTarget = avatarRenderTargets[i];
        if (!avatarRenderTarget) {
          avatarRenderTarget = new THREE.WebGLRenderTarget(sideSize * pixelRatio, sideSize * pixelRatio, {
            minFilter: THREE.LinearFilter,
            magFilter: THREE.LinearFilter,
            format: THREE.RGBAFormat,
          });
          avatarRenderTargets[i] = avatarRenderTarget;
        }
        // set up side avatar scene
        sideAvatarScene.add(this.model);
        sideAvatarScene.add(world.lights);
        // render side avatar scene
        renderer.setRenderTarget(avatarRenderTarget);
        renderer.clear();
        renderer.render(sideAvatarScene, sideCamera);
        
        // set up side scene
        sideScene.add(this.model);
        sideScene.add(world.lights);

        const now = performance.now();
        bgMesh1.material.uniforms.iTime.value = now / 1000;
        bgMesh1.material.uniforms.iTime.needsUpdate = true;
        bgMesh1.material.uniforms.iFrame.value = Math.floor(now / 1000 * 60);
        bgMesh1.material.uniforms.iFrame.needsUpdate = true;

        bgMesh2.material.uniforms.iTime.value = now / 1000;
        bgMesh2.material.uniforms.iTime.needsUpdate = true;
        bgMesh2.material.uniforms.iFrame.value = Math.floor(now / 1000 * 60);
        bgMesh2.material.uniforms.iFrame.needsUpdate = true;
        
        bgMesh3.material.uniforms.t0.value = avatarRenderTarget.texture;
        bgMesh3.material.uniforms.t0.needsUpdate = true;

        bgMesh4.material.uniforms.iTime.value = now / 1000;
        bgMesh4.material.uniforms.iTime.needsUpdate = true;

        for (const child of bgMesh5.children) {
          // console.log('got child', child);
          child.material.uniforms.uTroikaOutlineOpacity.value = now / 1000;
          child.material.uniforms.uTroikaOutlineOpacity.needsUpdate = true;
        }
        
        // render side scene
        renderer.setRenderTarget(oldRenderTarget);
        renderer.setViewport(0, 0, sideSize, sideSize);
        renderer.clear();
        renderer.render(sideScene, sideCamera);

        ctx.clearRect(0, 0, sideSize, sideSize);
        ctx.drawImage(renderer.domElement, 0, size.y * pixelRatio - sideSize * pixelRatio, sideSize * pixelRatio, sideSize * pixelRatio, 0, 0, sideSize, sideSize);
      }

      // pop old state
      if (oldParent) {
        oldParent.add(this.model);
      } else {
        this.model.parent.remove(this.model);
      }
      if (oldWorldLightParent) {
        oldWorldLightParent.add(world.lights);
      } else {
        world.lights.parent.remove(world.lights);
      }
      // renderer.setRenderTarget(oldRenderTarget);
      renderer.setViewport(oldViewport);
    }

    if (this.getTopEnabled() || this.getHandEnabled(0) || this.getHandEnabled(1)) {
      this.sdkInputs.hmd.position.copy(this.inputs.hmd.position);
      this.sdkInputs.hmd.quaternion.copy(this.inputs.hmd.quaternion);
      this.sdkInputs.leftGamepad.position.copy(this.inputs.leftGamepad.position).add(localVector.copy(this.handOffsetLeft).applyQuaternion(this.inputs.leftGamepad.quaternion));
      this.sdkInputs.leftGamepad.quaternion.copy(this.inputs.leftGamepad.quaternion);
      this.sdkInputs.leftGamepad.pointer = this.inputs.leftGamepad.pointer;
      this.sdkInputs.leftGamepad.grip = this.inputs.leftGamepad.grip;
      this.sdkInputs.rightGamepad.position.copy(this.inputs.rightGamepad.position).add(localVector.copy(this.handOffsetRight).applyQuaternion(this.inputs.rightGamepad.quaternion));
      this.sdkInputs.rightGamepad.quaternion.copy(this.inputs.rightGamepad.quaternion);
      this.sdkInputs.rightGamepad.pointer = this.inputs.rightGamepad.pointer;
      this.sdkInputs.rightGamepad.grip = this.inputs.rightGamepad.grip;

      const modelScaleFactor = this.sdkInputs.hmd.scaleFactor;
      if (modelScaleFactor !== this.lastModelScaleFactor) {
        this.model.scale.set(modelScaleFactor, modelScaleFactor, modelScaleFactor);
        this.lastModelScaleFactor = modelScaleFactor;

        this.springBoneManager && this.springBoneManager.springBoneGroupList.forEach(springBoneGroup => {
          springBoneGroup.forEach(springBone => {
            springBone._worldBoneLength = springBone.bone
              .localToWorld(localVector.copy(springBone._initialLocalChildPosition))
              .sub(springBone._worldPosition)
              .length();
          });
        });
      }
      
      if (this.options.fingers) {
        const _traverse = (o, fn) => {
          fn(o);
          for (const child of o.children) {
            _traverse(child, fn);
          }
        };
        const _processFingerBones = left => {
          const fingerBones = left ? this.fingerBoneMap.left : this.fingerBoneMap.right;
          const gamepadInput = left ? this.sdkInputs.leftGamepad : this.sdkInputs.rightGamepad;
          for (const fingerBone of fingerBones) {
            // if (fingerBone) {
              const {bones, finger} = fingerBone;
              let setter;
              if (finger === 'thumb') {
                setter = (q, i) => q.setFromAxisAngle(localVector.set(0, left ? -1 : 1, 0), gamepadInput.grip * Math.PI*(i === 0 ? 0.125 : 0.25));
              } else if (finger === 'index') {
                setter = (q, i) => q.setFromAxisAngle(localVector.set(0, 0, left ? 1 : -1), gamepadInput.pointer * Math.PI*0.5);
              } else {
                setter = (q, i) => q.setFromAxisAngle(localVector.set(0, 0, left ? 1 : -1), gamepadInput.grip * Math.PI*0.5);
              }
              for (let i = 0; i < bones.length; i++) {
                setter(bones[i].quaternion, i);
              }
            // }
          }
        };
        _processFingerBones(true);
        _processFingerBones(false);
      }
    }
    // if (!this.getBottomEnabled()) {
      localEuler.setFromQuaternion(this.inputs.hmd.quaternion, 'YXZ');
      localEuler.x = 0;
      localEuler.z = 0;
      localEuler.y += Math.PI;
      this.modelBoneOutputs.Root.quaternion.setFromEuler(localEuler);
      
      this.modelBoneOutputs.Root.position.copy(this.inputs.hmd.position)
        .sub(localVector.set(0, this.height, 0));
    // }
    /* if (!this.getTopEnabled() && this.debugMeshes) {
      this.modelBoneOutputs.Hips.updateMatrixWorld();
    } */

    this.shoulderTransforms.Update();
    this.legsManager.Update();

    const _updateEyeTarget = () => {
      const eyePosition = getEyePosition(this.modelBones);
      const globalQuaternion = localQuaternion2.setFromRotationMatrix(
        this.eyeTargetInverted ?
          localMatrix.lookAt(
            this.eyeTarget,
            eyePosition,
            upVector
          )
        :
          localMatrix.lookAt(
            eyePosition,
            this.eyeTarget,
            upVector
          )
      );
      // this.modelBoneOutputs.Root.updateMatrixWorld();
      this.modelBoneOutputs.Neck.matrixWorld.decompose(localVector, localQuaternion, localVector2);

      const needsEyeTarget = this.eyeTargetEnabled && this.modelBones.Root.quaternion.angleTo(globalQuaternion) < Math.PI*0.4;
      if (needsEyeTarget && !this.lastNeedsEyeTarget) {
        this.startEyeTargetQuaternion.copy(localQuaternion);
        this.lastEyeTargetTime = now;
      } else if (this.lastNeedsEyeTarget && !needsEyeTarget) {
        this.startEyeTargetQuaternion.copy(localQuaternion);
        this.lastEyeTargetTime = now;
      }
      this.lastNeedsEyeTarget = needsEyeTarget;

      const eyeTargetFactor = Math.min(Math.max((now - this.lastEyeTargetTime) / maxEyeTargetTime, 0), 1);
      if (needsEyeTarget) {
        localQuaternion.copy(this.startEyeTargetQuaternion)
          .slerp(globalQuaternion, cubicBezier(eyeTargetFactor));
        this.modelBoneOutputs.Neck.matrixWorld.compose(localVector, localQuaternion, localVector2)
        this.modelBoneOutputs.Neck.matrix.copy(this.modelBoneOutputs.Neck.matrixWorld)
          .premultiply(localMatrix2.copy(this.modelBoneOutputs.Neck.parent.matrixWorld).invert())
          .decompose(this.modelBoneOutputs.Neck.position, this.modelBoneOutputs.Neck.quaternion, localVector2);
      } else {
        localMatrix.compose(localVector.set(0, 0, 0), this.startEyeTargetQuaternion, localVector2.set(1, 1, 1))
          .premultiply(localMatrix2.copy(this.modelBoneOutputs.Neck.parent.matrixWorld).invert())
          .decompose(localVector, localQuaternion, localVector2);
        localQuaternion
          .slerp(localQuaternion2.identity(), cubicBezier(eyeTargetFactor));
        this.modelBoneOutputs.Neck.quaternion.copy(localQuaternion);
      }
      
    };
    _updateEyeTarget();
    this.modelBoneOutputs.Root.updateMatrixWorld();
    
    Avatar.applyModelBoneOutputs(
      this.foundModelBones,
      this.modelBoneOutputs,
      // this.getTopEnabled(),
      this.getBottomEnabled(),
      this.getHandEnabled(0),
      this.getHandEnabled(1),
    );
    // this.modelBones.Root.updateMatrixWorld();

    if (this.springBoneManager) {
      this.springBoneTimeStep.update(timeDiff);
    }
    /* if (this.springBoneManager && wasDecapitated) {
      this.decapitate();
    } */

    const _updateVisemes = () => {
      const volumeValue = this.volume !== -1 ? Math.min(this.volume * 10, 1) : -1;
      const blinkValue = (() => {
        const nowWindow = now % 2000;
        if (nowWindow >= 0 && nowWindow < 100) {
          return nowWindow/100;
        } else if (nowWindow >= 100 && nowWindow < 200) {
          return 1 - (nowWindow-100)/100;
        } else {
          return 0;
        }
      })();
      for (const visemeMapping of this.skinnedMeshesVisemeMappings) {
        if (visemeMapping) {
          const [
            morphTargetInfluences,
            blinkLeftIndex,
            blinkRightIndex,
            aIndex,
            eIndex,
            iIndex,
            oIndex,
            uIndex,
            neutralIndex,
            angryIndex,
            funIndex,
            joyIndex,
            sorrowIndex,
            // surprisedIndex,
            // extraIndex,
          ] = visemeMapping;
          
          // reset
          for (let i = 0; i < morphTargetInfluences.length; i++) {
            morphTargetInfluences[i] = 0;
          }
          
          if (volumeValue !== -1) { // real speech
            if (aIndex !== -1) {
              morphTargetInfluences[aIndex] = volumeValue;
            }
            if (eIndex !== -1) {
              morphTargetInfluences[eIndex] = volumeValue * this.vowels[1];
            }
            if (iIndex !== -1) {
              morphTargetInfluences[iIndex] = volumeValue * this.vowels[2];
            }
            if (oIndex !== -1) {
              morphTargetInfluences[oIndex] = volumeValue * this.vowels[3];
            }
            if (uIndex !== -1) {
              morphTargetInfluences[uIndex] = volumeValue * this.vowels[4];
            }
          } else { // fake speech
            this.fakeSpeechSmoothed = this.fakeSpeechSmoothed * 0.99 + 0.01 * this.fakeSpeechValue;
            const now2 = now / 1000 * 2;
            let aValue = (simplexes[0].noise2D(now2, now2));
            let eValue = (simplexes[1].noise2D(now2, now2));
            let iValue = (simplexes[2].noise2D(now2, now2));
            let oValue = (simplexes[3].noise2D(now2, now2));
            let uValue = (simplexes[4].noise2D(now2, now2));
            let totalValue = 1.5; // (Math.abs(aValue) + Math.abs(eValue) + Math.abs(iValue) + Math.abs(oValue) + Math.abs(uValue));
            if (aIndex !== -1) {
              morphTargetInfluences[aIndex] = this.fakeSpeechSmoothed * aValue/totalValue;
            }
            if (eIndex !== -1) {
              morphTargetInfluences[eIndex] = this.fakeSpeechSmoothed * eValue/totalValue;
            }
            if (iIndex !== -1) {
              morphTargetInfluences[iIndex] = this.fakeSpeechSmoothed * iValue/totalValue;
            }
            if (oIndex !== -1) {
              morphTargetInfluences[oIndex] = this.fakeSpeechSmoothed * oValue/totalValue;
            }
            if (uIndex !== -1) {
              morphTargetInfluences[uIndex] = this.fakeSpeechSmoothed * uValue/totalValue;
            }
          }
            
          // emotes
          if (this.emotes.length > 0) {
            for (const emote of this.emotes) {
              if (emote.index >= 0 && emote.index < morphTargetInfluences.length) {
                morphTargetInfluences[emote.index] = emote.value;
              } else {
                let index = -1;
                switch (emote.emotion) {
                  case 'neutral': {
                    index = neutralIndex;
                    break;
                  }
                  case 'angry': {
                    index = angryIndex;
                    break;
                  }
                  case 'fun': {
                    index = funIndex;
                    break;
                  }
                  case 'joy': {
                    index = joyIndex;
                    break;
                  }
                  case 'sorrow': {
                    index = sorrowIndex;
                    break;
                  }
                }
                if (index !== -1) {
                  morphTargetInfluences[index] = emote.value;
                }
              }
            }
          }

          // blink
          if (blinkLeftIndex !== -1) {
            morphTargetInfluences[blinkLeftIndex] = blinkValue;
          }
          if (blinkRightIndex !== -1) {
            morphTargetInfluences[blinkRightIndex] = blinkValue;
          }
        }
      }
    };
    this.options.visemes && _updateVisemes();

    /* if (this.debugMeshes) {
      if (this.getTopEnabled()) {
        this.getHandEnabled(0) && this.modelBoneOutputs.Left_arm.quaternion.multiply(rightRotation); // center
        this.modelBoneOutputs.Left_arm.updateMatrixWorld();
        this.getHandEnabled(1) && this.modelBoneOutputs.Right_arm.quaternion.multiply(leftRotation); // center
        this.modelBoneOutputs.Right_arm.updateMatrixWorld();
      }

      for (const k in this.debugMeshes.attributes) {
        const attribute = this.debugMeshes.attributes[k];
        if (attribute.visible) {
          const output = this.modelBoneOutputs[k];
          attribute.array.set(attribute.srcGeometry.attributes.position.array);
          attribute.applyMatrix4(localMatrix.multiplyMatrices(this.model.matrixWorld, output.matrixWorld));
        } else {
          attribute.array.fill(0);
        }
      }
      this.debugMeshes.geometry.attributes.position.needsUpdate = true;
    } */
    
    this.now += timeDiff;
	}

  async setMicrophoneMediaStream(microphoneMediaStream, options = {}) {
    // cleanup
    if (this.microphoneWorker) {
      this.microphoneWorker.close();
      this.microphoneWorker = null;
    }
    if (this.audioRecognizer) {
      this.audioRecognizer.destroy();
      this.audioRecognizer = null;
    }

    // setup
    if (microphoneMediaStream) {
      this.volume = 0;
     
      const audioContext = getAudioContext();
      if (audioContext.state === 'suspended') {
        (async () => {
          await audioContext.resume();
        })();
      }
      // console.log('got context', audioContext);
      // window.audioContext = audioContext;
      {
        options.audioContext = audioContext;
        options.emitVolume = true;
        options.emitBuffer = true;
      };
      this.microphoneWorker = new MicrophoneWorker(microphoneMediaStream, options);
      this.microphoneWorker.addEventListener('volume', e => {
        this.volume = this.volume*0.8 + e.data*0.2;
      });
      this.microphoneWorker.addEventListener('buffer', e => {
        // if (live) {
          this.audioRecognizer.send(e.data);
        // }
      });

      // let live = false;
      this.audioRecognizer = new AudioRecognizer({
        sampleRate: audioContext.sampleRate,
      });
      this.audioRecognizer.addEventListener('result', e => {
        this.vowels.set(e.data);
        // console.log('got vowels', this.vowels.map(n => n.toFixed(1)).join(','));
      });
      /* this.audioRecognizer.waitForLoad()
        .then(() => {
          live = true;
        }); */
    } else {
      this.volume = -1;
    }
  }

  decapitate() {
    if (!this.decapitated) {
      this.modelBones.Head.traverse(o => {
        if (o.savedPosition) { // three-vrm adds vrmColliderSphere which will not be saved
          o.savedPosition.copy(o.position);
          o.savedMatrixWorld.copy(o.matrixWorld);
          o.position.set(NaN, NaN, NaN);
          o.matrixWorld.set(NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN, NaN);
        }
      });
      /* if (this.debugMeshes) {
        [this.debugMeshes.attributes.eyes, this.debugMeshes.attributes.head].forEach(attribute => {
          attribute.visible = false;
        });
      } */
      this.decapitated = true;
    }
  }
  undecapitate() {
    if (this.decapitated) {
      this.modelBones.Head.traverse(o => {
        if (o.savedPosition) {
          o.position.copy(o.savedPosition);
          o.matrixWorld.copy(o.savedMatrixWorld);
        }
      });
      /* if (this.debugMeshes) {
        [this.debugMeshes.attributes.eyes, this.debugMeshes.attributes.head].forEach(attribute => {
          attribute.visible = true;
        });
      } */
      this.decapitated = false;
    }
  }

  setFloorHeight(floorHeight) {
    this.poseManager.vrTransforms.floorHeight = floorHeight;
  }

  getFloorHeight() {
    return this.poseManager.vrTransforms.floorHeight;
  }

  say(audio) {
    this.setMicrophoneMediaStream(audio, {
      muted: false,
      // emitVolume: true,
      // emitBuffer: true,
      // audioContext: WSRTC.getAudioContext(),
      // microphoneWorkletUrl: '/avatars/microphone-worklet.js',
    });

    audio.play();
  }

  destroy() {
    this.setMicrophoneMediaStream(null);
  }
}
Avatar.waitForLoad = () => loadPromise;
Avatar.getAnimations = () => animations;
Avatar.getAnimationMappingConfig = () => animationMappingConfig;
let avatarAudioContext = null;
const getAudioContext = () => {
  if (!avatarAudioContext) {
    avatarAudioContext = new AudioContext();
  }
  return avatarAudioContext;
};
Avatar.getAudioContext = getAudioContext;
Avatar.setAudioContext = newAvatarAudioContext => {
  avatarAudioContext = newAvatarAudioContext;
};
export default Avatar;
