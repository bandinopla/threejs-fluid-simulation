 
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
import { abs, add, clamp, Continue, cross, debug, distance, dot, Fn, If, length, Loop, max, mix, modelNormalMatrix, mul, normalGeometry, normalize, positionLocal, smoothstep, texture, uniform, uv, vec2, vec3, vec4, type ShaderNodeObject } from "three/tsl";
import { Camera, Color, DataTexture, DoubleSide, FloatType, LinearFilter, Mesh, MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, NearestFilter, Object3D, PlaneGeometry, Raycaster, RenderTarget, RGBAFormat, Scene, Texture, TextureNode, UniformNode, Vector2, Vector3, WebGPURenderer, type ColorRepresentation } from "three/webgpu";
 
type Sampler2D = ShaderNodeObject<TextureNode>;
type UniformVec2 = ShaderNodeObject<UniformNode<Vector2>>;

let placeholderTexture = new Texture();
 placeholderTexture.flipY = false; 

const offsetSample = Fn<[Sampler2D, UniformVec2, number, number]>(([ sampler, texel, x, y ])=>{
     return sampler.sample( uv().add( texel.mul( vec2(x,y) ) )  );
});

//----------------------------------------------------
 

class ScrollShader extends MeshBasicNodeMaterial
{  
    readonly uvScroll = uniform(new Vector2())
    constructor( uTarget:Sampler2D ) {  
        super();
        this.fragmentNode = uTarget.sample( uv().add( this.uvScroll ));
    }
}

class SplatShader extends MeshBasicNodeMaterial {
    readonly splatVelocity = uniform( 1 );
    readonly count = uniform(1); 
    readonly splatForce = uniform(-196);
    readonly thickness = uniform(1);

    constructor( uTarget:Sampler2D, uData:Sampler2D, textelSize:UniformVec2 ) {
        super();   

        this.fragmentNode = Fn(()=>{
 
            const vUv = uv();
            const pixel = uTarget.sample(vUv ).toVar('pixel');
            
            Loop( this.count, ( { i } ) => {
 
                const pos = uData.sample( vec2(i, 0));
                const curr = pos.xy;
                const prev = pos.zw;
                const data = uData.sample( vec2(i, 1));
                const color = data.rgb;
                const ratio = data.a.mul( this.thickness );
                 
                const diff = curr.sub( prev );

                If( length( diff ).equal( 0.0 ), () => {

                    Continue();

                } );
 
                const toFrag = vUv.sub( prev ); 
                const t = clamp( dot( toFrag, diff ).div( dot( diff, diff ) ), 0, 1 ) 
                const proj = prev.add( t.mul(diff) ); 
 

                const d = distance(vUv, proj );

                If( d.lessThan( textelSize.x.mul( ratio )), ()=>{

                    const influence = smoothstep(ratio, 0.0, d);

                    If( this.splatVelocity , ()=>{

                        const vel =  normalize( diff ).mul( this.splatForce.negate() );
 
                        pixel.assign( vec4(pixel.r, vel, 0));

                    } )
                    .Else(()=>{ 
                        
                        pixel.assign( mix( pixel, vec4( color, 1.0 ) , influence ) ); 
                        

                    }); 

                });


            }); 
           ;

            return pixel;

        })();
 
    } 
}

class CurlShader extends MeshBasicNodeMaterial {
    readonly vorticityInfluence = uniform(1);

    constructor( uVelocity:Sampler2D, textelSize:UniformVec2 ) {
        super(); 
        this.fragmentNode = Fn(()=>{

            const L = offsetSample(uVelocity, textelSize, -1, 0).b; 
            const R = offsetSample(uVelocity, textelSize, 1, 0).b; 
            const T = offsetSample(uVelocity, textelSize, 0, 1).g; 
            const B = offsetSample(uVelocity, textelSize, 0, -1).g; 
            const vorticity = R.sub( L ).sub( T ).add( B ); 
            const pixel = uVelocity.sample( uv() ).toVar("pixel"); 

            return  vec4( pixel.xyz, this.vorticityInfluence.mul(vorticity) ) ; 

        })();
    }
}

