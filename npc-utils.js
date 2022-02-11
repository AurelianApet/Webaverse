
import * as THREE from 'three';
import {
  rootScene,
} from './renderer.js';
import physicsManager from './physics-manager.js';

const identityQuaternion = new THREE.Quaternion();

const heightTolerance = 0.6;
const selectStartDestVoxelYTolerance = 0.6;
const tmpVec2 = new THREE.Vector2();
const localVector = new THREE.Vector3();

const materialIdle = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(221,213,213)'), wireframe: false});
const materialReached = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(171,163,163)'), wireframe: false});
const materialIdle2 = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(121,213,113)'), wireframe: false});
const materialReached2 = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(71,163,63)'), wireframe: false});
const materialFrontier = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(92,133,214)'), wireframe: false});
const materialFrontier2 = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(42,83,164)'), wireframe: false});
// const materialStart = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(191,64,64)'), wireframe: false});
const materialStart = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(0,255,255)'), wireframe: false});
// const materialDest = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(191,64,170)'), wireframe: false});
const materialDest = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(255,255,0)'), wireframe: false});
const materialPath = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(149,64,191)'), wireframe: false});
const materialPath2 = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(99,14,141)'), wireframe: false});
const materialPathSimplified = new THREE.MeshStandardMaterial({color: new THREE.Color('rgb(127,127,127)'), wireframe: false});

class PathFinder {
  constructor({width = 15, height = 15, voxelHeight = 2, lowestY = 0.1, highestY = 15, highestY2 = 30, debugRender = false}) {
    this.isStart = false;
    this.isRising = false;
    this.isRising2 = false;
    this.isGeneratedVoxelMap = false;
    this.width = (width % 2 === 0) ? (width + 1) : (width);
    this.height = (height % 2 === 0) ? (height + 1) : (height);
    this.voxelHeight = voxelHeight;
    this.voxelHeightHalf = this.voxelHeight / 2;
    this.start = new THREE.Vector3();
    this.dest = new THREE.Vector3();
    this.lowestY = lowestY;
    this.highestY = highestY;
    this.highestY2 = highestY2;
    this.voxelsY = this.lowestY;
    this.voxelsY2 = this.lowestY;
    this.isAutoInit = false;
    this.debugRender = debugRender;
    this.onlyShowPath = false; // test
    this.iterDetect = 0;
    this.maxIterDetect = 1000;
    this.iterStep = 0;
    this.maxIterStep = 1000;

    this.frontiers = [];
    this.voxels = new THREE.Group();
    this.voxels.name = 'voxels';
    this.voxels.visible = debugRender;
    rootScene.add(this.voxels);
    this.voxels2 = new THREE.Group();
    rootScene.add(this.voxels2);
    this.voxels2.name = 'voxels2';
    this.voxels2.visible = debugRender;

    this.voxelo = {};
    this.voxelo2 = {};

    this.geometry = new THREE.BoxGeometry();
    this.geometry.scale(0.5, this.voxelHeight, 0.5);
    // this.geometry.scale(0.9, 0.1, 0.9);

    this.waypointResult = [];
  }

  getPath(start, dest) {
    this.reset();
    this.start.set(
      Math.round(start.x),
      start.y,
      Math.round(start.z),
    );
    this.dest.set(
      Math.round(dest.x),
      dest.y,
      Math.round(dest.z),
    );

    this.startVoxel = this.createVoxel(this.start);
    this.startVoxel._isStart = true;
    this.startVoxel._isReached = true;
    // this.startVoxel._priority = start.manhattanDistanceTo(dest)
    this.startVoxel._priority = this.start.distanceTo(this.dest);
    this.startVoxel._costSoFar = 0;
    this.frontiers.push(this.startVoxel);
    this.startVoxel.material = materialStart;

    this.destVoxel = this.createVoxel(this.dest);
    this.destVoxel._isDest = true;
    this.destVoxel.material = materialDest;

    // // this.step();
    // this.untilFound();
    // if (this.isFound) {
    //   this.simplifyWaypointResultXZ(this.waypointResult[0]);
    //   this.simplifyWaypointResultXZ2(this.waypointResult[0]);
    //   this.simplifyWaypointResultX(this.waypointResult[0]);
    //   this.simplifyWaypointResultZ(this.waypointResult[0]);
    //   this.waypointResult.shift();
    // }
    // console.log('waypointResult', this.waypointResult.length);

    // if (this.debugRender) {
    //   this.waypointResult.forEach(result => {
    //     const x = result.position.x;
    //     const z = result.position.z;
    //     this.getVoxel(x, z).material = materialPathSimplified;
    //     this.getVoxel2(x, z).material = materialPathSimplified;
    //   });
    // }

    // return this.isFound;
  }

