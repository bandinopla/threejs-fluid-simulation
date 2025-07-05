/*
MIT License

Copyright (c) 2017 Pavel Dobryakov : Original WebGL shader code (https://github.com/PavelDoGreat/WebGL-Fluid-Simulation/tree/master)
Copyright (c) 2025 Pablo Bandinopla (https://x.com/bandinopla) : Modificated and addapted for ThreeJs

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";
import { Color, ColorRepresentation, DataTexture, FloatType, Mesh, MeshPhysicalMaterial, Object3D, Raycaster, RGBAFormat, ShaderMaterial, Vector2, Vector3, WebGLRenderer, WebGLRenderTarget, type WebGLProgramParametersWithUniforms } from "three";
import { FullScreenQuad } from "three/examples/jsm/Addons.js";

/**
 * R - Pressure
 * G - X dir
 * B - Y dir
 * A - wildcard, used to pass values from shader to shader. Not persisted.
 */

const vertexShader = `
                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform vec2 texelSize;

                void main() {
                    vUv = uv;
                    
                    vL = uv - vec2(texelSize.x, 0.0);
                    vR = uv + vec2(texelSize.x, 0.0);
                    vT = uv + vec2(0.0, texelSize.y);
                    vB = uv - vec2(0.0, texelSize.y);

                    gl_Position = vec4(position, 1.0);
                }
            `;

class ScrollShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uTarget: { value: null },
                texelSize: { value: texelSize },
                uvScroll: { value: null },
            },
            vertexShader,
            fragmentShader: `
                precision mediump float;
                varying highp vec2 vUv;
                uniform sampler2D uTarget;
                uniform vec2 uvScroll;

                void main() {
                    gl_FragColor = texture2D(uTarget, vUv + uvScroll);
                }
            `
        })
    }
}

/**
 * Introduces either velocity or color into target. Depending on `splatVelocity` flag.
 */
class SplatShader extends ShaderMaterial {
    constructor( texelSize:Vector2, objectCount:number, aspectRatio:number ) {
        super({
            uniforms: {
                uTarget: { value: null },
                splatVelocity: { value:false },
                color: { value: new Color(0xffffff) },
                texelSize: { value: texelSize },
                objectData: { value: null }, // Contains current and previous object positions 
                objectPosition: { value: null }, // Contains current and previous object positions 
                count: { value: objectCount }, 
                thickness: { value: 1 }, // in UV units
                aspectRatio: { value:aspectRatio } // in UV units
                , splatForce: { value: -196 }
            },

            vertexShader,
            fragmentShader:`
                precision mediump float;
                precision mediump sampler2D;

                varying highp vec2 vUv; 
                uniform sampler2D uTarget;
                uniform sampler2D objectData; //color + ratio
                uniform sampler2D objectPosition; // current + old uv positions
                uniform int count; 
                uniform float thickness; //TODO: this shold be individual per object to allow diferent types of bodies affecting the liquid
                uniform float aspectRatio;
                uniform highp vec2 texelSize;
                uniform bool splatVelocity;
                uniform vec3 color;
                uniform float splatForce;

                void main () { 

                    vec4 pixel = texture2D(uTarget, vUv);  

                    // Add External Forces (from objects)
                    // IMPROVEMENT: This loop is much more efficient as it reads from a texture.
                    for (int i = 0; i < count; i++) {
                        // Read object data from the texture.
                        // texelFetch is used for direct, un-interpolated pixel reads.
                        vec4 data = texelFetch(objectData, ivec2(i, 0), 0);
                        vec4 positions = texelFetch(objectPosition, ivec2(i, 0), 0);
                        vec2 curr = positions.xy; // Current position in .xy
                        vec2 prev = positions.zw; // Previous position in .zw
                        float ratio = data.a * thickness;

                        vec2 diff = curr - prev;
                        if (length(diff) == 0.0) continue; // Skip if the object hasn't moved 

                        vec2 toFrag = vUv - prev;
                        float t = clamp(dot(toFrag, diff) / dot(diff, diff), 0.0, 1.0);
                        vec2 proj = prev + t * diff;

                        vec2 aspect = vec2(aspectRatio, 1.0);

                        // Calculate distance in a way that respects the screen's aspect ratio
                        float d = distance(vUv * aspect, proj * aspect);

                        if (d < ratio) {
                            // IMPROVEMENT: Correct influence logic.
                            // Influence is strongest when distance 'd' is 0.
                            float influence = smoothstep(ratio, 0.0, d);

                            if( splatVelocity )
                            {

                                vec2 vel = normalize( ( diff )/texelSize ) * -splatForce;
                                

                                //vel = mix( pixel.gb, vel, influence );

                                pixel.g = vel.x;
                                pixel.b = vel.y;
                            }
                            else 
                            {

                                pixel = mix( pixel, vec4( data.rgb, 1.0 ), influence );
                            }
 
                        }
                    } 

                    gl_FragColor = pixel;
                }
            `
        })
    }
}


