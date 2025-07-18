
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
import { NodeRepresentation, storage, abs, add, clamp, Continue, cross, distance, dot, Fn, If, instanceIndex, length, Loop, max, mix, modelNormalMatrix, mul, normalGeometry, normalize, positionLocal, smoothstep, texture, textureStore, uniform, uv, vec2, vec3, vec4, type ShaderNodeObject } from "three/tsl";
import { Color, ComputeNode, DoubleSide, Mesh, MeshPhysicalNodeMaterial, NearestFilter, Node, Object3D, Raycaster, StorageBufferAttribute, StorageTexture, Texture, TextureNode, UniformNode, Vector2, Vector3, WebGPURenderer, type ColorRepresentation } from "three/webgpu";

type Sampler2D = ShaderNodeObject<TextureNode>;
type NumberUniform = ShaderNodeObject<UniformNode<number>>;

const placeholderTexture = new Texture();
placeholderTexture.flipY = false;

const offsetSample = Fn<[Sampler2D, ShaderNodeObject<Node>, ShaderNodeObject<Node>, number, number]>(([sampler, uv, texel, x, y]) => {

    return sampler.sample(uv.add(texel.mul(vec2(x, y))));
});
//----------------------------------------------------
const encode = Fn<[ShaderNodeObject<Node>, ShaderNodeObject<Node>]>(([ _maxValue, value ])=>{
    return value //value.div(maxValue).add(1).div(2);
}); 
const decode = Fn<[ShaderNodeObject<Node>, ShaderNodeObject<Node>]>(([ _maxValue, value ])=>{
    return value//.mul(2).sub(1).mul(maxValue);
}); 
 

class ComputeShader {

    private textureToShader: Map<Texture, ShaderNodeObject<ComputeNode>>;

    constructor(private fn: (pixelPos: ShaderNodeObject<Node>, uvPos: ShaderNodeObject<Node>, texelSize: ShaderNodeObject<Node>) => NodeRepresentation) {
        this.textureToShader = new Map<Texture, ShaderNodeObject<ComputeNode>>()
    }

    private create(outTo: Texture, width: number, height: number) {

        return Fn(() => {

            const resolution = vec2(width, height);
            const posX = instanceIndex.mod(width);
            const posY = instanceIndex.div(width);
            const pixelPosition = vec2(posX, posY);
            const uvCoord = vec2(pixelPosition.add(vec2(0.5, 0.5))).div(resolution);
            const textelSize = vec2(1, 1).div(resolution); 

            return textureStore(outTo, pixelPosition, this.fn(pixelPosition, uvCoord, textelSize)).toWriteOnly();

        })().compute(width * height)
    }

    createBinds(width: number, height: number, ...targets: Texture[]) {
        for (const target of targets)
            this.textureToShader.set(target, this.create(target, width, height));
        return this;
    }

    renderBind(renderer: WebGPURenderer, bindTarget: Texture) {
        if (!this.textureToShader.has(bindTarget)) {
            throw new Error("You are trying to render to a texture that this shader doesn't have. Did you forgot to call createBindTo?")
        }

        renderer.compute(this.textureToShader.get(bindTarget)!);

        return bindTarget;
    }

}

class ScrollShader extends ComputeShader {
    readonly uvScroll = uniform(new Vector2())
    constructor(uTarget: Sampler2D) {
        super((_pixelPos, uvPos) => {
            return uTarget.sample(uvPos.add(this.uvScroll))
        });
    }
}

class SplatShader extends ComputeShader {
    readonly splatVelocity = uniform(1);

    /**
     * % of the max speed at which we can move
     */
    readonly splatForce = uniform(0.1);
    readonly thickness = uniform(1);