  simplifyWaypointResultX(result) {
    if (result?._next?._next) {
      if (result.position.x === result._next._next.position.x) {
        this.waypointResult.splice(this.waypointResult.indexOf(result._next), 1);
        result._next = result._next._next;
        result._next._prev = result;
        this.simplifyWaypointResultX(result);
      } else {
        this.simplifyWaypointResultX(result._next);
      }
    }
  }

  simplifyWaypointResultZ(result) {
    if (result?._next?._next) {
      if (result.position.z === result._next._next.position.z) {
        this.waypointResult.splice(this.waypointResult.indexOf(result._next), 1);
        result._next = result._next._next;
        result._next._prev = result;
        this.simplifyWaypointResultZ(result);
      } else {
        this.simplifyWaypointResultZ(result._next);
      }
    }
  }

  simplifyWaypointResultXZ(result) {
    if (result?._next?._next?._next) {
      if (
        Math.abs(result._next._next.position.x - result.position.x) === Math.abs(result._next._next.position.z - result.position.z) &&
        (
          (result._prev && Math.abs(result._prev.position.x - result.position.x) === Math.abs(result._prev.position.z - result.position.z)) ||
          (
            result._next.position.x - result.position.x === result._next._next._next.position.x - result._next._next.position.x &&
            result._next.position.z - result.position.z === result._next._next._next.position.z - result._next._next.position.z
          )
        )
      ) {
        this.waypointResult.splice(this.waypointResult.indexOf(result._next), 1);
        result._next = result._next._next;
        result._next._prev = result;
      }
      this.simplifyWaypointResultXZ(result._next);
    } else if (result?._next?._next && !result._next._next._next) {
      if (Math.abs(result._next._next.position.x - result.position.x) === Math.abs(result._next._next.position.z - result.position.z)) {
        this.waypointResult.splice(this.waypointResult.indexOf(result._next), 1);
        result._next = result._next._next;
        result._next._prev = result;
      }
      this.simplifyWaypointResultXZ(result._next);
    }
  }

  simplifyWaypointResultXZ2(result) {
    if (result?._next?._next) {
      const xBias = Math.abs(result._next._next.position.x - result.position.x);
      const zBias = Math.abs(result._next._next.position.z - result.position.z);
      if (
        xBias === zBias &&
        xBias > 1 &&
        zBias > 1
      ) {
        this.waypointResult.splice(this.waypointResult.indexOf(result._next), 1);
        result._next = result._next._next;
        result._next._prev = result;
        this.simplifyWaypointResultXZ2(result);
      } else {
        this.simplifyWaypointResultXZ2(result._next);
      }
    }
  }

  reset() {
    this.isFound = false;
    this.frontiers.length = 0;

    // // pure realtime, no any cache
    // this.voxels.children.length = 0;
    // this.voxels2.children.length = 0;
    // this.voxelo = {};
    // this.voxelo2 = {};

    // simple cache
    this.voxels.children.forEach(voxel => {
      voxel._isStart = false;
      voxel._isDest = false;
      voxel._isReached = false;
      voxel._priority = 0;
      voxel._costSoFar = 0;
      voxel._prev = null;
      voxel._next = null;
      voxel._isPath = false;
      voxel.material = materialIdle;
    });
  }

  createVoxel(position) {
    const voxel = new THREE.Mesh(this.geometry, materialIdle);
    this.voxels.add(voxel);
    voxel.position.copy(position);
    voxel._detectState = 'initial'; // 'initial', 'colliding', 'stopped'
    voxel._isStart = false;
    voxel._isDest = false;
    voxel._isReached = false;
    voxel._priority = 0;
    voxel._costSoFar = 0;
    voxel._prev = null;
    voxel._next = null;

    this.iterDetect = 0;
    this.detect(voxel);
    voxel.updateMatrixWorld();
    this.voxelo[`${position.x}_${position.z}`] = voxel;

    return voxel;
  }

