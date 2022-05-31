import * as THREE from 'three';
import {makeId} from './util.js';
import {defaultChunkSize} from './constants.js';
// import metaversefile from 'metaversefile';
// import { terrainVertex, terrainFragment } from './shaders/terrainShader.js';
// import physics from './physics-manager.js';

// const localVector = new THREE.Vector3();

const numWorkers = 2;

class PhysicsWorkerManager {
  constructor() {
    // create workers
    const workers = Array(numWorkers);
    for (let i = 0; i < numWorkers; i++) {
      const worker = new Worker('./physx-worker.js?import', {
        type: 'module',
      });
      const cbs = new Map();
      worker.onmessage = e => {
        const {requestId} = e.data;
        const cb = cbs.get(requestId);
        if (cb) {
          cbs.delete(requestId);
          cb(e.data);
        } else {
          console.warn('worker message without callback', e.data);
        }
      };
      worker.onerror = err => {
        console.log('physx worker load error', err);
      };
      worker.request = (method, args) => {
        return new Promise((resolve, reject) => {
          const requestId = makeId(5);
          cbs.set(requestId, data => {
            const {error, result} = data;
            if (error) {
              reject(error);
            } else {
              resolve(result);
            }
          });
          worker.postMessage({
            method,
            args,
            requestId,
          });
        });
      };
      workers[i] = worker;
    }

    // initialize
    this.workers = workers;
    this.nextWorker = 0;
  }
  async cookGeometry(mesh) {
    const {workers} = this;
    const worker = workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % workers.length;

    const result = await worker.request('cookGeometry', {
      positions: mesh.geometry.attributes.position.array,
      indices: mesh.geometry.index.array,
    });
    return result;
  }
  async cookConvexGeometry(mesh) {
    const {workers} = this;
    const worker = workers[this.nextWorker];
    this.nextWorker = (this.nextWorker + 1) % workers.length;

    const result = await worker.request('cookConvexGeometry', {
      positions: mesh.geometry.attributes.position.array,
      indices: mesh.geometry.index.array,
    });
    return result;
  }
}
const physicsWorkerManager = new PhysicsWorkerManager();
export default physicsWorkerManager;