class VorticityShader extends MeshBasicNodeMaterial {
    readonly curl = uniform(30);
    readonly delta = uniform(0)

    constructor( uTarget:Sampler2D, textelSize:UniformVec2 ) {
        super();
        this.fragmentNode = Fn(()=>{
            const L = offsetSample(uTarget, textelSize, -1, 0).a; 
            const R = offsetSample(uTarget, textelSize, 1, 0).a; 
            const T = offsetSample(uTarget, textelSize, 0, 1).a; 
            const B = offsetSample(uTarget, textelSize, 0, -1).a; 

            const pixel = uTarget.sample( uv() ).toVar("pixel");
            const C = pixel.a ;

            const force = mul(0.5, vec2( abs( T ).sub( abs( B ) ), abs( R ).sub( abs( L ) ) )) .toVar("force");

            force.divAssign( length( force ).add( 0.0001 ) ); 
            force.mulAssign( this.curl.mul( C ) );
            force.mulAssign( vec2(0, -1.0) );
 

            const velocity = pixel.gb .add( force.mul( this.delta ) )

            return vec4( pixel.r, velocity, 0 )  ;
        })();
    }
}

class DivergenceShader extends MeshBasicNodeMaterial {
    constructor( uVelocity:Sampler2D, textelSize:UniformVec2 ) {
        super();

        this.fragmentNode = Fn(()=>{
            const vUv = uv();

            const L = offsetSample(uVelocity, textelSize, -1, 0).g.toVar("L"); 
            const R = offsetSample(uVelocity, textelSize, 1, 0).g.toVar("R"); 
            const T = offsetSample(uVelocity, textelSize, 0, 1).b.toVar("T"); 
            const B = offsetSample(uVelocity, textelSize, 0, -1).b.toVar("B"); 

            const pixel = uVelocity.sample(uv());
            const C = pixel.gb ; // velocity info... 

            If( vUv.x.sub(textelSize.x).lessThan(0), ()=>L.assign( C.x.negate() ) ); 
            If( vUv.x.add(textelSize.x).greaterThan(1), ()=>R.assign( C.x.negate() ) ); 
            If( vUv.y.add(textelSize.y).greaterThan(1), ()=>T.assign( C.y.negate() ) ); 
            If( vUv.y.sub(textelSize.y).lessThan(0), ()=>B.assign( C.y.negate() ) );
 
            const div = mul( 0.5, R.sub( L ).add( T.sub( B ) ) ); 

            return vec4( pixel.r, C, div );
        })();
    }
}

class ClearShader extends MeshBasicNodeMaterial {
    readonly decay = uniform(0.317);

    constructor( uTarget:Sampler2D ) {
        super();
        this.fragmentNode = Fn(()=>{

            const pixel = uTarget.sample( uv() ) ;  

            return vec4( pixel.r.mul(this.decay), pixel.gba ) ;

        })();
    }
}

class PressureShader extends MeshBasicNodeMaterial {
    constructor( uTarget:Sampler2D, textelSize:UniformVec2) {
        super();
        this.fragmentNode = Fn(()=>{

            const L = offsetSample(uTarget, textelSize, -1, 0).x; 
            const R = offsetSample(uTarget, textelSize, 1, 0).x;
            const T = offsetSample(uTarget, textelSize, 0, 1).x;
            const B = offsetSample(uTarget, textelSize, 0, -1).x;
            const pixel = uTarget.sample( uv() ).toVar(); 
           
            const divergence = pixel.a;

            const pressure = mul( L.add( R ).add( B ).add( T ).sub( divergence ), .25 );
  
            return vec4( pressure, pixel.gba );

        })();
    }
}