    constructor(uTarget: Sampler2D, positionAttr: StorageBufferAttribute, colorAttr: StorageBufferAttribute, count: number, maxVelocity:NumberUniform ) {
         
        super((_pixelPos, vUv, textelSize) => {

            const pixel = uTarget.sample(vUv).toVar('pixel');

            Loop(count, ({ i }) => {

                const pos = storage(positionAttr, "vec4", count).element(i);
                const curr = pos.xy;
                const prev = pos.zw;
                const data = storage(colorAttr, "vec4", count).element(i);
                const color = data.rgb;
                const ratio = data.a.mul(this.thickness);

                const diff = curr.sub(prev);

                If(length(diff).equal(0.0), () => {

                    Continue();

                });

                const toFrag = vUv.sub(prev);
                const t = clamp(dot(toFrag, diff).div(dot(diff, diff)), 0, 1)
                const proj = prev.add(t.mul(diff));


                const d = distance(vUv, proj);

                If(d.lessThan(textelSize.x.mul(ratio)), () => {

                    const influence = smoothstep(ratio, 0.0, d);

                    If(this.splatVelocity, () => {

                        //const vel = diff.normalizeAssign() //normalize(diff).mul(this.splatForce.negate());

                        // Diff is in UV units... the diference between the new and the old UV positions.
                        const vel = diff.normalize().mul( clamp( diff.length(), maxVelocity.negate(), maxVelocity ) );

                        // vel will be a number between -1 and 1... 
                        pixel.assign(vec4(pixel.r, encode(maxVelocity, vel), 0));

                    })
                        .Else(() => {

                            pixel.assign(mix(pixel, vec4(color, 1.0), influence));


                        });

                });


            });
            ;

            return pixel;
        });


    }
}

class CurlShader extends ComputeShader {
    readonly vorticityInfluence = uniform(1);

    constructor( uVelocity: Sampler2D, maxVelocity:NumberUniform ) {
        super((_, vUv, textelSize) => {
            const L = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, -1, 0).b );
            const R = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, 1, 0).b);
            const T = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, 0, 1).g);
            const B = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, 0, -1).g);

            const vorticity = R.sub(L).sub(T).add(B);
            const pixel = uVelocity.sample(vUv).toVar("pixel");
            const curl = this.vorticityInfluence.mul(vorticity);

            return vec4( pixel.xyz, encode( maxVelocity, curl ) );
        });
    }
}

class VorticityShader extends ComputeShader {
    readonly curl = uniform(30);
    readonly delta = uniform(0)

    constructor( uTarget: Sampler2D, maxVelocity:NumberUniform ) {
        super((_, vUv, textelSize) => {
            const L = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, -1, 0).a );
            const R = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 1, 0).a );
            const T = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 0, 1).a );
            const B = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 0, -1).a );

            const pixel = uTarget.sample(vUv).toVar("pixel");
            const C = decode( maxVelocity, pixel.a );

            const force = mul(0.5, vec2(abs(T).sub(abs(B)), abs(R).sub(abs(L)))).toVar("force");

            force.divAssign(length(force).add(0.0001));
            force.mulAssign(this.curl.mul(C));
            force.mulAssign(vec2(0, -1.0)); 

            const velocity = decode( maxVelocity, pixel.gb.add(force.mul(this.delta)));

            return vec4( pixel.r, encode( maxVelocity, velocity ), 0);
        });
    }
}

class DivergenceShader extends ComputeShader {
    constructor(uVelocity: Sampler2D, maxVelocity:NumberUniform ) {
        super((_, vUv, textelSize) => {

            const L = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, -1, 0).g).toVar("L");
            const R = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, 1, 0).g).toVar("R");
            const T = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, 0, 1).b).toVar("T");
            const B = decode( maxVelocity, offsetSample(uVelocity, vUv, textelSize, 0, -1).b).toVar("B");

            const pixel = uVelocity.sample(vUv);
            const C = decode( maxVelocity, pixel.gb ); // velocity info... 

            If(vUv.x.sub(textelSize.x).lessThan(0), () => L.assign(C.x.negate()));
            If(vUv.x.add(textelSize.x).greaterThan(1), () => R.assign(C.x.negate()));
            If(vUv.y.add(textelSize.y).greaterThan(1), () => T.assign(C.y.negate()));
            If(vUv.y.sub(textelSize.y).lessThan(0), () => B.assign(C.y.negate()));

            const div = mul(0.5, R.sub(L).add(T.sub(B)));

            return vec4(pixel.r, pixel.gb, decode(2,div));
        });
    }
}

