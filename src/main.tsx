 
import './index.css'
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/Addons.js";
import Stats from "three/examples/jsm/libs/stats.module.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import "./index.css";
import { FluidV3Material } from './FluidV3Material';
import { Sky } from 'three/addons/objects/Sky.js';

const stats = new Stats();
document.body.appendChild(stats.dom);

const panel = new GUI({ width: 310 });
 
const renderer = new THREE.WebGLRenderer({ antialias: true });
document.body.appendChild(renderer.domElement);
renderer.setSize(innerWidth, innerHeight);

renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;

// Setup camera and scene
const camera = new THREE.PerspectiveCamera(
  45,
  innerWidth / innerHeight,
  0.1,
  100
);
camera.position.set(1, 1, 1);
camera.lookAt(0, 0, 0);

const scene = new THREE.Scene();

setupSky();


const color = 0xffffff;
const intensity = 3;
const light = new THREE.DirectionalLight(color, intensity);
light.position.set(4, 1, 0);
light.castShadow = true;
scene.add(light);

scene.add(new THREE.AmbientLight(0xffffff, 0.3));
//scene.add( new THREE.AxesHelper(.1));

new OrbitControls(camera, renderer.domElement)

let time = 0;

//---------------------------------------- DEMO SCENE SETUP
  const size = 1024  ;
  const sizey = size/2;
  const objectCount = 1;

  const planeGeo = new THREE.PlaneGeometry(1, sizey/size, 132, 132);
  planeGeo.rotateX(-Math.PI / 2);

  const fluidMat = new FluidV3Material( renderer, size,sizey, objectCount);
  const fluidMesh = new THREE.Mesh( planeGeo, fluidMat );
  scene.add( fluidMesh )

  fluidMat.transmission = .8;
  fluidMat.roughness = 0.1;
  fluidMat.color = new THREE.Color(0xfefefe);
  fluidMat.metalness = .5

  camera.position.set(.5,.5,.5)
  camera.lookAt(new THREE.Vector3(0,0,0))

  scene.background = new THREE.Color(0x333333)

  const ball = new THREE.Mesh( new THREE.SphereGeometry(.01,10,10), new THREE.MeshBasicMaterial({ color:0xff0000 }));
  scene.add( ball );
  ball.position.y = .02;

  const spot = new THREE.PointLight();
  spot.castShadow = true;
  spot.intensity = 0.1;spot.position.set(0,.2,0)
  ball.add( spot );

  fluidMat.track( ball ); //<---- THIS IS WHAT MAKES THE LIQUID REACT TO OBJECTS
 
          //------------------- DEBUG PANEL 
        panel.add( fluidMat, "splatForce", -1000, 1000 );
        panel.add( fluidMat, "splatThickness", 0.001, 0.2 );
        panel.add( fluidMat, "vorticityInfluence", 0.1, 1 );
        panel.add( fluidMat, "swirlIntensity", 1, 100 );
        panel.add( fluidMat, "pressure", 0, 1 );
        panel.add( fluidMat, "velocityDissipation", 0, 1 );
        panel.add( fluidMat, "densityDissipation", 0, 1 );
        panel.add( fluidMat, "displacementScale", -.1, .1 );
        panel.add( fluidMat, "pressureIterations", 1, 100, 1 );

//---------------------------------------------------------

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = clock.getDelta();

  time += delta;
 

  ball.position.x = Math.cos(time)*.1;
  ball.position.z = Math.sin(time)*.1;

  stats.begin();
  fluidMat.update( delta, fluidMesh );
  stats.end()
 
  // Render main scene
  renderer.render(scene, camera);
}
animate();

//---------------------------
function setupSky() {
  const sun = new THREE.Vector3();
  const sky = new Sky();
				sky.scale.setScalar( 10000 );
				scene.add( sky );
const skyUniforms = sky.material.uniforms;

				skyUniforms[ 'turbidity' ].value = 10;
				skyUniforms[ 'rayleigh' ].value = 2;
				skyUniforms[ 'mieCoefficient' ].value = 0.005;
				skyUniforms[ 'mieDirectionalG' ].value = 0.8;

				const parameters = {
					elevation: 2,
					azimuth: 180
				};

				const pmremGenerator = new THREE.PMREMGenerator( renderer );
        let renderTarget:THREE.WebGLRenderTarget;

        function updateSun() {

					const phi = THREE.MathUtils.degToRad( 90 - parameters.elevation );
					const theta = THREE.MathUtils.degToRad( parameters.azimuth );

					sun.setFromSphericalCoords( 1, phi, theta );

					sky.material.uniforms[ 'sunPosition' ].value.copy( sun );
					//water.material.uniforms[ 'sunDirection' ].value.copy( sun ).normalize();

					if ( renderTarget !== undefined ) renderTarget.dispose();

					scene.add( sky );
					renderTarget = pmremGenerator.fromScene( scene );
					scene.add( sky );

					scene.environment = renderTarget.texture;

				}

				updateSun();
}
