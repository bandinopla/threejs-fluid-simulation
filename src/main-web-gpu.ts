
import './index.css'
import * as THREE from 'three/webgpu';
import { OrbitControls } from "three/examples/jsm/Addons.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import "./index.css";
import { FluidMaterialGPU } from './FluidMaterialGPU';

const stats = new Stats();
document.body.appendChild(stats.dom);

const panel = new GUI({ width: 310 });

const renderer = new THREE.WebGPURenderer({ antialias: true });
document.body.appendChild(renderer.domElement);
renderer.setSize(innerWidth, innerHeight);
renderer.setAnimationLoop(animate)
 

// Setup camera and scene
const camera = new THREE.PerspectiveCamera(
    45,
    innerWidth / innerHeight,
    0.1,
    100
);
camera.position.set(1, 1, 2);
camera.lookAt(0, 0, 0);

const scene = new THREE.Scene();



const color = 0xffffff;
const intensity = 3;
const light = new THREE.DirectionalLight(color, intensity);
light.position.set(-.5, 1, -4);
light.castShadow = true;
scene.add(light);

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
//scene.add( new THREE.AxesHelper(.1));

new OrbitControls(camera, renderer.domElement)

let time = 0;

//---------------------------------------- DEMO SCENE SETUP
const size = 1024 / 2; //Remember 4 textures will be created with this size...
const sizey = size;
const objectCount = 2;

const planeGeo = new THREE.PlaneGeometry(3, 3, 1, 1);
planeGeo.rotateX(-Math.PI / 2);

const fluidMat = new FluidMaterialGPU(renderer, size, sizey, objectCount);
const fluidMesh = new THREE.Mesh(planeGeo, fluidMat);
scene.add(fluidMesh)

scene.background = new THREE.Color(0x333333)

const ball = new THREE.Mesh(new THREE.SphereGeometry(.03, 10, 10), new THREE.MeshPhysicalMaterial({ color: 0xff0000 }));
scene.add(ball);
ball.position.y = .02;


// const ball2 = new THREE.Mesh(new THREE.SphereGeometry(.06, 10, 10), new THREE.MeshPhysicalMaterial({ color: 0x00ff000 }));
// //scene.add(ball2);
// ball.position.y = .02;
// ball.position.x = 1;

//fluidMat.follow = ball;

const spot = new THREE.PointLight();
spot.castShadow = true;
spot.intensity = 0.1; spot.position.set(0, .2, 0)
ball.add(spot);

fluidMat.track(ball, 10, new THREE.Color(0xff0000)); //<---- THIS IS WHAT MAKES THE LIQUID REACT TO OBJECTS
//fluidMat.track(ball2, 20, new THREE.Color(0x00ff00)); //<---- THIS IS WHAT MAKES THE LIQUID REACT TO OBJECTS

//------------------- DEBUG PANEL 
fluidMat.addDebugPanelFolder(panel);
fluidMat.setSettings({
    "splatForce": 164,
    "splatThickness": 0.624375,
    "vorticityInfluence": 0.7902,
    "swirlIntensity": 27.027,
    "pressureDecay": 0.312,
    "velocityDissipation": 0.283,
    "densityDissipation": 0.68,
    "bumpDisplacmentScale": 0.0316,
    "pressureIterations": 39
})

//---------------------------------------------------------

const clock = new THREE.Clock();

function animate() { 

    const delta = clock.getDelta();

    time += delta; 

    ball.position.x = Math.cos(time) * .3;
    ball.position.z = Math.sin(time) * .3;


    // ball2.position.x = .2 + Math.sin(time) * .2;
    // ball2.position.z = Math.cos(time) * .2;

    stats.begin();
    fluidMat.update(delta, fluidMesh);
    stats.end()

    // Render main scene
    renderer.render(scene, camera);
} 

//--------------------------- 