class ClearShader extends ComputeShader {
    readonly decay = uniform(0.317);

    constructor(uTarget: Sampler2D) {
        super((_, vUv) => {

            const pixel = uTarget.sample(vUv);
            return vec4(pixel.r.mul(this.decay), pixel.gba);

        });
    }
}

class PressureShader extends ComputeShader {
    constructor(uTarget: Sampler2D, maxVelocity:NumberUniform ) {
        super((_, vUv, textelSize) => {

            const L = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, -1, 0).x);
            const R = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 1, 0).x);
            const T = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 0, 1).x);
            const B = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 0, -1).x);
            const pixel = uTarget.sample(vUv).toVar();

            const divergence = decode( maxVelocity, pixel.a );

            const pressure = mul(L.add(R).add(B).add(T).sub(divergence), .25);

            return vec4( encode( maxVelocity, pressure ), pixel.gba);

        });
    }
}

class GradientSubtractShader extends ComputeShader {
    constructor( uTarget: Sampler2D, maxVelocity:NumberUniform ) {
        super((_, vUv, textelSize) => {

            const L = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, -1, 0).x);
            const R = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 1, 0).x);
            const T = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 0, 1).x);
            const B = decode( maxVelocity, offsetSample(uTarget, vUv, textelSize, 0, -1).x);

            const pixel = uTarget.sample(vUv).toVar();
            const velocity = decode( maxVelocity, pixel.gb ).toVar("velocity");

            velocity.subAssign(vec2(R.sub(L), T.sub(B)));

            return vec4(pixel.r, encode( maxVelocity, velocity), 0.0);//
        });
    }
}

class AdvectShader extends ComputeShader {
    readonly sourceIsVelocity = uniform(0);
    readonly delta = uniform(0);
    readonly dissipation = uniform(0.1);
    readonly uSource: Sampler2D = texture(placeholderTexture);

    constructor( uVelocity: Sampler2D, maxVelocity:NumberUniform ) {
        super((_, vUv, _textelSize) => {

            const original = uVelocity.sample(vUv);
            const velocity = decode( maxVelocity, original.yz );
            const coord = vUv.sub(this.delta.mul(velocity))//.mul(textelSize));
            const result = this.uSource.sample(coord).toVar("pixel");
            const decay = add(1.0, this.dissipation.mul(this.delta));
            result.divAssign(decay);

            If(this.sourceIsVelocity, () => {
                result.assign(vec4(
                    original.r,
                    result.gb,
                    original.w
                ));

            })

            return result;
        });
    }
}

export class TrackedObject {
    target: Object3D | undefined
    onChange?: VoidFunction

    private _color?: Color;
    private _ratio: number = 0;

    /**
     * So let the system detect changes you must set this propert, not do color.set( another color )
     */
    get color() { return this._color }
    get ratio() { return this._ratio }

    set color(c: Color | undefined) {
        this._color = c;
        this.onChange?.();
    }

    set ratio(r: number) {
        this._ratio = r;
        this.onChange?.();
    }

    constructor(readonly index: number) { }
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
    emitColor?: boolean

    /**
     * if true, it will have a transparent background
     */
    transparent?: boolean

    /**
     * max absolute speed in UV units
     */
    maxSpeed:number
}


export class FluidMaterialGPU extends MeshPhysicalNodeMaterial {

    private _bumpDisplacmentScale = uniform(0.1);

    /**
     * The mesh will forllow this target and the position prev/current will scroll the texture...
     */
    private _follow?: Object3D;
    public get follow() { return this._follow }
    public set follow(obj: Object3D | undefined) {
        this._follow = obj;
        obj?.getWorldPosition(this.lastFollowPos);
    }