/**
 * sets vorticity inthe alpha channel of uVelocity image
 */
class CurlShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uVelocity: { value: null },
                texelSize: { value: texelSize },
                vorticityInfluence: { value:1 }
            },
            vertexShader,
            fragmentShader:`
                precision mediump float;
                precision mediump sampler2D;

                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uVelocity;
                uniform float vorticityInfluence;

                void main () {
                    float L = texture2D(uVelocity, vL).b;
                    float R = texture2D(uVelocity, vR).b;
                    float T = texture2D(uVelocity, vT).g;
                    float B = texture2D(uVelocity, vB).g;
                    float vorticity = R - L - T + B;

                    vec4 pixel = texture2D(uVelocity, vUv);

                    pixel.a = vorticityInfluence * vorticity; // set in the 4th component...

                    gl_FragColor = pixel;
                }
            `
        })
    }
}

/**
 * updates the velocity image
 */
class VorticityShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uVelocityAndCurl: { value: null },
                texelSize: { value: texelSize },
                curl: { value: 1 },
                dt: { value: 0 },
            },
            vertexShader,
            fragmentShader:`
                precision highp float;
                precision highp sampler2D;

                varying vec2 vUv;
                varying vec2 vL;
                varying vec2 vR;
                varying vec2 vT;
                varying vec2 vB;
                uniform sampler2D uVelocityAndCurl; 
                uniform float curl;
                uniform float dt;

                void main () {
                    float L = texture2D(uVelocityAndCurl, vL).a;
                    float R = texture2D(uVelocityAndCurl, vR).a;
                    float T = texture2D(uVelocityAndCurl, vT).a;
                    float B = texture2D(uVelocityAndCurl, vB).a;
                    float C = texture2D(uVelocityAndCurl, vUv).a;

                    vec2 force = 0.5 * vec2(abs(T) - abs(B), abs(R) - abs(L));
                    force /= length(force) + 0.0001;
                    force *= curl * C;
                    force.y *= -1.0;

                    vec4 pixel = texture2D(uVelocityAndCurl, vUv);

                    vec2 velocity = pixel.gb;
                    velocity += force * dt;
                    velocity = min(max(velocity, -1000.0), 1000.0);  

                    gl_FragColor = vec4( pixel.r, velocity, 0.0 ); 
                }
            `
        })
    }
}

/**
 * Adds divergence in the alpha channel of the velocity image
 */
class DivergenceShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uVelocity: { value: null },
                texelSize: { value: texelSize }, 
            },
            vertexShader,
            fragmentShader:`
                precision mediump float;
                precision mediump sampler2D;

                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uVelocity;

                void main () {
                    float L = texture2D(uVelocity, vL).g;
                    float R = texture2D(uVelocity, vR).g;
                    float T = texture2D(uVelocity, vT).b;
                    float B = texture2D(uVelocity, vB).b;

                    vec4 pixel = texture2D(uVelocity, vUv);

                    vec2 C = pixel.gb;
                    if (vL.x < 0.0) { L = -C.x; }
                    if (vR.x > 1.0) { R = -C.x; }
                    if (vT.y > 1.0) { T = -C.y; }
                    if (vB.y < 0.0) { B = -C.y; }

                    float div = 0.5 * (R - L + T - B);

                    gl_FragColor = vec4( pixel.r, C, div );
                }
            `
        })
    }
}

