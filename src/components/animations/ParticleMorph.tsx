import React, { useRef, useEffect, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';

const PORTRAIT_1 = '/aura.png';
const PORTRAIT_2 = '/miku3.png';
const PORTRAIT_3 = '/anon2.png';
const PORTRAIT_4 = '/Ariadne.png';

function getImageData(url: string, width = 400, height = 400): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject('No canvas context');
      
      const scale = Math.min(width / img.width, height / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const x = (width - w) / 2;
      const y = (height - h) / 2;
      
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, x, y, w, h);
      resolve(ctx.getImageData(0, 0, width, height));
    };
    img.onerror = () => reject(new Error('Failed to load image: ' + url));
    img.src = url;
  });
}

function getPositions(imageData: ImageData, targetCount: number, scaleMultiplier: number = 6.5, brightnessBoost: number = 1.0, tintColor?: number[], clipBottomRight: boolean = false, weightMultiplier: number = 12) {
  const { data, width, height } = imageData;
  const validPixels = [];
  
  for (let i = 0; i < width * height; i++) {
    const r = data[i * 4];
    const g = data[i * 4 + 1];
    const b = data[i * 4 + 2];
    const brightness = (r * 0.299 + g * 0.587 + b * 0.114);
    
    // Lowered threshold to pick up very faint wireframe lines in 2nd and 3rd images
    if (brightness > 5) {
      const x = (i % width) / width - 0.5;
      const y = -(Math.floor(i / width) / height - 0.5);
      
      if (clipBottomRight && x > 0.2 && y < -0.35) {
        continue;
      }
      
      const z = (brightness / 255) * 0.4;
      
      let pixelColor = [r/255, g/255, b/255];
      if (tintColor) {
        // Assume original image is mostly grayscale, we use its brightness to scale the tint
        const lum = brightness / 255;
        pixelColor = [
          Math.min(1.0, lum * tintColor[0]),
          Math.min(1.0, lum * tintColor[1]),
          Math.min(1.0, lum * tintColor[2])
        ];
      }
      
      const point = { x: x * scaleMultiplier, y: y * scaleMultiplier, z, color: pixelColor };
      
      validPixels.push(point);
      
      // Weight priority based on brightness. Brightest features (like eyes)
      // get more particles, increasing sharpness where there is high contrast,
      // without washing out the darker wireframe lines.
      const extraWeight = Math.floor(Math.pow(brightness / 255, 2.0) * weightMultiplier);
      for(let w = 0; w < extraWeight; w++) {
        validPixels.push(point);
      }
    }
  }
  
  if (validPixels.length === 0) validPixels.push({ x: 0, y: 0, z: 0, color: [1, 1, 1] });

  const positions = new Float32Array(targetCount * 3);
  const colors = new Float32Array(targetCount * 3);
  for (let i = 0; i < targetCount; i++) {
    const p = validPixels[Math.floor(Math.random() * validPixels.length)];
    // Tighter scatter constraint to preserve grid-like structural resolution
    positions[i * 3] = p.x + (Math.random() - 0.5) * 0.003;
    positions[i * 3 + 1] = p.y + (Math.random() - 0.5) * 0.003;
    positions[i * 3 + 2] = p.z + (Math.random() - 0.5) * 0.01;
    
    colors[i * 3] = Math.min(1.0, p.color[0] * brightnessBoost);
    colors[i * 3 + 1] = Math.min(1.0, p.color[1] * brightnessBoost);
    colors[i * 3 + 2] = Math.min(1.0, p.color[2] * brightnessBoost);
  }
  return { positions, colors };
}