class GradientSubtractShader extends MeshBasicNodeMaterial {
    constructor( uTarget:Sampler2D, textelSize:UniformVec2) {
        super();
        this.fragmentNode = Fn(()=>{

            const L = offsetSample(uTarget, textelSize, -1, 0).x; 
            const R = offsetSample(uTarget, textelSize, 1, 0).x;
            const T = offsetSample(uTarget, textelSize, 0, 1).x;
            const B = offsetSample(uTarget, textelSize, 0, -1).x;

            const pixel = uTarget.sample( uv() ).toVar(); 
            const velocity = pixel.gb.toVar("velocity");

            velocity.subAssign( vec2( R.sub( L ), T.sub( B ) ) );

            return vec4( pixel.r, velocity, 0.0 );
        })();
    }
} 

class AdvectShader extends MeshBasicNodeMaterial {
    readonly sourceIsVelocity = uniform(0);
    readonly delta = uniform(0);
    readonly dissipation = uniform(0.1);
    readonly uSource:Sampler2D = texture(placeholderTexture);

    constructor( uVelocity:Sampler2D, textelSize:UniformVec2 ) {
        super();  
        this.fragmentNode = Fn(()=>{    

            const original = debug( uVelocity.sample(uv()) );
            const velocity = original.yz ;  
            const coord = uv().sub( this.delta.mul( velocity ).mul( textelSize ) );  
            const result = this.uSource.sample( coord ).toVar("pixel");  
            const decay = add( 1.0, this.dissipation.mul( this.delta ) );
            result.divAssign( decay );

            If( this.sourceIsVelocity , ()=>
            {    

                result.assign(vec4(
                    original.r,
                    result.gb,
                    original.w
                ));  

            } )  

            return result ;
 
        })();
    }
} 

export class TrackedObject { 
    target:Object3D|undefined
    onChange?:VoidFunction

    private _color?:Color;
    private _ratio:number = 0;

    /**
     * So let the system detect changes you must set this propert, not do color.set( another color )
     */
    get color(){ return this._color }
    get ratio() { return this._ratio }

    set color( c:Color|undefined )
    {
        this._color = c; 
        this.onChange?.();
    }

    set ratio( r:number ) {
        this._ratio = r;
        this.onChange?.();
    }

    constructor( readonly index :number ) {}
}


type Settings = {
  splatForce: number;
  splatThickness: number;
  vorticityInfluence: number;
  swirlIntensity: number;
  pressureDecay: number;
  velocityDissipation: number;
  densityDissipation: number;
  bumpDisplacmentScale: number;
  pressureIterations: number;
};

type FluidMaterialSettings = {

    /**
     * Will use the color as source of emision doing pow to create accents
     */
    emitColor?:boolean

    /**
     * if true, it will have a transparent background
     */
    transparent?:boolean
}


export class FluidMaterialGPU extends MeshPhysicalNodeMaterial {

    private _bumpDisplacmentScale = uniform(0.1);

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


    private raycaster:Raycaster;
    private tmp:Vector3 = new Vector3();
    private tmp2:Vector3 = new Vector3();

    private currentRT:RenderTarget;
    private nextRT:RenderTarget; 

    private uTarget:Sampler2D;
    private uData:Sampler2D;

    private dyeRT:RenderTarget;
    private nextDyeRT:RenderTarget;

    private objectDataArray:Float32Array; 
    private objectDataTexture:DataTexture;

    private tracking:TrackedObject[];
    private renderMaterial:(material?:MeshBasicNodeMaterial, target?:RenderTarget )=>void; 
  

    get splatForce() {
        return this.splat.splatForce.value;
    }
    set splatForce( v:number ) {
        this.splat.splatForce.value = v;
    }

    get splatThickness() { return this.splat.thickness.value }
    set splatThickness(v:number) {  this.splat.thickness.value=v }
    get vorticityInfluence() { return this.curl.vorticityInfluence.value }
    set vorticityInfluence(v:number) {  this.curl.vorticityInfluence.value=v }

    get swirlIntensity() { return this.vorticity.curl.value }
    set swirlIntensity(v:number) {  this.vorticity.curl.value=v } 

    get pressureDecay() { return this.clear.decay.value }
    set pressureDecay(v:number) {  this.clear.decay.value=v } 

    get bumpDisplacmentScale() {
        return this._bumpDisplacmentScale.value;
    }

    set bumpDisplacmentScale(v:number) {
        this._bumpDisplacmentScale.value = v;
    }

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

