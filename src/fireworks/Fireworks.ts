import {
	AdditiveBlending,
	Color,
	Mesh,
	MeshBasicNodeMaterial,
	Vector2,
	Vector3,
} from 'three/webgpu'
import type { ColorRepresentation, Object3D } from 'three/webgpu'
import {
	Fn,
	and,
	attribute,
	cameraPosition,
	clamp,
	cross,
	float,
	modelWorldMatrixInverse,
	normalize,
	oneMinus,
	positionLocal,
	pow,
	select,
	smoothstep,
	uniform,
	uv,
	vec2,
	vec3,
	vec4,
} from 'three/tsl'
import { createFireworksGeometry } from './createFireworksGeometry.ts'
import { easeCubicOut } from './easeCubicOut.ts'
import { genericNoise2D } from './genericNoise2D.ts'

/**
 * Fireworks construction options.
 *
 * `radius` / `detail` / `segments` / `gravity` bake into geometry and cannot be hot-swapped.
 * Timeline and appearance fields bind to TSL uniforms and can be changed at runtime.
 */
export type FireworksOptions = {
	/** Burst trail target length radius. */
	radius?: number
	/** Icosahedron subdivision level. */
	detail?: number
	/** Segments per trail. */
	segments?: number
	/** Gravity parabola coefficient. */
	gravity?: number
	/** Ribbon half-width. */
	width?: number
	/** Animation start time in seconds; kept fixed on loop reset. */
	startTime?: number
	/** Launch phase duration in seconds. */
	launchDuration?: number
	/** Delay between launch and burst (may be negative to overlap). */
	delayDuration?: number
	/** Burst phase duration in seconds. */
	burstDuration?: number
	/** Burst height in local Y. */
	burstHeight?: number
	/** Overall burst scale. */
	burstScale?: number
	/** Burst origin offset. */
	burstPositionOffset?: Vector3
	/** Reset time to 0 when one cycle finishes. */
	loop?: boolean
	/** Base ribbon color. */
	color?: ColorRepresentation
	/**
	 * Head glow intensity (uBloomIntensity).
	 */
	bloomIntensity?: number
	/**
	 * Head glow length exponent (uBloomFalloff); larger tightens the tip.
	 */
	bloomFalloff?: number
	/** Noise dissolve time exponent. */
	noiseFalloff?: number
	/** Noise UV scale (across, along). */
	noiseScale?: Vector2
}

/**
 * WebGPU / TSL fireworks ribbon.
 *
 * Pipeline (matches fantasy3d Fireworks GLSL):
 * - Geometry: icosahedron directions -> gravity-bent dual-vertex ribbons + one launch placeholder.
 * - Vertex: launch/burst normalized time with cubic-out easing; burst scaled to origin, launch stretched by origin;
 *   billboard expand via cross(view, tangent). Inactive phases move verts far away.
 * - Fragment: discard past growth front; value-noise dissolve; additive head bloom; no depth write.
 *
 * Loop: keep startTime; when elapsed exceeds launch+delay+burst, set time to 0.
 */
export class Fireworks {

	/** Scene object (the ribbon mesh). */
	readonly object: Object3D

	private _loop: boolean
	private readonly _geometry
	private readonly _material: MeshBasicNodeMaterial

	private readonly _uWidth
	private readonly _uTime
	private readonly _uStartTime
	private readonly _uLaunchDuration
	private readonly _uDelayDuration
	private readonly _uBurstDuration
	private readonly _uBurstHeight
	private readonly _uBurstScale
	private readonly _uBurstPositionOffset
	private readonly _uBloomIntensity
	private readonly _uBloomFalloff
	private readonly _uNoiseFalloff
	private readonly _uNoiseScale
	private readonly _uColor

