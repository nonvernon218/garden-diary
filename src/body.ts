import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import type { Mark, Point3 } from './types';

type Selection = { part: string; point: Point3 };

const colors = [0xbec9bb, 0xaebda8, 0x9fac91, 0x9eac80, 0xb3aa73, 0xc19d68, 0xca8961, 0xcf745d, 0xce625b, 0xc94b51, 0xbc394b];

export function severityColor(value: number): string {
  return '#' + colors[Math.max(0, Math.min(10, Math.round(value)))].toString(16).padStart(6, '0');
}

export class BodyViewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private body = new THREE.Group();
  private markerGroup = new THREE.Group();
  private hitMeshes: THREE.Object3D[] = [];
  private ray = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private observer: ResizeObserver;
  private frame = 0;
  private down: { id: number; x: number; y: number } | null = null;
  private activePointers = new Set<number>();
  private scrolling = false;
  private lastTouchY = 0;
  private disposed = false;
  private lastView = '';

  constructor(private host: HTMLElement, private onSelect: (selection: Selection) => void, marks: Mark[] = []) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.host.appendChild(this.renderer.domElement);
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.52, 5.9);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 1.53, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.enablePan = true;
    this.controls.touches.TWO = THREE.TOUCH.DOLLY_PAN;
    this.controls.minDistance = 2.3;
    this.controls.maxDistance = 8.2;
    this.controls.maxPolarAngle = Math.PI * 0.56;
    this.controls.minPolarAngle = Math.PI * 0.23;
    this.renderer.domElement.style.touchAction = 'none';

    this.scene.add(new THREE.HemisphereLight(0xf4f1e7, 0x414d46, 2.1));
    const key = new THREE.DirectionalLight(0xfff3dc, 2.2);
    key.position.set(-3, 5, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xa2bdaa, 1.2);
    rim.position.set(3, 2, -4);
    this.scene.add(rim);
    this.scene.add(this.body, this.markerGroup);
    this.makeBody();
    this.setMarks(marks);
    this.makeGuide();
    this.renderer.domElement.addEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.addEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.addEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.addEventListener('pointercancel', this.pointerCancel);
    this.observer = new ResizeObserver(() => this.resize());
    this.observer.observe(this.host);
    this.resize();
    this.animate();
  }

  private material = new THREE.MeshPhysicalMaterial({
    color: 0xb6b5a5,
    roughness: 0.88,
    metalness: 0.02,
    clearcoat: 0.05,
    flatShading: false,
  });

  private addEllipsoid(part: string, pos: [number, number, number], scale: [number, number, number], rotationZ = 0): void {
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 24), this.material);
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.rotation.z = rotationZ;
    mesh.userData.part = part;
    this.body.add(mesh);
    this.hitMeshes.push(mesh);
  }

  private addLimb(part: string, a: [number, number, number], b: [number, number, number], radiusA: number, radiusB: number): void {
    const start = new THREE.Vector3(...a);
    const end = new THREE.Vector3(...b);
    const delta = end.clone().sub(start);
    const half = delta.length() / 2;
    const profile = new THREE.SplineCurve([
      new THREE.Vector2(0, -half - 0.015),
      new THREE.Vector2(radiusA * 0.85, -half * 0.92),
      new THREE.Vector2(radiusA, -half * 0.65),
      new THREE.Vector2((radiusA + radiusB) / 2, 0),
      new THREE.Vector2(radiusB, half * 0.7),
      new THREE.Vector2(radiusB * 0.75, half * 0.94),
      new THREE.Vector2(0, half + 0.015),
    ]).getPoints(42);
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 28), this.material);
    mesh.position.copy(start.add(end).multiplyScalar(0.5));
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
    mesh.userData.part = part;
    this.body.add(mesh);
    this.hitMeshes.push(mesh);
  }

  private addTorso(): void {
    const profile = new THREE.SplineCurve([
      new THREE.Vector2(0, 1.29),
      new THREE.Vector2(0.24, 1.32),
      new THREE.Vector2(0.31, 1.43),
      new THREE.Vector2(0.31, 1.56),
      new THREE.Vector2(0.28, 1.7),
      new THREE.Vector2(0.28, 1.84),
      new THREE.Vector2(0.32, 2.02),
      new THREE.Vector2(0.38, 2.22),
      new THREE.Vector2(0.38, 2.34),
      new THREE.Vector2(0.28, 2.43),
      new THREE.Vector2(0.11, 2.49),
      new THREE.Vector2(0, 2.5),
    ]).getPoints(90);
    const mesh = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), this.material);
    mesh.scale.z = 0.57;
    mesh.userData.part = '躯干';
    this.body.add(mesh);
    this.hitMeshes.push(mesh);
  }

  private makeBody(): void {
    // Anatomically neutral, segmented mannequin. Each segment has a generous hit area.
    this.addEllipsoid('头部', [0, 2.79, 0], [0.205, 0.275, 0.19]);
    const hair = new THREE.MeshPhysicalMaterial({ color: 0x777c70, roughness: 0.98 });
    const crown = new THREE.Mesh(new THREE.SphereGeometry(1, 30, 20), hair);
    crown.position.set(0, 2.96, -0.015);
    crown.scale.set(0.216, 0.128, 0.205);
    crown.userData.part = '头发';
    this.body.add(crown);
    this.hitMeshes.push(crown);
    for (const side of [-1, 1]) {
      const lock = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), hair);
      lock.position.set(side * 0.175, 2.82, -0.045);
      lock.scale.set(0.054, 0.14, 0.14);
      lock.userData.part = '头发';
      this.body.add(lock);
      this.hitMeshes.push(lock);
    }
    this.addEllipsoid('颈部', [0, 2.48, 0], [0.105, 0.125, 0.105]);
    this.addTorso();
    for (const side of [-1, 1]) {
      const label = side > 0 ? '左' : '右';
      this.addEllipsoid(`${label}肩`, [side * 0.42, 2.29, 0], [0.17, 0.16, 0.17]);
      this.addLimb(`${label}上臂`, [side * 0.48, 2.24, 0], [side * 0.57, 1.78, 0], 0.13, 0.11);
      this.addEllipsoid(`${label}肘`, [side * 0.57, 1.76, 0], [0.11, 0.115, 0.11]);
      this.addLimb(`${label}前臂`, [side * 0.57, 1.73, 0], [side * 0.64, 1.25, 0.025], 0.105, 0.073);
      this.addEllipsoid(`${label}手`, [side * 0.65, 1.12, 0.03], [0.105, 0.18, 0.065], side * -0.08);
      this.addLimb(`${label}大腿`, [side * 0.17, 1.37, 0], [side * 0.18, 0.84, 0.02], 0.17, 0.12);
      this.addEllipsoid(`${label}膝`, [side * 0.18, 0.79, 0.045], [0.125, 0.13, 0.13]);
      this.addLimb(`${label}小腿`, [side * 0.18, 0.75, 0.01], [side * 0.19, 0.22, -0.015], 0.115, 0.075);
      this.addEllipsoid(`${label}脚`, [side * 0.19, 0.11, 0.12], [0.13, 0.09, 0.27]);
    }
    // Subtle surface detail evokes an anatomical chart without claiming medical precision.
    const lineMat = new THREE.LineBasicMaterial({ color: 0x5e695c, transparent: true, opacity: 0.48 });
    const spine = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 2.42, -0.112), new THREE.Vector3(0, 2.15, -0.205),
      new THREE.Vector3(0, 1.8, -0.193), new THREE.Vector3(0, 1.46, -0.185),
    ]), lineMat);
    this.body.add(spine);
    const meridian = new THREE.MeshBasicMaterial({ color: 0x60745e, transparent: true, opacity: 0.65 });
    for (const [y, z] of [[2.32, 0.16], [2.15, 0.2], [1.97, 0.19], [1.78, 0.165], [1.58, 0.17]]) {
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), meridian);
      dot.position.set(0, y, z);
      this.body.add(dot);
    }
    for (const side of [-1, 1]) {
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(side * 0.16, 2.36, 0.11),
        new THREE.Vector3(side * 0.19, 2.19, 0.18),
        new THREE.Vector3(side * 0.1, 1.93, 0.19),
        new THREE.Vector3(side * 0.08, 1.72, 0.175),
      ]), lineMat);
      this.body.add(line);
    }
  }

  private makeGuide(): void {
    const ringMat = new THREE.MeshBasicMaterial({ color: 0x5f7968, transparent: true, opacity: 0.19, side: THREE.DoubleSide });
    for (const r of [0.82, 1.12, 1.42]) {
      const ring = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.003, 96), ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = -0.015;
      this.scene.add(ring);
    }
  }

  setMarks(marks: Mark[]): void {
    for (const item of [...this.markerGroup.children]) {
      this.markerGroup.remove(item);
      const mesh = item as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
    }
    for (const mark of marks) {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.042, 16, 12),
        new THREE.MeshBasicMaterial({ color: colors[Math.max(0, Math.min(10, mark.severity))] }),
      );
      mesh.position.set(...mark.point);
      mesh.userData.part = mark.part;
      mesh.renderOrder = 10;
      this.markerGroup.add(mesh);
    }
  }

  private pointerDown = (ev: PointerEvent): void => {
    this.activePointers.add(ev.pointerId);
    this.down = this.activePointers.size === 1 ? { id: ev.pointerId, x: ev.clientX, y: ev.clientY } : null;
    this.lastTouchY = ev.clientY;
    if (this.activePointers.size > 1) { this.scrolling = false; this.controls.enableRotate = true; }
  };

  private pointerMove = (ev: PointerEvent): void => {
    if (!this.host.classList.contains('body-view') || ev.pointerType !== 'touch' || this.activePointers.size !== 1) return;
    if (this.down && Math.abs(ev.clientY - this.down.y) > 9 && Math.abs(ev.clientY - this.down.y) > Math.abs(ev.clientX - this.down.x) * 1.3) {
      this.scrolling = true;
      this.down = null;
      this.controls.enableRotate = false;
    }
    if (this.scrolling) window.scrollBy(0, this.lastTouchY - ev.clientY);
    this.lastTouchY = ev.clientY;
  };

  private pointerCancel = (ev: PointerEvent): void => {
    this.activePointers.delete(ev.pointerId);
    this.down = null;
    this.scrolling = false;
    this.controls.enableRotate = true;
  };

  private pointerUp = (ev: PointerEvent): void => {
    this.activePointers.delete(ev.pointerId);
    this.scrolling = false;
    this.controls.enableRotate = true;
    if (!this.down || this.down.id !== ev.pointerId || Math.hypot(ev.clientX - this.down.x, ev.clientY - this.down.y) > 15) {
      this.down = null;
      return;
    }
    this.down = null;
    const selected = this.pick(ev.clientX, ev.clientY);
    // Let the browser finish the tap's click event before inserting the modal backdrop.
    if (selected) window.setTimeout(() => { if (!this.disposed) this.onSelect(selected); }, 0);
  };

  private pick(clientX: number, clientY: number): Selection | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const cast = (x: number, y: number): { marker: THREE.Intersection<THREE.Object3D> | undefined; hit: THREE.Intersection<THREE.Object3D> | undefined } => {
      this.pointer.set(((x - rect.left) / rect.width) * 2 - 1, -((y - rect.top) / rect.height) * 2 + 1);
      this.ray.setFromCamera(this.pointer, this.camera);
      return { marker: this.ray.intersectObjects(this.markerGroup.children, false)[0], hit: this.ray.intersectObjects(this.hitMeshes, false)[0] };
    };
    let { marker, hit } = cast(clientX, clientY);
    if (!marker && !hit) {
      for (const [dx, dy] of [[-10, 0], [10, 0], [0, -10], [0, 10], [-8, -8], [8, -8], [-8, 8], [8, 8]]) {
        ({ marker, hit } = cast(clientX + dx, clientY + dy));
        if (marker || hit) break;
      }
    }
    if (marker) {
      const m = marker.object as THREE.Mesh;
      return { part: String(m.userData.part), point: [m.position.x, m.position.y, m.position.z] };
    }
    if (!hit) return null;
    let part = String(hit.object.userData.part);
    if (part === '躯干') {
      part = hit.point.y > 2.04 ? '胸部' : hit.point.y > 1.56 ? '腹部' : '骨盆';
      const side = hit.point.x > 0.07 ? '左' : hit.point.x < -0.07 ? '右' : '';
      part = (hit.point.z < -0.045 ? '背部' : part) + side;
    } else if (part === '头部') {
      part = hit.point.z > 0.045 ? '面部' : hit.point.z < -0.055 ? '后脑' : '头部';
    }
    const p = hit.point.clone().add(hit.face?.normal.clone().transformDirection(hit.object.matrixWorld).multiplyScalar(0.015) || new THREE.Vector3());
    return { part, point: [p.x, p.y, p.z] };
  }

  private resize(): void {
    const width = this.host.clientWidth || 320;
    const height = this.host.clientHeight || 500;
    this.renderer.setSize(width, height);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  zoom(factor: number): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const distance = THREE.MathUtils.clamp(offset.length() * factor, this.controls.minDistance, this.controls.maxDistance);
    this.camera.position.copy(this.controls.target).add(offset.setLength(distance));
    this.controls.update();
  }

  face(side: 'front' | 'back'): void {
    const distance = this.camera.position.distanceTo(this.controls.target);
    this.camera.position.set(0, this.controls.target.y + 0.18, (side === 'front' ? 1 : -1) * distance);
    this.controls.update();
  }

  private updateViewLabels(): void {
    const offset = this.camera.position.clone().sub(this.controls.target);
    const view = Math.abs(offset.z) >= Math.abs(offset.x)
      ? (offset.z >= 0 ? '正面' : '背面')
      : (offset.x >= 0 ? '身体左侧' : '身体右侧');
    if (view !== this.lastView) {
      this.lastView = view;
      const label = this.host.querySelector<HTMLElement>('[data-view-label]');
      if (label) label.textContent = `当前视角：${view}`;
    }
    for (const [side, x] of [['left', 0.58], ['right', -0.58]] as const) {
      const label = this.host.querySelector<HTMLElement>(`[data-side-label="${side}"]`);
      if (!label) continue;
      const projected = new THREE.Vector3(x, 2.03, 0).project(this.camera);
      const visible = projected.z < 1 && projected.z > -1 && Math.abs(offset.z) > 0.5;
      label.hidden = !visible;
      if (visible) {
        label.style.left = `${(projected.x + 1) * 50}%`;
        label.style.top = `${(1 - projected.y) * 50}%`;
      }
    }
  }

  private animate = (): void => {
    if (this.disposed) return;
    this.controls.update();
    this.updateViewLabels();
    this.renderer.render(this.scene, this.camera);
    this.frame = requestAnimationFrame(this.animate);
  };

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frame);
    this.observer.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.pointerDown);
    this.renderer.domElement.removeEventListener('pointermove', this.pointerMove);
    this.renderer.domElement.removeEventListener('pointerup', this.pointerUp);
    this.renderer.domElement.removeEventListener('pointercancel', this.pointerCancel);
    this.controls.dispose();
    this.scene.traverse(obj => {
      if (obj instanceof THREE.Mesh) {
        obj.geometry.dispose();
        if (Array.isArray(obj.material)) obj.material.forEach(m => m.dispose());
        else obj.material.dispose();
      }
    });
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