/**
 *  Multiplies the pressure by `value` uniform
 */
class ClearShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uTexture: { value: null },
                value: { value: 0.317 }, //PRESSURE
                texelSize: { value: texelSize }, 
            },
            vertexShader,
            fragmentShader:`
                precision mediump float;
                precision mediump sampler2D;

                varying highp vec2 vUv;
                uniform sampler2D uTexture;
                uniform float value;

                void main () {
                    vec4 pixel = texture2D(uTexture, vUv);

                    pixel.r *= value;

                    gl_FragColor = pixel ;
                }
            `
        })
    }
}

/**
 * updates the pressure of the image
 */
class PressureShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uPressureWithDivergence: { value: null }, 
                texelSize: { value: texelSize }, 
            },
            vertexShader,
            fragmentShader:`
                precision mediump float;
                precision mediump sampler2D;

                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uPressureWithDivergence; 

                void main () {
                    float L = texture2D(uPressureWithDivergence, vL).x;
                    float R = texture2D(uPressureWithDivergence, vR).x;
                    float T = texture2D(uPressureWithDivergence, vT).x;
                    float B = texture2D(uPressureWithDivergence, vB).x;
                    float C = texture2D(uPressureWithDivergence, vUv).x;

                    vec4 pixel = texture2D(uPressureWithDivergence, vUv);
                    float divergence = pixel.a;
                    float pressure = (L + R + B + T - divergence) * 0.25;

                    pixel.x = pressure;

                    gl_FragColor = pixel;  
                }
            `
        })
    }
}


class GradientSubtractShader extends ShaderMaterial {
    constructor( texelSize:Vector2 ) {
        super({
            uniforms: {
                uPressureWithVelocity: { value: null }, 
                texelSize: { value: texelSize }, 
            },
            vertexShader,
            fragmentShader:`
                precision mediump float;
                precision mediump sampler2D;

                varying highp vec2 vUv;
                varying highp vec2 vL;
                varying highp vec2 vR;
                varying highp vec2 vT;
                varying highp vec2 vB;
                uniform sampler2D uPressureWithVelocity; 

                void main () {
                    float L = texture2D(uPressureWithVelocity, vL).x;
                    float R = texture2D(uPressureWithVelocity, vR).x;
                    float T = texture2D(uPressureWithVelocity, vT).x;
                    float B = texture2D(uPressureWithVelocity, vB).x;

                    vec4 pixel = texture2D(uPressureWithVelocity, vUv);

                    vec2 velocity = pixel.gb;
                    velocity.xy -= vec2(R - L, T - B);

                    gl_FragColor = vec4( pixel.r, velocity, 0.0 );
                }
            `
        })
    }
}


class AdvectVelocityShader extends ShaderMaterial {
    constructor( texelSize:Vector2, dyeTexelSize:Vector2, manualFiltering = false ) {
        super({
            uniforms: {
                uVelocity: { value: null }, 
                uSource: { value: null }, 
                sourceIsVelocity: { value: null },
                texelSize: { value: texelSize }, 
                dt: { value: 0 }, 
                dyeTexelSize: { value: dyeTexelSize }, 
                dissipation: { value: 0.2 }, 
            },
            defines: {
                MANUAL_FILTERING: manualFiltering
            },
            vertexShader,
            fragmentShader:`
                precision highp float;
                precision highp sampler2D;

                varying vec2 vUv;
                uniform sampler2D uVelocity; 
                uniform sampler2D uSource; 
                uniform vec2 texelSize;
                uniform vec2 dyeTexelSize;
                uniform float dt;
                uniform float dissipation;
                uniform bool sourceIsVelocity;

                vec4 bilerp (sampler2D sam, vec2 uv, vec2 tsize) {
                    vec2 st = uv / tsize - 0.5;

                    vec2 iuv = floor(st);
                    vec2 fuv = fract(st);

                    vec4 a = texture2D(sam, (iuv + vec2(0.5, 0.5)) * tsize);
                    vec4 b = texture2D(sam, (iuv + vec2(1.5, 0.5)) * tsize);
                    vec4 c = texture2D(sam, (iuv + vec2(0.5, 1.5)) * tsize);
                    vec4 d = texture2D(sam, (iuv + vec2(1.5, 1.5)) * tsize);

                    return mix(mix(a, b, fuv.x), mix(c, d, fuv.x), fuv.y);
                }

                void main () {

                    #ifdef MANUAL_FILTERING
                        vec2 coord = vUv - dt * bilerp(uVelocity, vUv, texelSize).gb * texelSize;
                        vec4 result = bilerp(uSource, coord, dyeTexelSize);
                    #else
                        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).gb * texelSize;
                        vec4 result = texture2D(uSource, coord);
                    #endif
                        float decay = 1.0 + dissipation * dt;
                        result /= decay;

                        if( sourceIsVelocity )
                        {
                            vec4 data = texture2D(uVelocity, vUv);
                            gl_FragColor = vec4( data.r, result.g, result.b, data.a);
                        }
                        else 
                        {
                            gl_FragColor = result;
                        }
                }
            `
        })
    }
}