	constructor( options: FireworksOptions = {} ) {


	const {
		radius = 1.0,
		detail = 0,
		segments = 5,
		gravity = 1.0,
		width = 0.1,
		startTime = 0.0,
		launchDuration = 1.5,
		delayDuration = -0.4,
		burstDuration = 2.0,
		burstHeight = 6.5,
		burstScale = 3.5,
		burstPositionOffset = new Vector3( 0, 0, 0 ),
		bloomIntensity = 9.0,
		bloomFalloff = 18.0,
		noiseFalloff = 3.0,
		noiseScale = new Vector2( 10.0, 200.0 ),
		color = '#ffd4a0',
		loop = false,
	} = options

	this._loop = loop

	this._uWidth = uniform( width )
	this._uTime = uniform( 0.0 )
	this._uStartTime = uniform( startTime )
	this._uLaunchDuration = uniform( launchDuration )
	this._uDelayDuration = uniform( delayDuration )
	this._uBurstDuration = uniform( burstDuration )
	this._uBurstHeight = uniform( burstHeight )
	this._uBurstScale = uniform( burstScale )
	this._uBurstPositionOffset = uniform( burstPositionOffset.clone() )
	this._uBloomIntensity = uniform( bloomIntensity )
	this._uBloomFalloff = uniform( bloomFalloff )
	this._uNoiseFalloff = uniform( noiseFalloff )
	this._uNoiseScale = uniform( noiseScale.clone() )
	this._uColor = uniform( new Color( color ) )

	const uWidth = this._uWidth
	const uTime = this._uTime
	const uStartTime = this._uStartTime
	const uLaunchDuration = this._uLaunchDuration
	const uDelayDuration = this._uDelayDuration
	const uBurstDuration = this._uBurstDuration
	const uBurstHeight = this._uBurstHeight
	const uBurstScale = this._uBurstScale
	const uBurstPositionOffset = this._uBurstPositionOffset
	const uBloomIntensity = this._uBloomIntensity
	const uBloomFalloff = this._uBloomFalloff
	const uNoiseFalloff = this._uNoiseFalloff
	const uNoiseScale = this._uNoiseScale
	const uColor = this._uColor

	const geometry = this._geometry = createFireworksGeometry( { radius, detail, segments, gravity } )
	const material = this._material = new MeshBasicNodeMaterial()
	material.color.set( 0xffffff ) // tint only via uColor in colorNode (avoid color * colorNode double multiply)
		material.name = 'Fireworks'
	material.transparent = true
	material.depthTest = true
	material.depthWrite = false
	material.blending = AdditiveBlending
	material.fog = false
	material.lights = false

	const isBurstTrailAttr = attribute( 'isBurstTrail', 'float' )
	const tangentAttr = attribute( 'tangent', 'vec3' )

	/**
	 * 将几何 UV 映射为飘带局部坐标：x ∈ [-1,1] 表示左右半宽，y ∈ [0,1] 表示沿长度进度。
	 * 写成 varying，片元阶段与顶点阶段共用同一插值结果。
	 */
	const trailUv = vec2( uv().x.mul( 2.0 ).sub( 1.0 ), uv().y ).toVarying( 'vTrailUv' )

	/**
	 * 升空或爆炸阶段的归一化时间（未缓动）。由顶点写入 varying，片元用于生长裁剪与烧蚀。
	 */
	const phaseRaw = Fn( () => {

		const elapsed = uTime.sub( uStartTime )
		const burstPhase = elapsed.sub( uLaunchDuration ).sub( uDelayDuration ).div( uBurstDuration )
		const launchPhase = elapsed.div( uLaunchDuration )
		return select( isBurstTrailAttr.greaterThan( 0.5 ), burstPhase, launchPhase )

	} )().toVarying( 'vPhaseRaw' )

	const phaseEased = easeCubicOut( phaseRaw ).toVarying( 'vPhaseEased' )
	const isBurstVarying = isBurstTrailAttr.toVarying( 'vIsBurstTrail' )

	material.positionNode = Fn( () => {

		const active = and( phaseRaw.greaterThan( 0.0 ), phaseRaw.lessThan( 1.0 ) )

		const burstOrigin = vec3(
			uBurstPositionOffset.x,
			uBurstPositionOffset.y.add( uBurstHeight ),
			uBurstPositionOffset.z,
		)

		const burstPos = positionLocal.mul( uBurstScale ).add( burstOrigin )
		const launchPos = positionLocal.mul( burstOrigin )
		const center = select( isBurstTrailAttr.greaterThan( 0.5 ), burstPos, launchPos ).toVar()

		const localCamera = modelWorldMatrixInverse.mul( vec4( cameraPosition, 1.0 ) ).xyz
		const look = normalize( localCamera.sub( center ) )
		const localTangent = select(
			isBurstTrailAttr.greaterThan( 0.5 ),
			tangentAttr,
			normalize( burstOrigin ),
		)
		const side = normalize( cross( look, localTangent ) )
		const ribbon = center.add( side.mul( uWidth ).mul( trailUv.x ).mul( 0.5 ) )

		// 非活跃阶段移到远处，保证裁剪坐标有定义且不会在原点留下亮点
		return select( active, ribbon, vec3( 0.0, 1.0e5, 0.0 ) )

	} )()

	material.colorNode = Fn( () => {

		// 尚未生长到的区段直接丢弃
		trailUv.y.greaterThan( phaseEased ).discard()

		const burstTrail = isBurstVarying.greaterThan( 0.5 )
		const uvScaled = trailUv.mul( uNoiseScale )
		const n = oneMinus( genericNoise2D( uvScaled ) )

		const delayStart = select( burstTrail, float( 0.15 ), float( 0.25 ) )
		const falloffMul = select( burstTrail, float( 1.0 ), float( 1.3 ) )
		const delayFactor = pow( phaseEased, uNoiseFalloff.mul( falloffMul ) ).sub( delayStart ).div( oneMinus( delayStart ) )
		const noiseFade = smoothstep( float( 0.0 ), phaseEased, trailUv.y.sub( delayFactor ) )

		n.greaterThan( noiseFade ).discard()

		/**
		 * Head bloom (fantasy3d fireworks.fs.glsl):
		 * colorFactor = clamp(1 - (phase - uv.y), 0, 1) peaks at the growth front;
		 * bloomFade kills the tip near phase end; effect = intensity * pow(colorFactor, falloff) * fade;
		 * final color = base * (1 + effect), same as base + base * effect.
		 */
		const colorFactor = clamp( oneMinus( phaseEased.sub( trailUv.y ) ), 0.0, 1.0 )
		const bloomFade = oneMinus( smoothstep( float( 0.85 ), float( 1.0 ), phaseEased ) )
		const bloomEffect = uBloomIntensity.mul( pow( colorFactor, uBloomFalloff ) ).mul( bloomFade )

		return uColor.mul( float( 1.0 ).add( bloomEffect ) )

	} )()

	const mesh = new Mesh( geometry, material )
	mesh.name = 'Fireworks'
	mesh.frustumCulled = false

	this.object = mesh


	}

