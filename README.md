# ThreeJs Fluid Simulation

[Play Demo here](https://threejs-fluid-simulation.vercel.app/)

<img src="./screenshot.png?raw=true" width="880">

## References

This is a port from the [WebGL-Fluid-Simulation](https://github.com/PavelDoGreat/WebGL-Fluid-Simulation) made by [Pavel Dobryakov](https://github.com/PavelDoGreat) into [ThreeJs](https://github.com/mrdoob/three.js) in a way that is easily implemented to deform a plane to create a sense of liquid. 

## Use
To use this, you instantiate the material `FluidV3Material`

```js
const fluidMat = new FluidV3Material( 
    renderer, // reference to the threejs renderer (needed to do the simulation)
    textureWidth,  // size of textures in pixel
    textureHeight, 
    objectCount // int: how many objects you estimate will need to track for movement
    );

// remember to give the geometry the same aspect ratio as the image...
const planeGeo = new THREE.PlaneGeometry(1, textureHeight/textureWidth, 132, 132);
      planeGeo.rotateX(-Math.PI / 2);
const fluidMesh = new THREE.Mesh( planeGeo, this.fluidMat );
```

To add objects to affect the liquid:
```js
fluidMat.track( someObject3D );
```


And then, on your update loop:

```js
    //[...] move your objects positions as you wish... then

    fluidMat.update( delta, fluidMesh ); // this will run the simulation
```



## License

The code is available under the [MIT license](LICENSE)