type TargetObject = {
    target:Object3D|undefined
    index:number

    /**
     * % of texel size... 1=%100 a texel size.
     */
    ratio?:number
    color?:Color
}


type Settings = {
  splatForce: number;
  splatThickness: number;
  vorticityInfluence: number;
  swirlIntensity: number;
  pressure: number;
  velocityDissipation: number;
  densityDissipation: number;
  displacementScale: number;
  pressureIterations: number;
};

export class FluidV3Material extends MeshPhysicalMaterial {

    /**
     * The mesh will forllow this target and the position prev/current will scroll the texture...
     */
    private _follow?:Object3D;
    public get follow() { return this._follow }
    public set follow( obj:Object3D|undefined )
    {
        this._follow = obj;
        obj?.getWorldPosition(this.lastFollowPos);
    }

    private lastFollowPos:Vector3 = new Vector3();
    private followOffset:Vector3 = new Vector3();

    private tracking:TargetObject[] ;

    private currentRT:WebGLRenderTarget;
    private nextRT:WebGLRenderTarget; 

    // the "color" + elevation (the alpha...)
    private dyeRT:WebGLRenderTarget; 
    private nextDyeRT:WebGLRenderTarget; 

    /**
     * Color
     */
    get colorTexture() {
         return this.dyeRT.texture;
    }

    /**
     * Idk why you would need this but maybe you'll find this useful since it contains the velocities of the surface...
     */
    get dataTexture() {
        return this.currentRT.texture;
    }

    private quad:FullScreenQuad;
    private raycaster:Raycaster;
    private tmp:Vector3 = new Vector3();
    private tmp2:Vector3 = new Vector3();



    private objectPositionTexture:DataTexture; // R
    private objectPositionArray:Float32Array;

    private objectDataTexture:DataTexture; // R
    private objectDataArray:Float32Array;



    // shaders involved in the simulation 
    private scroll:ScrollShader;
    private splat:SplatShader;
    private curl:CurlShader;
    private vorticity:VorticityShader;
    private divergenceShader:DivergenceShader;
    private clearShader:ClearShader;
    private pressureShader:PressureShader;
    private gradientShader:GradientSubtractShader;
    private advectionShader:AdvectVelocityShader; 
    private supportLinearFiltering:boolean;

    private t = 0;

    /**
     * If `true` on every update the `alphaMap` will be set to the `colorMap`
     */
    private actAsSmoke = false;