	/** Advance animation time in seconds. */
	update( deltaSeconds: number ): void {

		const duration = this._uLaunchDuration.value + this._uDelayDuration.value + this._uBurstDuration.value

		if ( this._loop && ( this._uTime.value - this._uStartTime.value ) > duration ) {

			this._uTime.value = 0.0

		} else {

			this._uTime.value += deltaSeconds

		}

	}

	/** Reset current time to 0 and replay from startTime. */
	restart(): void {

		this._uTime.value = 0.0

	}

	/** Dispose geometry and material. */
	dispose(): void {

		this._geometry.dispose()
		this._material.dispose()

	}

	get loop(): boolean { return this._loop }
	set loop( value: boolean ) { this._loop = value }

	get width(): number { return this._uWidth.value }
	set width( value: number ) { this._uWidth.value = value }

	get startTime(): number { return this._uStartTime.value }
	set startTime( value: number ) { this._uStartTime.value = value }

	get launchDuration(): number { return this._uLaunchDuration.value }
	set launchDuration( value: number ) { this._uLaunchDuration.value = value }

	get delayDuration(): number { return this._uDelayDuration.value }
	set delayDuration( value: number ) { this._uDelayDuration.value = value }

	get burstDuration(): number { return this._uBurstDuration.value }
	set burstDuration( value: number ) { this._uBurstDuration.value = value }

	get burstHeight(): number { return this._uBurstHeight.value }
	set burstHeight( value: number ) { this._uBurstHeight.value = value }

	get burstScale(): number { return this._uBurstScale.value }
	set burstScale( value: number ) { this._uBurstScale.value = value }

	get bloomIntensity(): number { return this._uBloomIntensity.value }
	set bloomIntensity( value: number ) { this._uBloomIntensity.value = value }

	get bloomFalloff(): number { return this._uBloomFalloff.value }
	set bloomFalloff( value: number ) { this._uBloomFalloff.value = value }

	get noiseFalloff(): number { return this._uNoiseFalloff.value }
	set noiseFalloff( value: number ) { this._uNoiseFalloff.value = value }

	get color(): Color { return this._uColor.value }
	set color( value: ColorRepresentation ) { this._uColor.value.set( value ) } // material.color stays white

	get burstPositionOffset(): Vector3 { return this._uBurstPositionOffset.value }
	get noiseScale(): Vector2 { return this._uNoiseScale.value }

}

/**
 * Factory wrapper equivalent to `new Fireworks( options )`.
 */
export function createFireworks( options: FireworksOptions = {} ): Fireworks {

	return new Fireworks( options )

}