    velocityDissipation = 0.283;
    densityDissipation = 0.2;
    pressureIterations = 39;
    actAsSmoke = true;

    private scroll:ScrollShader;
    private splat:SplatShader;
    private curl:CurlShader;
    private vorticity:VorticityShader;
    private divergence:DivergenceShader;
    private clear:ClearShader;
    private pressure:PressureShader;
    private gradient:GradientSubtractShader;
    private advect:AdvectShader;

    private t = 0;

    constructor( renderer:WebGPURenderer, textureWidth:number, textureHeight:number, objectCount = 1, settings?:Partial<FluidMaterialSettings> ) {
        super({ 
            roughness:0.5,
            color: new Color(0xcccccc),
            transparent:true,
            side:DoubleSide, 
        });

        this.raycaster = new Raycaster();

        const rt = ()=>{
            const _rt = new RenderTarget(textureWidth, textureHeight, { type: FloatType, format: RGBAFormat });
            _rt.texture.minFilter = LinearFilter;
            _rt.texture.magFilter = LinearFilter;
            return _rt;
        }

        this.currentRT = rt();
        this.nextRT = rt();
        this.dyeRT = rt();
        this.nextDyeRT = rt();
 
 
        this.objectDataArray = new Float32Array(objectCount * 4 * 2);  

        // 
        this.objectDataTexture = new DataTexture(
            this.objectDataArray,
            objectCount, // width
            2,           // 1nd row  = current.x, current.y, prev.x, prev.y 
                         // 2st row = R, G, B, ratio 
            RGBAFormat,
            FloatType
        );  
        this.objectDataTexture.minFilter = NearestFilter;
        this.objectDataTexture.magFilter = NearestFilter;
        this.objectDataTexture.needsUpdate = true;

        this.tracking = new Array(objectCount).fill(0).map((_, index) => new TrackedObject(index));

        const texel = uniform(new Vector2( 1/textureWidth, 1/textureHeight ));


        this.uTarget = texture( placeholderTexture);
        this.uData = texture( placeholderTexture ); 

        this.scroll = new ScrollShader( this.uTarget );
        this.splat = new SplatShader( this.uTarget, this.uData, texel );
        this.splat.count.value = objectCount;
        this.curl = new CurlShader( this.uTarget, texel );
        this.vorticity = new VorticityShader( this.uTarget, texel );
        this.divergence = new DivergenceShader( this.uTarget, texel );
        this.clear = new ClearShader( this.uTarget );
        this.pressure = new PressureShader( this.uTarget, texel );
        this.gradient = new GradientSubtractShader( this.uTarget, texel);
        this.advect = new AdvectShader(this.uTarget, texel);
 
        // ------
        //#region quad scene
        // Fullscreen camera and quad scene
        const camera = new Camera();
        const sceneWithQuad = new Scene();

        const quadGeom = new PlaneGeometry(2, 2); 
        const quadMesh = new Mesh(quadGeom);
              sceneWithQuad.add(quadMesh);

              quadMesh.scale.y=-1 

        this.renderMaterial = ( material, target ) => {
            if(!material || !target)
            {
                renderer.setRenderTarget(null);
                return;
            }
            quadMesh.material = material;
            renderer.setRenderTarget(target);
            renderer.render(sceneWithQuad, camera); 
            renderer.setRenderTarget(null); // flush
            
        }
        //#endregion
        //--------------------------------------------------------------------------------------------------------------------------------------
 
        // LUTs  


        /////// displacement
        const maxChannel = this.uTarget.sample(uv());
        const maxValue = max( maxChannel.r.clamp(0,1), max( maxChannel.g.clamp(0,1), maxChannel.b.clamp(0,1)));

        this.positionNode = positionLocal .add( normalGeometry.mul( maxValue.mul( this._bumpDisplacmentScale ) ) );

        // alpha
        if( settings?.transparent )
        {
            this.opacityNode = maxValue;
        }
        

        ///// fix shading...  
        const height = Fn<[ShaderNodeObject<any>]>(([uvOffset]) =>
                dot(this.uTarget.sample( uv().add(uvOffset)).rgb, vec3(0.299, 0.587, 0.114)));

        this.normalNode = Fn(() => {
            const scale = this._bumpDisplacmentScale; 

            const hL = height(vec2(texel.x.negate(), 0.0));
            const hR = height(vec2(texel.x, 0.0));
            const hD = height(vec2(0.0, texel.y.negate()));
            const hU = height(vec2(0.0, texel.y));

            const dx = vec3( texel.x.mul(2), (hR.sub(hL)).mul(scale), 0.0);
            const dy = vec3(0.0, (hU.sub(hD)).mul(scale), texel.y.mul(2));

            const normal = normalize(cross(dy, dx));
            return normalize(modelNormalMatrix.mul(normal));
        })();

        if( settings?.emitColor )
        { 
            this.emissiveNode = maxChannel.pow(3); 
        }
       
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
        const i = freeSlot.index;

        freeSlot.target = object; 

        freeSlot.onChange = ()=>{

            console.log("COLOR!")

            const row2 = this.tracking.length * 4 + i * 4; //inthe 1st row we store positions  

            this.objectDataArray[ row2 ] = freeSlot.color?.r ?? 0;
            this.objectDataArray[ row2 + 1 ] = freeSlot.color?.g ?? 0;
            this.objectDataArray[ row2 + 2 ] = freeSlot.color?.b ?? 0;
            this.objectDataArray[ row2 + 3 ] = freeSlot.ratio; 

            if(!freeSlot.target )
            {
                this.objectDataArray[ i * 4 ] = 0;
                this.objectDataArray[ i * 4 + 1 ] = 0;
                this.objectDataArray[ i * 4 + 2 ] = 0;
                this.objectDataArray[ i * 4 + 3 ] = 0; 
            }

            this.objectDataTexture.needsUpdate = true;
            this.uData.value = this.objectDataTexture; 
        } 


        freeSlot.ratio = ratio; 
        freeSlot.color = new Color(color); 

        return freeSlot;
    }