    constructor( private renderer:WebGLRenderer, textureWidth:number, textureHeight:number, objectCount=1 )
    { 
        const aspect = textureWidth / textureHeight;
 
        super({
            roughness: 1,   
            color: new Color( 0xffffff ), 
            displacementScale:0.0078,
            transparent:true
        });

        // ping pong render textures...
        this.currentRT = new WebGLRenderTarget(textureWidth, textureHeight, { type: FloatType });
        this.nextRT = new WebGLRenderTarget(textureWidth, textureHeight, { type: FloatType });


        // color textures.
        this.dyeRT = new WebGLRenderTarget(textureWidth, textureHeight, { type: FloatType });
        this.nextDyeRT = new WebGLRenderTarget(textureWidth, textureHeight, { type: FloatType });


        // 2. Create a Float32Array to hold the data
        
        this.objectDataArray = new Float32Array(objectCount * 4);// color + ratio: R, G, B, ratio
        this.objectPositionArray = new Float32Array(objectCount * 4);// current + old UV positions: current.x, current.y, prev.x, prev.y 

        // 3. Create the DataTexture
        this.objectDataTexture = new DataTexture(
            this.objectDataArray,
            objectCount, // width
            1,           // height
            RGBAFormat,
            FloatType
        );  

        this.objectPositionTexture = new DataTexture(
            this.objectPositionArray,
            objectCount, // width
            1,           // height
            RGBAFormat,
            FloatType
        );  

        this.tracking = new Array(objectCount).fill(0).map((_, index) => ({ target:undefined, index, ratio:1 }));

        this.quad = new FullScreenQuad(); 
        this.raycaster = new Raycaster();
        
        const texel = new Vector2( 1/textureWidth, 1/textureHeight );

        // ----- shaders used to simulate the liquid -----

        const gl = renderer.getContext();
        this.supportLinearFiltering = !!gl.getExtension('OES_texture_half_float_linear');

        this.scroll = new ScrollShader( texel );
        this.splat = new SplatShader( texel, objectCount, aspect );
        this.curl = new CurlShader(texel);
        this.vorticity = new VorticityShader( texel );
        this.divergenceShader = new DivergenceShader( texel );
        this.clearShader = new ClearShader( texel );
        this.pressureShader = new PressureShader(texel);
        this.gradientShader = new GradientSubtractShader(texel);
        this.advectionShader = new AdvectVelocityShader(texel, texel, this.supportLinearFiltering? false : true );
    }



    get splatForce() {
        return this.splat.uniforms.splatForce.value;
    }
    set splatForce( v:number ) {
        this.splat.uniforms.splatForce.value = v;
    }

    get splatThickness() { return this.splat.uniforms.thickness.value }
    set splatThickness(v:number) {  this.splat.uniforms.thickness.value=v }
    get vorticityInfluence() { return this.curl.uniforms.vorticityInfluence.value }
    set vorticityInfluence(v:number) {  this.curl.uniforms.vorticityInfluence.value=v }

    get swirlIntensity() { return this.vorticity.uniforms.curl.value }
    set swirlIntensity(v:number) {  this.vorticity.uniforms.curl.value=v } 

    get pressure() { return this.clearShader.uniforms.value.value }
    set pressure(v:number) {  this.clearShader.uniforms.value.value=v } 

    velocityDissipation = 0.283;
    densityDissipation = 0.138;
    pressureIterations = 39;

    /**
     * Make normals respect the displacement... 
     */
    override onBeforeCompile( shader: WebGLProgramParametersWithUniforms ): void {
         // Pass UV and world position to fragment shader
            shader.vertexShader = shader.vertexShader
                .replace(
                    '#include <common>',
                    `#include <common>
                    varying vec2 vUv;
                    varying vec3 vWorldPos;`
                )
                .replace(
                    '#include <uv_vertex>',
                    `#include <uv_vertex>
                    vUv = uv;`
                )
                .replace(
                    '#include <project_vertex>',
                    `#include <project_vertex>
                    vWorldPos = position; // (modelMatrix * vec4(position, 1.0)).xyz;`
                ).replace(
                    '#include <displacementmap_vertex>',
                    `
                    #ifdef USE_DISPLACEMENTMAP
                    
                        vec3 dispColor = texture2D( displacementMap, vUv ).rgb;
                        float displacement = max( max(dispColor.r, dispColor.g),  dispColor.b );
                        
                        transformed += normalize( objectNormal ) * ( displacement * displacementScale + displacementBias );
                        
                    #endif
                `
    );

            // Displace in fragment and recompute normals from that
            shader.fragmentShader = shader.fragmentShader
                .replace(
                '#include <common>',
                `#include <common>
                uniform sampler2D displacementMap;
                uniform float displacementScale;
                uniform mat3 normalMatrix;
                varying vec2 vUv;
                varying vec3 vWorldPos;`
                )
                .replace(
                '#include <normal_fragment_begin>',
                `
                    vec3 color = texture2D(displacementMap, vUv).rgb;
                    float luminance = dot(color, vec3(0.299, 0.587, 0.114));

                    float d = luminance-0.5; //texture2D(displacementMap, vUv).r - 0.5;
                    vec3 displacedWorld = vWorldPos + vec3(0.0, d * displacementScale, 0.0);

                    vec3 dx = dFdx(displacedWorld);
                    vec3 dy = dFdy(displacedWorld);
                    vec3 displacedNormal = normalize(cross(dx, dy));

                    vec3 normalView = normalize(normalMatrix * displacedNormal);
                    vec3 normal = normalView;
                    vec3 nonPerturbedNormal = normalView;
                `
                ); 
    }