const ParticleCore = ({ img1Url, img2Url, img3Url, img4Url }: { img1Url: string; img2Url: string; img3Url: string; img4Url: string }) => {
  const pointsRef = useRef<THREE.Points>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  
  useEffect(() => {
    let active = true;
    const loadData = async () => {
      try {
        const [imgData1, imgData2, imgData3, imgData4] = await Promise.all([
          getImageData(img1Url),
          getImageData(img2Url),
          getImageData(img3Url),
          getImageData(img4Url)
        ]);
        if (!active) return;
        
        const count = 200000; // Increased density for more detail
        const { positions: pos1, colors: col1 } = getPositions(imgData1, count);
        const { positions: pos2, colors: col2 } = getPositions(imgData2, count, 8.5, 1.5); // Scaled up and brightened
        const { positions: pos3, colors: col3 } = getPositions(imgData3, count, 7.0); // Scaled down slightly
        const { positions: pos4, colors: col4 } = getPositions(imgData4, count, 5.0, 1.5, [1.0, 0.8, 0.3], true, 2); // Golden tint, smaller, clip watermark, lower cluster weight
        
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos1, 3));
        geo.setAttribute('positionB', new THREE.BufferAttribute(pos2, 3));
        geo.setAttribute('positionC', new THREE.BufferAttribute(pos3, 3));
        geo.setAttribute('positionD', new THREE.BufferAttribute(pos4, 3));
        geo.setAttribute('colorA', new THREE.BufferAttribute(col1, 3));
        geo.setAttribute('colorB', new THREE.BufferAttribute(col2, 3));
        geo.setAttribute('colorC', new THREE.BufferAttribute(col3, 3));
        geo.setAttribute('colorD', new THREE.BufferAttribute(col4, 3));
        
        const randoms = new Float32Array(count);
        for(let i = 0; i < count; i++) randoms[i] = Math.random();
        geo.setAttribute('aRandom', new THREE.BufferAttribute(randoms, 1));
        
        setGeometry(geo);
      } catch (e) {
        console.error("Image loading failed:", e);
      }
    };
    loadData();
    return () => { active = false; };
  }, [img1Url, img2Url, img3Url, img4Url]);

  useFrame((state) => {
    if (materialRef.current && pointsRef.current) {
      const time = state.clock.elapsedTime;
      materialRef.current.uniforms.uTime.value = time;
      
      const N = 4;
      const holdDur = 5.0; // 5 seconds hold
      const transDur = 1.5; // 1.5 seconds transition
      const phaseDur = holdDur + transDur;
      const totalDur = phaseDur * N;
      const t = time % totalDur;
      
      const phase = Math.floor(t / phaseDur); // 0, 1, 2, 3
      const localT = t - phase * phaseDur;
      
      let weights = [0, 0, 0, 0];
      let p = 0; // local progress for transition
      let dispersion = 0;
      
      if (localT < holdDur) {
        weights[phase] = 1;
      } else {
        p = (localT - holdDur) / transDur;
        p = p * p * (3.0 - 2.0 * p);
        weights[phase] = 1 - p;
        weights[(phase + 1) % N] = p;
        dispersion = Math.sin(p * Math.PI);
      }
      
      materialRef.current.uniforms.uWeights.value.set(weights[0], weights[1], weights[2], weights[3]);
      materialRef.current.uniforms.uDispersion.value = dispersion;
      
      // Slight floating effect for the whole group
      pointsRef.current.rotation.y = Math.sin(time * 0.2) * 0.1;
      pointsRef.current.rotation.x = Math.cos(time * 0.1) * 0.05;
    }
  });

  if (!geometry) return null;

  return (
    <points ref={pointsRef} geometry={geometry}>
      <shaderMaterial
        ref={materialRef}
        transparent={true}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uTime: { value: 0 },
          uWeights: { value: new THREE.Vector4(1, 0, 0, 0) },
          uDispersion: { value: 0 }
        }}
        vertexShader={`
          uniform float uTime;
          uniform vec4 uWeights;
          uniform float uDispersion;
          attribute vec3 positionB;
          attribute vec3 positionC;
          attribute vec3 positionD;
          attribute vec3 colorA;
          attribute vec3 colorB;
          attribute vec3 colorC;
          attribute vec3 colorD;
          attribute float aRandom;
          varying float vAlpha;
          varying vec3 vColor;
          
          vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
          float snoise(vec3 v){ 
            const vec2  C = vec2(1.0/6.0, 1.0/3.0);
            const vec4  D = vec4(0.0, 0.5, 1.0, 2.0);
            vec3 i  = floor(v + dot(v, C.yyy));
            vec3 x0 = v - i + dot(i, C.xxx);
            vec3 g = step(x0.yzx, x0.xyz);
            vec3 l = 1.0 - g;
            vec3 i1 = min(g.xyz, l.zxy);
            vec3 i2 = max(g.xyz, l.zxy);
            vec3 x1 = x0 - i1 + 1.0 * C.xxx;
            vec3 x2 = x0 - i2 + 2.0 * C.xxx;
            vec3 x3 = x0 - 1.0 + 3.0 * C.xxx;
            i = mod(i, 289.0); 
            vec4 p = permute(permute(permute(
                      i.z + vec4(0.0, i1.z, i2.z, 1.0))
                    + i.y + vec4(0.0, i1.y, i2.y, 1.0)) 
                    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
            float n_ = 0.142857142857;
            vec3  ns = n_ * D.wyz - D.xzx;
            vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
            vec4 x_ = floor(j * ns.z);
            vec4 y_ = floor(j - 7.0 * x_ );
            vec4 x = x_ * ns.x + ns.yyyy;
            vec4 y = y_ * ns.x + ns.yyyy;
            vec4 h = 1.0 - abs(x) - abs(y);
            vec4 b0 = vec4(x.xy, y.xy);
            vec4 b1 = vec4(x.zw, y.zw);
            vec4 s0 = floor(b0) * 2.0 + 1.0;
            vec4 s1 = floor(b1) * 2.0 + 1.0;
            vec4 sh = -step(h, vec4(0.0));
            vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
            vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
            vec3 p0 = vec3(a0.xy, h.x);
            vec3 p1 = vec3(a0.zw, h.y);
            vec3 p2 = vec3(a1.xy, h.z);
            vec3 p3 = vec3(a1.zw, h.w);
            vec4 norm = inversesqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
            p0 *= norm.x;
            p1 *= norm.y;
            p2 *= norm.z;
            p3 *= norm.w;
            vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
            m = m * m;
            return 42.0 * dot(m * m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
          }
           
          void main() {
            vec3 target = position * uWeights.x + positionB * uWeights.y + positionC * uWeights.z + positionD * uWeights.w;
            vColor = colorA * uWeights.x + colorB * uWeights.y + colorC * uWeights.z + colorD * uWeights.w;
            
            float dispersion = uDispersion;
            
            // Noise based offset to simulate fluid/wave burst
            float n1 = snoise(target * 1.5 + uTime * 0.4);
            float n2 = snoise(target * 1.5 - uTime * 0.4 + 10.0);
            float n3 = snoise(target * 1.5 + uTime * 0.2 + 20.0);
            vec3 noiseVec = vec3(n1, n2, n3);
            
            // Disperse massively
            target += noiseVec * dispersion * 1.5;
            
            // Add a constant subtle breathing wave effect
            target.z += snoise(target * 2.0 + uTime) * 0.05;

            vec4 mvPosition = modelViewMatrix * vec4(target, 1.0);
            
            // Slightly enlarge particles for the scaled-up image (uWeights.y) to compensate for visual dispersion
            float sizeComp = uWeights.y * 0.2; 
            gl_PointSize = (1.5 + aRandom * 1.5 + sizeComp) * (5.0 / -mvPosition.z);
            
            gl_Position = projectionMatrix * mvPosition;
            
            vAlpha = (1.0 - (pow(dispersion, 1.5) * 0.4)) * (0.5 + aRandom * 0.5); 
          }
        `}
        fragmentShader={`
          varying float vAlpha;
          varying vec3 vColor;
          void main() {
            // Circle
            vec2 cxy = 2.0 * gl_PointCoord - 1.0;
            float r = dot(cxy, cxy);
            if (r > 1.0) discard;
            
            // Soft glow
            float alpha = (1.0 - r) * vAlpha;
            gl_FragColor = vec4(vColor, alpha);
          }
        `}
      />
    </points>
  );
};

export function ParticleMorph({ 
  img1Url = PORTRAIT_1, 
  img2Url = PORTRAIT_2,
  img3Url = PORTRAIT_3,
  img4Url = PORTRAIT_4
}: { 
  img1Url?: string; 
  img2Url?: string; 
  img3Url?: string;
  img4Url?: string;
}) {
  return (
    <div className="absolute inset-0 w-full h-full pointer-events-none z-0">
      <Canvas camera={{ position: [0, 0, 5], fov: 60 }}>
        <ParticleCore img1Url={img1Url} img2Url={img2Url} img3Url={img3Url} img4Url={img4Url} />
      </Canvas>
    </div>
  );
}
