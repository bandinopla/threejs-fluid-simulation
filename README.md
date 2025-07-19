# ThreeJs Fluid Simulation
A Fluid or Smoke ( or anything you can think of if you use the power of imagination and bend semantics enough) simulation. 

### WebGL version : [src/FluidV3Material.ts](https://github.com/bandinopla/threejs-fluid-simulation/blob/main/src/FluidV3Material.ts)
### WebGPU (32bit texture): [src/FluidMaterialGPU.ts](https://github.com/bandinopla/threejs-fluid-simulation/blob/gpu-compute/src/FluidMaterialGPU.ts)

## [Play Demo here (webGL)](https://threejs-fluid-simulation.vercel.app/) :rocket:

<img src="./screenshot.png?raw=true" width="880">

## References

This is a port from the [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) made by [Pavel Dobryakov](https://github.com/PavelDoGreat) into [ThreeJs](https://github.com/mrdoob/three.js) in a way that is easily implemented to deform a plane to create a sense of liquid or smoke, plasma, etc... [anything that moves this fluid'ish way](https://youtu.be/Rd_F6OF5JfY?t=12)... 

## How it works
Basically 2 textures are created (each is actually 2 ping pong textures) one contains info such as velocity of the fluid/smoke and the other is the color/tint. After every update these textures are updated, so you can then use them as you please really... maybe expand on them and do something else?

```js
fluidMat.colorTexture; // THREE.Texture : color of the tint...
fluidMat.dataTexture; //  THREE.Texture : R=Pressure  GB = velocity  A=wildcard/don't use this

```

## Usage

Copy and paste the class into your own project (everything is self contained in that single class) 

> ** check the file `main-webgl.ts` and `main-web-gpu.ts` to see example of use **


#### Example use of WEB L version:
```js
const fluidMat = new FluidV3Material( 
    renderer, // reference to the threejs renderer (needed to do the simulation)
    textureWidth,  // size of textures in pixel (4 textures will be created with this dimension, so beware...)
    textureHeight, 
    objectCount // int: how many objects you estimate will need to track for movement
    );

// remember to give the geometry the same aspect ratio as the image...
const planeGeo = new THREE.PlaneGeometry(1, textureHeight/textureWidth, 132, 132);
      planeGeo.rotateX(-Math.PI / 2);
const fluidMesh = new THREE.Mesh( planeGeo, this.fluidMat );
```
## Track objects
To add objects to affect the material (their prev and current position will be used as vectors of movement):
```js
/*WebGL*/fluidMat.track( someObject3D, 1, 0xff0000 ); // o`bject, ratio, color
/*WebGPU*/fluidMat.track( someObject3D, 1, new THREE.Color(0xff0000) ); // object, ratio, color
fluidMat.untrack( someObject3D ); 
```

## "FOLLOW" mode...
If you set...
```js
fluidMat.follow = someObject;
```
On every update the `fluidMat` will reposition the `fluidMesh` to the same location as the target (only in the XZ plane not Y) and sroll the texture when the object moves, to allow an infinite displacement effect... so you don't ran out of liquid... but the down side is that some weird artifacts may or may not appear on the edges (due to the scrolling)

## Debug panel
Add a folder in your `lil-gui.module.min.js` to tweak the material. 
```js
fluidMat.addDebugPanelFolder( panel, 'My crazy smoke' );
```

## Paste tweaked settings
```js
fluidMat.setSettings( ...the json );
```

## SIMULATE / UPDATE
On your update loop:

```js
    //[...] move your objects positions as you wish... then

    fluidMat.update( delta, fluidMesh ); // this will run the simulation
```



## License

The code is available under the [MIT license](LICENSE)