    /**
     * This is where you add "objects" to be tracked to affect the liquid.
     * They current and past positions will be used to calculate their directional speed.
     * @param object 
     */
    track( object:Object3D, ratio = 1, color:ColorRepresentation = Color.NAMES.black ) {
        const freeSlot = this.tracking.find( slot=>!slot.target );
        if( !freeSlot )
        {
            throw new Error(`No room for tracking, all slots taken!`);
        }

        // hacer un raycast desde la posision del objeto hacia abajo
        // averiguar el UV donde nos pega
        // setear ese valor como nuestra posision

        freeSlot.target = object; 
        freeSlot.ratio = ratio; 
        freeSlot.color = new Color(color);

        const i = freeSlot.index;

        this.objectDataArray[ i ] = freeSlot.color.r;
        this.objectDataArray[ i*4+1 ] = freeSlot.color.g;
        this.objectDataArray[ i*4+2 ] = freeSlot.color.b;
        this.objectDataArray[ i*4+3 ] = ratio;


        this.objectDataTexture.needsUpdate = true;
    }

    untrack( object:Object3D )
    {
        this.tracking.forEach( t=> {

            if( t.target==object )
            {
                t.target = undefined;
                t.ratio = 1;
                t.color?.set(0,0,0);

                const i = t.index;

                this.objectDataArray[ i ] = 0;
                this.objectDataArray[ i*4+1 ] = 0;
                this.objectDataArray[ i*4+2 ] = 0;
                this.objectDataArray[ i*4+3 ] = 0;
                this.objectDataTexture.needsUpdate = true;
            }

        });
    }

    /**
     * Update the positions... we use the UVs as the positions. We cast a ray from the objects to the surface simulating the liquid
     * and calculate the UV that is below the object.
     */
    private updatePositions( mesh:Mesh ) { 
        

        if( this.follow ) //asumes the Y is the up vector and we are following only in the XZ plane
        { 
            this.follow.getWorldPosition( this.tmp );

            // 
            this.followOffset.copy( this.tmp ).sub(this.lastFollowPos);
            this.followOffset.y = 0; // ignore the Y axis...

            this.lastFollowPos.copy( this.tmp );

            if( mesh.parent )
            {
                mesh.parent.worldToLocal(this.tmp);
            }

            mesh.position.x = this.tmp.x;  
            mesh.position.z = this.tmp.z;   
        }

        let offset:Vector2|undefined; //UV Offset

        // update objects positions....
        this.tracking.forEach( obj => {

            if( !obj.target ) return; 
             
            this.tmp.set(0,1,0); //<--- assuming the origin ob the objects is at the bottom of the models.
            const wpos = obj.target.localToWorld( this.tmp );
            const followingObj = obj.target==this.follow;

            // if this is the object we are following...
            if( followingObj )
            { 
                wpos.sub( this.followOffset );// because we ant to sample the UV at the last position since following means the obj will be fixed at 0.5 0.5 UV at dead center
            }  

            this.tmp2.copy( wpos );

            const rpos = mesh.worldToLocal( this.tmp2 );
                rpos.y = 0; // this will put the position at the surface of the mesh

                mesh.localToWorld( rpos ); // this way we point at the surface of the mesh.
 

            this.raycaster.set( wpos, rpos.sub(wpos).normalize() );

            const hit = this.raycaster.intersectObject( mesh, true);

            if( hit.length )
            {
                const uv = hit[0].uv; // <--- UV under the object
                
                if( uv )
                {
                    const i = obj.index;

                    if( followingObj )
                    {
                        // old positions...
                        this.objectPositionArray[i * 4 + 2] = uv.x;
                        this.objectPositionArray[i * 4 + 3] = uv.y; 

                        // new positions...
                        this.objectPositionArray[i * 4 + 0] = 0.5;
                        this.objectPositionArray[i * 4 + 1] = 0.5; 

                        ///////
                        offset = new Vector2(  0.5-uv.x, 0.5-uv.y );

                        this.scrollTextures( offset ); 
 
                    }
                    else 
                    {
                        // old positions...
                        this.objectPositionArray[i * 4 + 2] = this.objectPositionArray[i * 4 + 0];
                        this.objectPositionArray[i * 4 + 3] = this.objectPositionArray[i * 4 + 1]; 

                        // new positions...
                        this.objectPositionArray[i * 4 + 0] = uv.x;
                        this.objectPositionArray[i * 4 + 1] = uv.y; 
                    }

                    
 
                }
                
            } 

        }); 

        if( this.follow && offset!=null )
        {
            // the UV was scrolled, so we must dubstract this offset from all positions exept the follow target
            this.tracking.forEach( obj => {
                if( obj.target && obj.target!=this.follow )
                { 
                    const i = obj.index;
                    this.objectPositionArray[i * 4 + 2] -= offset!.x;  
                    this.objectPositionArray[i * 4 + 3] -= offset!.y;  
                }
            });
        }

        this.objectPositionTexture.needsUpdate = true;
    }
 