  detect(voxel) {
    if (this.iterDetect >= this.maxIterDetect) {
      // console.log('maxIterDetect: detect');
      return;
    }
    this.iterDetect++;

    let collide = physicsManager.overlapBox(0.5, this.voxelHeightHalf, 0.5, voxel.position, identityQuaternion);
    collide = collide && collide.objectId !== window.npcPlayer.physicsObject.physicsId;

    if (voxel._detectState === 'initial') {
      if (collide) {
        voxel._detectDir = 1;
      } else {
        voxel._detectDir = -1;
      }
    }

    if (voxel._detectDir === 1) {
      if (voxel._detectState === 'initial' || voxel._detectState === 'colliding') {
        if (collide) {
          voxel._detectState = 'colliding';
        } else if (voxel._detectState === 'colliding') {
          voxel._detectState = 'stopped';
        }
      }
      if (voxel._detectState === 'stopped') {
        // do nothing, stop recur
      } else {
        voxel.position.y += voxel._detectDir * 0.1;
        this.detect(voxel);
      }
    } else if (voxel._detectDir === -1) {
      if (voxel._detectState === 'initial') {
        if (collide) {
          voxel._detectState = 'stopped';
        }
      }
      if (voxel._detectState === 'stopped') {
        voxel.position.y += -1 * voxel._detectDir * 0.1;
        // do nothing, stop recur
      } else {
        voxel.position.y += voxel._detectDir * 0.1;
        this.detect(voxel);
      }
    }
  }

  generateVoxelMapLeft(currentVoxel) {
    localVector.copy(currentVoxel.position);
    localVector.x += -1;
    let leftVoxel = this.getVoxel(localVector);
    if (!leftVoxel) {
      leftVoxel = this.createVoxel(localVector);
    }
    if (leftVoxel.position.y - currentVoxel.position.y < heightTolerance) {
      currentVoxel._leftVoxel = leftVoxel;
    }
  }

  generateVoxelMapRight(currentVoxel) {
    localVector.copy(currentVoxel.position);
    localVector.x += 1;
    let rightVoxel = this.getVoxel(localVector);
    if (!rightVoxel) {
      rightVoxel = this.createVoxel(localVector);
    }
    if (rightVoxel.position.y - currentVoxel.position.y < heightTolerance) {
      currentVoxel._rightVoxel = rightVoxel;
    }
  }

  generateVoxelMapBtm(currentVoxel) {
    localVector.copy(currentVoxel.position);
    localVector.z += -1;
    let btmVoxel = this.getVoxel(localVector);
    if (!btmVoxel) {
      btmVoxel = this.createVoxel(localVector);
    }
    if (btmVoxel.position.y - currentVoxel.position.y < heightTolerance) {
      currentVoxel._btmVoxel = btmVoxel;
    }
  }

  generateVoxelMapTop(currentVoxel) {
    localVector.copy(currentVoxel.position);
    localVector.z += 1;
    let topVoxel = this.getVoxel(localVector);
    if (!topVoxel) {
      topVoxel = this.createVoxel(localVector);
    }
    if (topVoxel.position.y - currentVoxel.position.y < heightTolerance) {
      currentVoxel._topVoxel = topVoxel;
    }
  }

  getVoxel(x, z) {
    return this.voxelo[`${x}_${z}`];
  }

  getVoxel2(x, z) {
    return this.voxelo2[`${x}_${z}`];
  }

  tenStep() {
    for (let i = 0; i < 10; i++) this.step();
  }

  untilFound() {
    this.iterStep = 0;
    while (this.frontiers.length > 0 && !this.isFound) {
      if (this.iterStep >= this.maxIterStep) {
        // console.log('maxIterDetect: untilFound');
        return;
      }
      this.iterStep++;

      this.step();
    }
  }

  recur(voxel) {
    if (voxel) {
      // debugRender
      if (this.onlyShowPath) voxel.visible = true;
      if (!voxel._isStart && !voxel._isDest) { // todo: Don't run if !this.debugRender.
        if (voxel.parent === this.voxels) {
          voxel.material = materialPath;
        } else {
          voxel.material = materialPath2;
        }
      }

      voxel._isPath = true;
      if (voxel._prev) voxel._prev._next = voxel;

      this.recur(voxel._prev);
    }
  }