    private lastFollowPos: Vector3 = new Vector3();
    private followOffset: Vector3 = new Vector3();


    private raycaster: Raycaster;
    private tmp: Vector3 = new Vector3();
    private tmp2: Vector3 = new Vector3();

    private currentRT: Texture;
    private nextRT: Texture;

    private uTarget: Sampler2D;

    private dyeRT: Texture;
    private nextDyeRT: Texture; 

    private objectDataArray: Float32Array;
    private objectPositionsArray: Float32Array;
    private objectDataAttribute: StorageBufferAttribute;
    private objectPositionAttribute: StorageBufferAttribute;

    private tracking: TrackedObject[];
    private renderMaterial: (material: ComputeShader, target: Texture) => void;


    get splatForce() {
        return this.splat.splatForce.value;
    }
    set splatForce(v: number) {
        this.splat.splatForce.value = v;
    }

    get splatThickness() { return this.splat.thickness.value }
    set splatThickness(v: number) { this.splat.thickness.value = v }
    get vorticityInfluence() { return this.curl.vorticityInfluence.value }
    set vorticityInfluence(v: number) { this.curl.vorticityInfluence.value = v }

    get swirlIntensity() { return this.vorticity.curl.value }
    set swirlIntensity(v: number) { this.vorticity.curl.value = v }

    get pressureDecay() { return this.clear.decay.value }
    set pressureDecay(v: number) { this.clear.decay.value = v }

    get bumpDisplacmentScale() {
        return this._bumpDisplacmentScale.value;
    }

    set bumpDisplacmentScale(v: number) {
        this._bumpDisplacmentScale.value = v;
    }

    /**
     * Color
     */
    get colorTexture() {
        return this.dyeRT;
    }

    /**
     * Idk why you would need this but maybe you'll find this useful since it contains the velocities of the surface...
     */
    get dataTexture() {
        return this.currentRT;
    }

    velocityDissipation = 0.283;
    densityDissipation = 0.2;
    pressureIterations = 39;
    actAsSmoke = true;

    private scroll: ScrollShader;
    private splat: SplatShader;
    private curl: CurlShader;
    private vorticity: VorticityShader;
    private divergence: DivergenceShader;
    private clear: ClearShader;
    private pressure: PressureShader;
    private gradient: GradientSubtractShader;
    private advect: AdvectShader;

    /**
     * Max speed at which the liquid can move inUV units.
     */
    private uMaxSpeed:ShaderNodeObject<UniformNode<number>>;
    private t = 0;