    /**
     * Renders the material into the next render texture and then swaps them so the new currentRT is the one that was generated by the material.
     */
    private blit( material:ShaderMaterial )
    {
        this.renderer.setRenderTarget( this.nextRT );
        this.quad.material = material;
        this.quad.render(this.renderer); 

        //swap
        [this.currentRT, this.nextRT] = [this.nextRT, this.currentRT];
    }

    private blitDye( material:ShaderMaterial ) {
        this.renderer.setRenderTarget( this.nextDyeRT );
        this.quad.material = material;
        this.quad.render(this.renderer); 

        //swap
        [this.dyeRT, this.nextDyeRT] = [this.nextDyeRT, this.dyeRT];
    }

    private scrollTextures( uvStep:Vector2 )
    {
        this.scroll.uniforms.uvScroll.value = uvStep; 

        this.scroll.uniforms.uTarget.value = this.currentRT.texture; 
        this.blit( this.scroll );  
 
        this.scroll.uniforms.uTarget.value = this.dyeRT.texture; 
        this.blitDye( this.scroll );  
    }

    /** 
     * @param delta 
     * @param mesh The mesh that is the plane tht will be used to simulate the liquid....
     */
    update( delta:number, mesh:Mesh )
    {
        this.t += delta;

        this.updatePositions( mesh );

        // 1. add new velocities based on objects movement
        this.splat.uniforms.objectData.value = this.objectDataTexture;
        this.splat.uniforms.objectPosition.value = this.objectPositionTexture;
        this.splat.uniforms.uTarget.value = this.currentRT.texture; 
        this.splat.uniforms.splatVelocity.value = true; 

        this.blit( this.splat );  

        // add colors
        this.splat.uniforms.objectData.value = this.objectDataTexture;
        this.splat.uniforms.objectPosition.value = this.objectPositionTexture;
        this.splat.uniforms.uTarget.value = this.dyeRT.texture; 
        this.splat.uniforms.splatVelocity.value = false; 

        this.blitDye( this.splat );   

        // 2. vorticity : will be put into the alpha channel...
        this.curl.uniforms.uVelocity.value = this.currentRT.texture;
        this.blit( this.curl );  

        // 3. apply vorticity forces
        this.vorticity.uniforms.uVelocityAndCurl.value = this.currentRT.texture;
        this.vorticity.uniforms.dt.value = delta;
        this.blit( this.vorticity );  

        // 4. divergence
        this.divergenceShader.uniforms.uVelocity.value = this.currentRT.texture;
        this.blit( this.divergenceShader );

        // 5. clear pressure
        this.clearShader.uniforms.uTexture.value = this.currentRT.texture;
        this.blit( this.clearShader );

        // 6. calculates and updates pressure  

        for (let i = 0; i < this.pressureIterations; i++) {
            this.pressureShader.uniforms.uPressureWithDivergence.value = this.currentRT.texture;
            this.blit( this.pressureShader );
        } 

        // 7. Gradient
        this.gradientShader.uniforms.uPressureWithVelocity.value = this.currentRT.texture;
        this.blit( this.gradientShader );

        // 8. Advect velocity
        this.advectionShader.uniforms.dt.value = delta;

        this.advectionShader.uniforms.uVelocity.value = this.currentRT.texture; 
        this.advectionShader.uniforms.uSource.value = this.currentRT.texture; 
        this.advectionShader.uniforms.sourceIsVelocity.value = true; 
        this.advectionShader.uniforms.dissipation.value = this.velocityDissipation; //VELOCITY_DISSIPATION
        this.blit( this.advectionShader );
 
        // 8. Advect dye / color
        this.advectionShader.uniforms.uVelocity.value = this.currentRT.texture; 
        this.advectionShader.uniforms.uSource.value = this.dyeRT.texture; 
        this.advectionShader.uniforms.sourceIsVelocity.value = false; 
        this.advectionShader.uniforms.dissipation.value = this.densityDissipation; //DENSITY_DISSIPATION 
        this.blitDye( this.advectionShader );

        

        this.renderer.setRenderTarget(null);

        this.displacementMap = this.dyeRT.texture; 

        if( this.actAsSmoke )
        { 
            this.alphaMap = this.dyeRT.texture;
        }  
        this.map = this.dyeRT.texture;
        
    }

