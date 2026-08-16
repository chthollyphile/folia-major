import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// src/components/visualizer/brut/brutFrameGeometry.ts
// The steel bracket a single lyric token is bolted onto: a small shelf with a lip and two bolt
// heads. Scaled in X per token, so the bolts sit at a fixed inset rather than stretching with the
// token's width - which is why they are modelled at the ends of a unit-length plate.

export const createBrutBracketGeometry = (): THREE.BufferGeometry => {
    const plate = new THREE.BoxGeometry(1, 0.038, 0.12);
    const lip = new THREE.BoxGeometry(1, 0.07, 0.024);
    lip.translate(0, 0.036, 0.048);

    const bolt = new THREE.CylinderGeometry(0.022, 0.022, 0.05, 8);
    bolt.rotateX(Math.PI / 2);
    const leftBolt = bolt.clone();
    const rightBolt = bolt.clone();
    leftBolt.scale(1, 1, 1);
    leftBolt.translate(0, 0, 0.09);
    rightBolt.translate(0, 0, 0.09);
    // Bolts sit inside the plate's own half-extent so an X scale keeps them near the ends.
    leftBolt.translate(-0.42, 0, 0);
    rightBolt.translate(0.42, 0, 0);

    const merged = mergeGeometries([plate, lip, leftBolt, rightBolt], false);
    plate.dispose();
    lip.dispose();
    bolt.dispose();
    leftBolt.dispose();
    rightBolt.dispose();
    return merged ?? new THREE.BoxGeometry(1, 0.055, 0.15);
};