    constructor(renderer: WebGPURenderer, textureWidth: number, textureHeight: number, objectCount = 1, settings?: Partial<FluidMaterialSettings>) {
        super({
            roughness: 0.5,
            color: new Color(0xcccccc),
            transparent: false,
            side: DoubleSide,
        });

        this.uMaxSpeed = uniform(settings?.maxSpeed ?? (1/10));

        this.raycaster = new Raycaster();

        const rt = () => {
            const txt = new StorageTexture(textureWidth, textureHeight);
            txt.minFilter = NearestFilter;
            txt.magFilter = NearestFilter;
            return txt;
        }; 

        this.currentRT = rt();
        this.nextRT = rt();
        this.dyeRT = rt();
        this.nextDyeRT = rt(); 
 
   

        this.objectPositionsArray = new Float32Array(objectCount * 4);
        this.objectDataArray = new Float32Array(objectCount * 9);

        this.objectPositionAttribute = new StorageBufferAttribute(this.objectPositionsArray, 4);
        this.objectDataAttribute = new StorageBufferAttribute(this.objectDataArray, 4); 

        this.tracking = new Array(objectCount).fill(0).map((_, index) => new TrackedObject(index));

        const texel = uniform(new Vector2(1 / textureWidth, 1 / textureHeight));


        this.uTarget = texture(placeholderTexture);

        const w = textureWidth;
        const h = textureHeight;
        const velA = this.currentRT;
        const velB = this.nextRT;
        const dyeA = this.dyeRT;
        const dyeB = this.nextDyeRT;
 

        this.scroll = new ScrollShader(this.uTarget).createBinds(w, h, velA, velB, dyeA, dyeB);

        this.splat = new SplatShader(   this.uTarget, 
                                        this.objectPositionAttribute, 
                                        this.objectDataAttribute, 
                                        objectCount, 
                                        this.uMaxSpeed ).createBinds(w, h, velA, velB, dyeA, dyeB);

        this.curl = new CurlShader( this.uTarget, this.uMaxSpeed ).createBinds(w, h, velA, velB);
        this.vorticity = new VorticityShader(this.uTarget, this.uMaxSpeed ).createBinds(w, h, velA, velB);
        this.divergence = new DivergenceShader(this.uTarget, this.uMaxSpeed ).createBinds(w, h, velA, velB);
        this.clear = new ClearShader(this.uTarget).createBinds(w, h, velA, velB);
        this.pressure = new PressureShader(this.uTarget, this.uMaxSpeed).createBinds(w, h, velA, velB);
        this.gradient = new GradientSubtractShader(this.uTarget, this.uMaxSpeed).createBinds(w, h, velA, velB);
        this.advect = new AdvectShader(this.uTarget, this.uMaxSpeed).createBinds(w, h, velA, velB, dyeA, dyeB);


        this.renderMaterial = (material, target) => {
            material.renderBind(renderer, target);
        }
        //#endregion
        //--------------------------------------------------------------------------------------------------------------------------------------


        /////// displacement
        const maxChannel = this.uTarget.sample(uv());
        const maxValue = max(maxChannel.r.clamp(0, 1), max(maxChannel.g.clamp(0, 1), maxChannel.b.clamp(0, 1)));

        this.positionNode = positionLocal.add(normalGeometry.mul(maxValue.mul(this._bumpDisplacmentScale)));

        // alpha
        if (settings?.transparent) {
            this.opacityNode = maxValue;
        }

        this.colorNode = this.uTarget;


        ///// fix shading...  
        const height = Fn<[ShaderNodeObject<Node>]>(([uvOffset]) =>
            dot(this.uTarget.sample(uv().add(uvOffset)).rgb, vec3(0.299, 0.587, 0.114)));

        this.normalNode = Fn(() => {
            const scale = this._bumpDisplacmentScale;

            const hL = height(vec2(texel.x.negate(), 0.0));
            const hR = height(vec2(texel.x, 0.0));
            const hD = height(vec2(0.0, texel.y.negate()));
            const hU = height(vec2(0.0, texel.y));

            const dx = vec3(texel.x.mul(2), (hR.sub(hL)).mul(scale), 0.0);
            const dy = vec3(0.0, (hU.sub(hD)).mul(scale), texel.y.mul(2));

            const normal = normalize(cross(dy, dx));
            return normalize(modelNormalMatrix.mul(normal));
        })();

        if (settings?.emitColor) {
            this.emissiveNode = maxChannel.pow(3);
        }

    }

    /**
     * This is where you add "objects" to be tracked to affect the liquid.
     * They current and past positions will be used to calculate their directional speed.
     * @param object 
     */
    track(object: Object3D, ratio = 1, color: ColorRepresentation = Color.NAMES.black) {
        const freeSlot = this.tracking.find(slot => !slot.target);
        if (!freeSlot) {
            throw new Error(`No room for tracking, all slots taken!`);
        }

        // hacer un raycast desde la posision del objeto hacia abajo
        // averiguar el UV donde nos pega
        // setear ese valor como nuestra posision
        const i = freeSlot.index;

        freeSlot.target = object;

        freeSlot.onChange = () => {

            console.log("COLOR!")

            this.objectDataArray[i * 4] = freeSlot.color?.r ?? 0;
            this.objectDataArray[i * 4 + 1] = freeSlot.color?.g ?? 0;
            this.objectDataArray[i * 4 + 2] = freeSlot.color?.b ?? 0;
            this.objectDataArray[i * 4 + 3] = freeSlot.ratio;

            if (!freeSlot.target) {
                this.objectPositionsArray[i * 4] = 0;
                this.objectPositionsArray[i * 4 + 1] = 0;
                this.objectPositionsArray[i * 4 + 2] = 0;
                this.objectPositionsArray[i * 4 + 3] = 0;

                this.objectPositionAttribute.needsUpdate = true;
            }

            this.objectDataAttribute.needsUpdate = true;
        }


        freeSlot.ratio = ratio;
        freeSlot.color = new Color(color);

        return freeSlot;
    }