    addDebugPanelFolder( gui:GUI, name="Fluid Material") {

        const panel = gui.addFolder(name);

        panel.add( this as Record<string, any>, "splatForce", -1000, 1000 );
        panel.add( this as Record<string, any>, "splatThickness", 0.001, 0.2 );
        panel.add( this as Record<string, any>, "vorticityInfluence", 0.1, 1 );
        panel.add( this as Record<string, any>, "swirlIntensity", 1, 100 );
        panel.add( this as Record<string, any>, "pressure", 0, 1 );
        panel.add( this as Record<string, any>, "velocityDissipation", 0, 1 );
        panel.add( this as Record<string, any>, "densityDissipation", 0, 1 );
        panel.add( this as Record<string, any>, "displacementScale", -.1, .1 );
        panel.add( this as Record<string, any>, "pressureIterations", 1, 100, 1 );
        panel.add( {
            copySettings: ()=>{

                const settings = {
                    splatForce: this.splatForce,
                    splatThickness: this.splatThickness,
                    vorticityInfluence: this.vorticityInfluence,
                    swirlIntensity: this.swirlIntensity,
                    pressure: this.pressure,
                    velocityDissipation: this.velocityDissipation,
                    densityDissipation: this.densityDissipation,
                    displacementScale: this.displacementScale,
                    pressureIterations: this.pressureIterations,
                }

                navigator.clipboard.writeText( JSON.stringify(settings, null, 2));
                
            }
        }, "copySettings" );

        panel.add(this as Record<string, any>, "asSolid"); 
        panel.add(this as Record<string, any>, "asSmoke");
    }

    asSolid() {
        this.alphaMap = null;
        this.transparent = false;
        this.actAsSmoke = false;
    }

    asSmoke() {
        this.transparent = true;
        this.actAsSmoke = true;
        this.actAsSmoke = true;
    }

    /**
     * Restore values previously copied from the debug panel...
     * @see `addDebugPanelFolder`
     */
    setSettings( s:Settings ) {
        this.splatForce = s.splatForce;
        this.splatThickness = s.splatThickness;
        this.vorticityInfluence = s.vorticityInfluence;
        this.swirlIntensity = s.swirlIntensity;
        this.pressure = s.pressure;
        this.velocityDissipation = s.velocityDissipation;
        this.densityDissipation = s.densityDissipation;
        this.displacementScale = s.displacementScale;
        this.pressureIterations = s.pressureIterations; 
    }
}