    untrack( object:Object3D )
    {
        this.tracking.forEach( t=> {

            if( t.target==object )
            { 
                t.target = undefined;
                t.ratio = 0;
                t.color = undefined; 
            }

        });
    }

    /**
     * Renders the material into the next render texture and then swaps them so the new currentRT is the one that was generated by the material.
     */
    private blit( material:MeshBasicNodeMaterial )
    {  
        this.renderMaterial(material,this.nextRT ); 
        //swap
        [this.currentRT, this.nextRT] = [this.nextRT, this.currentRT]; 
 
        this.uTarget.value = this.currentRT.texture; 
 
    }

    private blitDye( material:MeshBasicNodeMaterial ) 
    { 
        this.renderMaterial(material,this.nextDyeRT ); 
        //swap
        [this.dyeRT, this.nextDyeRT] = [this.nextDyeRT, this.dyeRT];

        this.uTarget.value = this.currentRT.texture; 
        
    }

    private scrollTextures( uvStep:Vector2 )
    {
        this.scroll.uvScroll.value = uvStep;
        this.uTarget.value = this.currentRT.texture;
        this.blit( this.scroll );  

        this.scroll.uvScroll.value = uvStep; 
 
        this.blit( this.scroll );  
 
        this.uTarget.value = this.dyeRT.texture;
        this.blitDye( this.scroll );  
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
                        this.objectDataArray[i * 4 + 2] = uv.x;
                        this.objectDataArray[i * 4 + 3] = uv.y; 

                        // new positions...
                        this.objectDataArray[i * 4 + 0] = 0.5;
                        this.objectDataArray[i * 4 + 1] = 0.5; 

                        ///////
                        offset = new Vector2(  0.5-uv.x, 0.5-uv.y );

                        this.scrollTextures( offset );  
                    }
                    else 
                    {
                        // old positions...
                        this.objectDataArray[i * 4 + 2] = this.objectDataArray[i * 4 + 0];
                        this.objectDataArray[i * 4 + 3] = this.objectDataArray[i * 4 + 1]; 

                        // new positions...
                        this.objectDataArray[i * 4 + 0] = uv.x;
                        this.objectDataArray[i * 4 + 1] = uv.y; 
 
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
                    this.objectDataArray[i * 4 + 2] -= offset!.x;  
                    this.objectDataArray[i * 4 + 3] -= offset!.y;  
                }
            });
        }

        this.objectDataTexture.needsUpdate = true;
        this.uData.value = this.objectDataTexture; 
    }

    ccc = true;

    update( delta:number, mesh:Mesh )
    { 
        this.t += delta; 

        this.uTarget.value = this.currentRT.texture; 
        
        this.updatePositions( mesh );  
        

        // Splat velocity
        this.splat.splatVelocity.value = 1; 
        this.blit( this.splat );   

        // Splat colorcolors
        this.splat.splatVelocity.value = 0;  
        this.uTarget.value = this.dyeRT.texture; 
        this.blitDye( this.splat );  

        // // 2. vorticity : will be put into the alpha channel... 
        this.blit( this.curl );   

        // // 3. apply vorticity forces 
        this.vorticity.delta.value = delta ;
        this.blit( this.vorticity );  

        // 4. divergence 
        this.blit( this.divergence );

        // 5. clear pressure
        this.blit( this.clear );

        // 6. calculates and updates pressure 
        for (let i = 0; i < this.pressureIterations; i++) 
        { 
            this.blit( this.pressure );
        } 

        // 7. Gradient
        this.blit( this.gradient );

        //8. Advect velocity
        this.advect.delta.value = delta;
        this.advect.uSource.value = this.currentRT.texture;
        this.advect.sourceIsVelocity.value = 1;
        this.advect.dissipation.value = this.velocityDissipation;
        this.blit( this.advect );

        // 8. Advect dye / color
        this.advect.uSource.value = this.dyeRT.texture;
        this.advect.sourceIsVelocity.value = 0;
        this.advect.dissipation.value = this.densityDissipation;
        this.blitDye( this.advect );

        // restore renderer to original target...
        this.renderMaterial(undefined, undefined);  

        this.uTarget.value = this.dyeRT.texture;
        this.map = this.dyeRT.texture;   
    } 

    addDebugPanelFolder( gui:GUI, name="Fluid Material") {

        const panel = gui.addFolder(name);

        panel.add( this as Record<string, any>, "splatForce", -1000, 1000 );
        panel.add( this as Record<string, any>, "splatThickness", 0.001, 1 );
        panel.add( this as Record<string, any>, "vorticityInfluence", 0.1, 1 );
        panel.add( this as Record<string, any>, "swirlIntensity", 1, 100 );
        panel.add( this as Record<string, any>, "pressureDecay", 0, 1 );
        panel.add( this as Record<string, any>, "velocityDissipation", 0, 1 );
        panel.add( this as Record<string, any>, "densityDissipation", 0, 1 );
        panel.add( this as Record<string, any>, "bumpDisplacmentScale", -1, 1 );
        panel.add( this as Record<string, any>, "pressureIterations", 1, 100, 1 ); 

        panel.add( {
            copySettings: ()=>{

                const settings = {
                    splatForce: this.splatForce,
                    splatThickness: this.splatThickness,
                    vorticityInfluence: this.vorticityInfluence,
                    swirlIntensity: this.swirlIntensity,
                    pressureDecay: this.pressureDecay,
                    velocityDissipation: this.velocityDissipation,
                    densityDissipation: this.densityDissipation,
                    bumpDisplacmentScale: this.bumpDisplacmentScale,
                    pressureIterations: this.pressureIterations,
                }

                navigator.clipboard.writeText( JSON.stringify(settings, null, 2));
                
            }
        }, "copySettings" );
 
        return panel;
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
        this.pressureDecay = s.pressureDecay;
        this.velocityDissipation = s.velocityDissipation;
        this.densityDissipation = s.densityDissipation;
        this.bumpDisplacmentScale = s.bumpDisplacmentScale;
        this.pressureIterations = s.pressureIterations; 
    }
}