    untrack(object: Object3D) {
        this.tracking.forEach((t, i) => {

            if (t.target == object) {
                t.target = undefined;
                t.ratio = 0;
                t.color = undefined;

                this.objectPositionsArray[i * 4] = 0;
                this.objectPositionsArray[i * 4 + 1] = 0;
                this.objectPositionsArray[i * 4 + 2] = 0;
                this.objectPositionsArray[i * 4 + 3] = 0;
                this.objectPositionAttribute.needsUpdate = true;
            }

        });
    }

    /**
     * Renders the material into the next render texture and then swaps them so the new currentRT is the one that was generated by the material.
     */
    private blit(material: ComputeShader) {
        this.renderMaterial(material, this.nextRT);
        //swap
        [this.currentRT, this.nextRT] = [this.nextRT, this.currentRT];

        this.uTarget.value = this.currentRT;

    }

    private blitDye(material: ComputeShader) {
        this.renderMaterial(material, this.nextDyeRT);
        //swap
        [this.dyeRT, this.nextDyeRT] = [this.nextDyeRT, this.dyeRT];

        this.uTarget.value = this.currentRT;

    }

    private scrollTextures(uvStep: Vector2) {
        this.scroll.uvScroll.value = uvStep;
        this.uTarget.value = this.currentRT;
        this.blit(this.scroll);

        this.uTarget.value = this.dyeRT;
        this.blitDye(this.scroll);
    }

    /**
     * Update the positions... we use the UVs as the positions. We cast a ray from the objects to the surface simulating the liquid
     * and calculate the UV that is below the object.
     */
    private updatePositions(mesh: Mesh) {


        if (this.follow) //asumes the Y is the up vector and we are following only in the XZ plane
        {
            this.follow.getWorldPosition(this.tmp);

            // 
            this.followOffset.copy(this.tmp).sub(this.lastFollowPos);
            this.followOffset.y = 0; // ignore the Y axis...

            this.lastFollowPos.copy(this.tmp);

            if (mesh.parent) {
                mesh.parent.worldToLocal(this.tmp);
            }

            mesh.position.x = this.tmp.x;
            mesh.position.z = this.tmp.z;
        }

        let offset: Vector2 | undefined; //UV Offset

        // update objects positions.... 
        for (const obj of this.tracking) {

            if (!obj.target) continue;

            this.tmp.set(0, 1, 0); //<--- assuming the origin ob the objects is at the bottom of the models.
            const wpos = obj.target.localToWorld(this.tmp);
            const followingObj = obj.target == this.follow;

            // if this is the object we are following...
            if (followingObj) {
                wpos.sub(this.followOffset);// because we ant to sample the UV at the last position since following means the obj will be fixed at 0.5 0.5 UV at dead center
            }

            this.tmp2.copy(wpos);

            const rpos = mesh.worldToLocal(this.tmp2);
            rpos.y = 0; // this will put the position at the surface of the mesh

            mesh.localToWorld(rpos); // this way we point at the surface of the mesh.


            this.raycaster.set(wpos, rpos.sub(wpos).normalize());

            const hit = this.raycaster.intersectObject(mesh, true);

            if (hit.length) {
                const uv = hit[0].uv; // <--- UV under the object

                if (uv) {
                    const i = obj.index;

                    if (followingObj) {
                        // old positions...
                        this.objectPositionsArray[i * 4 + 2] = uv.x;
                        this.objectPositionsArray[i * 4 + 3] = uv.y;

                        // new positions...
                        this.objectPositionsArray[i * 4 + 0] = 0.5;
                        this.objectPositionsArray[i * 4 + 1] = 0.5;

                        ///////
                        offset = new Vector2(0.5 - uv.x, 0.5 - uv.y);

                        this.scrollTextures(offset);
                    }
                    else {
                        // old positions...
                        this.objectPositionsArray[i * 4 + 2] = this.objectPositionsArray[i * 4];
                        this.objectPositionsArray[i * 4 + 3] = this.objectPositionsArray[i * 4 + 1];

                        // new positions...
                        this.objectPositionsArray[i * 4] = uv.x;
                        this.objectPositionsArray[i * 4 + 1] = uv.y;
                    }

                }

            }

        };

        if (this.follow && offset != null) {
            // the UV was scrolled, so we must dubstract this offset from all positions exept the follow target
            this.tracking.forEach(obj => {
                if (obj.target && obj.target != this.follow) {
                    const i = obj.index;
                    this.objectPositionsArray[i * 4 + 2] -= offset!.x;
                    this.objectPositionsArray[i * 4 + 3] -= offset!.y;
                }
            });
        }

        this.objectPositionAttribute.needsUpdate = true;

    }