  stepVoxel(voxel, prevVoxel) {
    const newCost = prevVoxel._costSoFar + 1;
    // if (voxel._isReached === false || newCost < voxel._costSoFar) {
    if (voxel._isReached === false) {
      // Seems no need `|| newCost < voxel._costSoFar` ? Need? http://disq.us/p/2mgpazs
      voxel._isReached = true;
      voxel._costSoFar = newCost;

      // todo: use Vector2 instead of _x _z.
      // voxel._priority = tmpVec2.set(voxel._x, voxel._z).manhattanDistanceTo(dest)
      // voxel._priority = tmpVec2.set(voxel._x, voxel._z).distanceToSquared(dest)
      voxel._priority = tmpVec2.set(voxel.position.x, voxel.position.z).distanceTo(this.dest);
      voxel._priority += newCost;
      this.frontiers.push(voxel);
      this.frontiers.sort((a, b) => a._priority - b._priority);

      if (!voxel._isStart && !voxel._isDest) {
        if (voxel.parent === this.voxels) {
          voxel.material = materialFrontier;
        } else {
          voxel.material = materialFrontier2;
        }
      }
      voxel._prev = prevVoxel;
    }
    if (voxel._isDest) {
      // if (this.debugRender) console.log('found');
      this.isFound = true;
      if (this.onlyShowPath) {
        this.voxels.children.forEach(voxel => { voxel.visible = false; });
        this.voxels2.children.forEach(voxel2 => { voxel2.visible = false; });
      }
      this.recur(voxel);

      this.waypointResult.length = 0;
      let wayPoint = this.startVoxel;
      let result = new THREE.Object3D();
      result.position.copy(wayPoint.position);
      this.waypointResult.push(result);
      while (wayPoint._next) {
        wayPoint = wayPoint._next;

        result._next = new THREE.Object3D();
        result._next.position.copy(wayPoint.position);
        this.waypointResult.push(result._next);

        result._next._prev = result;

        result = result._next;
      }
    }
  }

  step() {
    if (this.frontiers.length <= 0) {
      // if (this.debugRender) console.log('finish');
      return;
    }
    if (this.isFound) return;

    const currentVoxel = this.frontiers.shift();
    if (!currentVoxel._isStart) {
      if (currentVoxel.parent === this.voxels) {
        currentVoxel.material = materialReached;
      } else {
        currentVoxel.material = materialReached2;
      }
    }

    this.generateVoxelMapLeft(currentVoxel);
    if (currentVoxel._leftVoxel) {
      this.stepVoxel(currentVoxel._leftVoxel, currentVoxel);
      if (this.isFound) return;
    }

    this.generateVoxelMapRight(currentVoxel);
    if (currentVoxel._rightVoxel) {
      this.stepVoxel(currentVoxel._rightVoxel, currentVoxel);
      if (this.isFound) return;
    }

    this.generateVoxelMapBtm(currentVoxel);
    if (currentVoxel._btmVoxel) {
      this.stepVoxel(currentVoxel._btmVoxel, currentVoxel);
      if (this.isFound) return;
    }

    this.generateVoxelMapTop(currentVoxel);
    if (currentVoxel._topVoxel) {
      this.stepVoxel(currentVoxel._topVoxel, currentVoxel);
      // if (this.isFound) return
    }
  }

  showAll() {
    this.voxels.children.forEach(voxel => { voxel.visible = true; });
    this.voxels2.children.forEach(voxel2 => { voxel2.visible = true; });
  }

  toggleNonPath() {
    this.voxels.children.forEach(voxel => { if (!voxel._isPath) voxel.visible = !voxel.visible; });
    this.voxels2.children.forEach(voxel2 => { if (!voxel2._isPath) voxel2.visible = !voxel2.visible; });
  }

  toggleVoxelsVisible() {
    this.voxels.visible = !this.voxels.visible;
    this.voxels2.visible = !this.voxels2.visible;
  }

  toggleVoxelsWireframe() {
    materialIdle.wireframe = !materialIdle.wireframe;
    materialPath.wireframe = !materialPath.wireframe;

    materialIdle2.wireframe = !materialIdle2.wireframe;
    materialPath2.wireframe = !materialPath2.wireframe;
    materialPathSimplified.wireframe = !materialPathSimplified.wireframe;

    materialStart.wireframe = !materialStart.wireframe;
    materialDest.wireframe = !materialDest.wireframe;
  }

  moveDownVoxels() {
    this.voxels.position.y -= 0.5;
    this.voxels.updateMatrixWorld();

    this.voxels2.position.y -= 0.5;
    this.voxels2.updateMatrixWorld();
  }

  getHighestY() {
    let highestY = -Infinity;
    this.voxels.children.forEach(voxel => {
      if (voxel.position.y > highestY) highestY = voxel.position.y;
    });
    return highestY;
  }

  getHighestY2() {
    let highestY = -Infinity;
    this.voxels2.children.forEach(voxel => {
      if (voxel.position.y > highestY) highestY = voxel.position.y;
    });
    return highestY;
  }
}

export {PathFinder};