    ccc = true;

    update(delta: number, mesh: Mesh) {
        this.t += delta;

        this.uTarget.value = this.currentRT;

        this.updatePositions(mesh); 

        // Splat velocity
        this.splat.splatVelocity.value = 1;
        this.blit(this.splat);

        // Splat colorcolors
        this.splat.splatVelocity.value = 0;
        this.uTarget.value = this.dyeRT;
        this.blitDye(this.splat);

        // // 2. vorticity : will be put into the alpha channel... 
        this.blit(this.curl);

        // // 3. apply vorticity forces 
        this.vorticity.delta.value = delta;
        this.blit(this.vorticity);

        // 4. divergence 
        this.blit(this.divergence);

        // 5. clear pressure
        this.blit(this.clear);

        // 6. calculates and updates pressure 
        for (let i = 0; i < this.pressureIterations; i++) {
            this.blit(this.pressure);
        }

        // 7. Gradient
        this.blit(this.gradient);

        //8. Advect velocity
        this.advect.delta.value = delta;
        this.advect.uSource.value = this.currentRT;
        this.advect.sourceIsVelocity.value = 1;
        this.advect.dissipation.value = this.velocityDissipation;
        this.blit(this.advect);

        // 8. Advect dye / color
        this.advect.uSource.value = this.dyeRT;
        this.advect.sourceIsVelocity.value = 0;
        this.advect.dissipation.value = this.densityDissipation;
        this.blitDye(this.advect);

        // restore renderer to original target... 

        this.uTarget.value = this.dyeRT;
        // this.map = this.dyeRT;   
    }

    addDebugPanelFolder(gui: GUI, name = "Fluid Material") {

        const panel = gui.addFolder(name);

        panel.add(this as Record<string, any>, "splatForce", -1000, 1000);
        panel.add(this as Record<string, any>, "splatThickness", 0.001, 1);
        panel.add(this as Record<string, any>, "vorticityInfluence", 0.1, 1);
        panel.add(this as Record<string, any>, "swirlIntensity", 1, 100);
        panel.add(this as Record<string, any>, "pressureDecay", 0, 1);
        panel.add(this as Record<string, any>, "velocityDissipation", 0, 1);
        panel.add(this as Record<string, any>, "densityDissipation", 0, 1);
        panel.add(this as Record<string, any>, "bumpDisplacmentScale", -1, 1);
        panel.add(this as Record<string, any>, "pressureIterations", 1, 100, 1);

        panel.add({
            copySettings: () => {

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

                navigator.clipboard.writeText(JSON.stringify(settings, null, 2));

            }
        }, "copySettings");

        return panel;
    }

    /**
     * Restore values previously copied from the debug panel...
     * @see `addDebugPanelFolder`
     */
    setSettings(s: Settings) {
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