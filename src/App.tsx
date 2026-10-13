import { useEffect, useRef } from 'react'
import {
	ACESFilmicToneMapping,
	Color,
	PerspectiveCamera,
	RenderPipeline,
	SRGBColorSpace,
	Scene,
	Vector3,
	WebGPURenderer,
} from 'three/webgpu'
import { float, pass, smoothstep, uniform, uv, vec2, vec4 } from 'three/tsl'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { Inspector } from 'three/addons/inspector/Inspector.js'
import { bloom } from 'three/addons/tsl/display/BloomNode.js'
import { chromaticAberration } from 'three/addons/tsl/display/ChromaticAberrationNode.js'
import { film } from 'three/addons/tsl/display/FilmNode.js'
import { fxaa } from 'three/addons/tsl/display/FXAANode.js'
import { Fireworks, type FireworksOptions } from './fireworks/index.ts'

/** One shell: offset is ground launch XZ (object.position), not burstPositionOffset. */
type ShowShell = FireworksOptions & {
	offset: [ number, number, number ]
}

/**
 * Fixed show layout: wide XZ rings; offset → object.position (launch origins on ground);
 * staggered startTime / durations, varied color / width / scale / tip bloom.
 */
const SHOW_SHELLS: ShowShell[] = [
	{ offset: [   10.1, 0,    0.8 ], color: '#ffd4a0', width: 0.089, burstHeight: 17.0, burstScale: 4.2, startTime: 0.10, launchDuration: 1.81, delayDuration: -0.51, burstDuration: 2.2, bloomIntensity: 7.1, bloomFalloff: 14.2, noiseFalloff: 3.0 },
	{ offset: [    2.0, 0,    8.8 ], color: '#ff8a6a', width: 0.115, burstHeight: 22.5, burstScale: 3.1, startTime: 0.37, launchDuration: 1.74, delayDuration: -0.55, burstDuration: 2.7, bloomIntensity: 10.1, bloomFalloff: 15.4, noiseFalloff: 2.6 },
	{ offset: [   -5.5, 0,    7.1 ], color: '#a8d0ff', width: 0.076, burstHeight: 14.8, burstScale: 4.5, startTime: 0.65, launchDuration: 1.74, delayDuration: -0.21, burstDuration: 2.3, bloomIntensity: 11.4, bloomFalloff: 15.8, noiseFalloff: 3.1 },
	{ offset: [   -9.0, 0,   -1.7 ], color: '#ffe08a', width: 0.130, burstHeight: 23.0, burstScale: 4.2, startTime: 0.85, launchDuration: 1.24, delayDuration: -0.41, burstDuration: 1.8, bloomIntensity: 8.0, bloomFalloff: 13.0, noiseFalloff: 2.7 },
	{ offset: [   -2.9, 0,   -9.8 ], color: '#e0a0ff', width: 0.096, burstHeight: 16.8, burstScale: 3.2, startTime: 1.26, launchDuration: 1.60, delayDuration: -0.26, burstDuration: 1.9, bloomIntensity: 10.3, bloomFalloff: 13.6, noiseFalloff: 2.9 },
	{ offset: [    7.8, 0,   -7.2 ], color: '#90f0c8', width: 0.109, burstHeight: 25.0, burstScale: 4.5, startTime: 1.52, launchDuration: 1.24, delayDuration: -0.53, burstDuration: 2.1, bloomIntensity: 8.2, bloomFalloff: 14.1, noiseFalloff: 3.5 },
	{ offset: [   17.8, 0,    5.7 ], color: '#ffb0c8', width: 0.116, burstHeight: 20.0, burstScale: 4.6, startTime: 1.75, launchDuration: 1.28, delayDuration: -0.43, burstDuration: 2.4, bloomIntensity: 8.2, bloomFalloff: 17.8, noiseFalloff: 3.5 },
	{ offset: [   10.6, 0,   15.5 ], color: '#ffc878', width: 0.140, burstHeight: 22.0, burstScale: 2.8, startTime: 1.97, launchDuration: 1.14, delayDuration: -0.26, burstDuration: 2.7, bloomIntensity: 8.9, bloomFalloff: 12.6, noiseFalloff: 2.9 },
	{ offset: [    0.4, 0,   21.1 ], color: '#c8e8ff', width: 0.138, burstHeight: 28.0, burstScale: 2.6, startTime: 2.35, launchDuration: 1.63, delayDuration: -0.30, burstDuration: 2.0, bloomIntensity: 9.9, bloomFalloff: 13.1, noiseFalloff: 2.9 },
	{ offset: [  -11.2, 0,   15.3 ], color: '#ff9a7a', width: 0.131, burstHeight: 17.5, burstScale: 3.7, startTime: 2.55, launchDuration: 1.83, delayDuration: -0.14, burstDuration: 2.1, bloomIntensity: 9.9, bloomFalloff: 18.1, noiseFalloff: 2.6 },
	{ offset: [  -18.1, 0,    5.5 ], color: '#b8f0a0', width: 0.125, burstHeight: 22.2, burstScale: 2.6, startTime: 2.85, launchDuration: 1.07, delayDuration: -0.11, burstDuration: 2.8, bloomIntensity: 10.7, bloomFalloff: 15.1, noiseFalloff: 2.5 },
	{ offset: [  -18.8, 0,   -6.1 ], color: '#d0b0ff', width: 0.076, burstHeight: 21.5, burstScale: 2.8, startTime: 3.19, launchDuration: 1.70, delayDuration: -0.49, burstDuration: 2.3, bloomIntensity: 9.5, bloomFalloff: 14.7, noiseFalloff: 3.4 },
	{ offset: [  -10.2, 0,  -15.6 ], color: '#ffe4b0', width: 0.108, burstHeight: 25.8, burstScale: 3.0, startTime: 3.41, launchDuration: 1.90, delayDuration: -0.24, burstDuration: 2.2, bloomIntensity: 9.3, bloomFalloff: 13.2, noiseFalloff: 2.7 },
	{ offset: [    0.3, 0,  -19.3 ], color: '#7ad0ff', width: 0.086, burstHeight: 16.8, burstScale: 2.8, startTime: 3.73, launchDuration: 1.24, delayDuration: -0.12, burstDuration: 2.7, bloomIntensity: 7.3, bloomFalloff: 14.4, noiseFalloff: 3.2 },
	{ offset: [   12.3, 0,  -17.4 ], color: '#ffd0e8', width: 0.135, burstHeight: 23.0, burstScale: 3.6, startTime: 4.04, launchDuration: 1.74, delayDuration: -0.46, burstDuration: 1.8, bloomIntensity: 8.9, bloomFalloff: 16.2, noiseFalloff: 3.0 },
	{ offset: [   17.9, 0,   -4.5 ], color: '#a0ffe0', width: 0.139, burstHeight: 14.8, burstScale: 3.5, startTime: 4.25, launchDuration: 1.78, delayDuration: -0.43, burstDuration: 1.9, bloomIntensity: 9.0, bloomFalloff: 16.2, noiseFalloff: 2.7 },
	{ offset: [    4.4, 0,  -11.0 ], color: '#ffb86a', width: 0.101, burstHeight: 28.0, burstScale: 3.8, startTime: 4.49, launchDuration: 1.90, delayDuration: -0.16, burstDuration: 2.9, bloomIntensity: 11.2, bloomFalloff: 20.5, noiseFalloff: 2.6 },
	{ offset: [  -14.0, 0,    7.3 ], color: '#c0d8ff', width: 0.098, burstHeight: 14.0, burstScale: 3.4, startTime: 4.91, launchDuration: 1.28, delayDuration: -0.18, burstDuration: 2.2, bloomIntensity: 8.9, bloomFalloff: 21.6, noiseFalloff: 3.6 },
]

type PostSettings = {
	loop: boolean
	postBloom: boolean
	postBloomStrength: number
	postBloomThreshold: number
	postBloomRadius: number
	vignette: boolean
	vignetteAmount: number
	exposureEnabled: boolean
	exposure: number
	fxaa: boolean
	chromatic: boolean
	chromaticStrength: number
	filmGrain: boolean
	filmIntensity: number
}

type PostChain = {
	pipeline: RenderPipeline
	sceneColor: any
	bloomPass: any
	camera: PerspectiveCamera
	uVignetteAmount: any
	uExposure: any
	uChromaticStrength: any
	uFilmIntensity: any
	lastTopoKey: string
}

const defaultPost: PostSettings = {
	loop: true,
	postBloom: true,
	postBloomStrength: 0.55,
	postBloomThreshold: 0.4,
	postBloomRadius: 0.5,
	vignette: true,
	vignetteAmount: 0.35,
	exposureEnabled: true,
	exposure: 1.05,
	fxaa: true,
	chromatic: false,
	chromaticStrength: 0.35,
	filmGrain: false,
	filmIntensity: 0.08,
}

function spawnShell( shell: ShowShell, loop: boolean ): Fireworks {

	const { offset, ...options } = shell
	// Launch trail is positionLocal * burstOrigin from mesh local (0,0,0).
	// Put each shell on the ground via object.position; keep burstPositionOffset at 0
	// so the trail rises straight up instead of all sharing world origin.
	const fireworks = new Fireworks( {
		...options,
		loop,
		burstPositionOffset: new Vector3( 0, 0, 0 ),
	} )
	fireworks.object.position.set( offset[ 0 ], offset[ 1 ], offset[ 2 ] )
	return fireworks

}

function applyShell( fireworks: Fireworks, shell: ShowShell, loop: boolean ): void {

	fireworks.loop = loop
	fireworks.color = shell.color ?? '#ffd4a0'
	fireworks.width = shell.width ?? 0.1
	fireworks.burstHeight = shell.burstHeight ?? 6.5
	fireworks.burstScale = shell.burstScale ?? 3.5
	fireworks.startTime = shell.startTime ?? 0
	fireworks.launchDuration = shell.launchDuration ?? 1.5
	fireworks.delayDuration = shell.delayDuration ?? -0.4
	fireworks.burstDuration = shell.burstDuration ?? 2.0
	fireworks.bloomIntensity = shell.bloomIntensity ?? 9.0
	fireworks.bloomFalloff = shell.bloomFalloff ?? 18.0
	fireworks.noiseFalloff = shell.noiseFalloff ?? 3.0
	const [ x, y, z ] = shell.offset
	fireworks.burstPositionOffset.set( 0, 0, 0 )
	fireworks.object.position.set( x, y, z )

}

/** Linear vignette: darken by distance from screen center. */
function applyVignette( colorNode: any, amount: any ): any {

	const dist = uv().sub( vec2( 0.5, 0.5 ) ).length()
	const factor = float( 1.0 ).sub( smoothstep( float( 0.4 ), float( 1.05 ), dist ).mul( amount ) )
	return vec4( colorNode.rgb.mul( factor ), colorNode.a )

}

/** Pre-ACES exposure multiply (renderer.toneMappingExposure stays 1). */
function applyExposure( colorNode: any, exposure: any ): any {

	return vec4( colorNode.rgb.mul( exposure ), colorNode.a )

}

/**
 * Compose post chain (linear space):
 * scene → Bloom → vignette → exposure → FXAA → chromatic aberration → film grain
 * then RenderPipeline outputColorTransform applies ACES + sRGB once.
 */
function composePostOutput( chain: PostChain, settings: PostSettings ): any {

	let color: any = settings.postBloom
		? chain.sceneColor.add( chain.bloomPass )
		: chain.sceneColor

	// Gate full-screen nodes in the graph — zeroing uniforms alone still runs CA/film/noise.
	if ( settings.vignette ) {

		color = applyVignette( color, chain.uVignetteAmount )

	}

	color = applyExposure( color, chain.uExposure )

	if ( settings.fxaa ) {

		color = fxaa( color )

	}

	if ( settings.chromatic ) {

		// Explicit center — chromaticAberration(null) becomes nodeObject(null) and crashes Fn.build.
		color = chromaticAberration( color, chain.uChromaticStrength, vec2( 0.5, 0.5 ), float( 1.05 ) )

	}

	if ( settings.filmGrain ) {

		color = film( color, chain.uFilmIntensity )

	}

	return color

}

function applyPostSettings( chain: PostChain, settings: PostSettings ): void {

	chain.bloomPass.strength.value = settings.postBloomStrength
	chain.bloomPass.threshold.value = settings.postBloomThreshold
	chain.bloomPass.radius.value = settings.postBloomRadius
	chain.uVignetteAmount.value = settings.vignetteAmount
	chain.uExposure.value = settings.exposureEnabled ? settings.exposure : 1
	chain.uChromaticStrength.value = settings.chromaticStrength
	chain.uFilmIntensity.value = settings.filmIntensity

	// Rebuild when any optional full-screen pass is toggled in/out of the graph.
	const topoKey = [
		settings.postBloom,
		settings.vignette,
		settings.fxaa,
		settings.chromatic,
		settings.filmGrain,
	].join( ':' )
	if ( topoKey === chain.lastTopoKey ) return
	chain.lastTopoKey = topoKey

	chain.pipeline.outputNode = composePostOutput( chain, settings )
	chain.pipeline.needsUpdate = true

}

/**
 * Minimal canvas host. Perf + post/show controls live on three Inspector
 * (renderer.inspector = new Inspector(); createParameters(...)).
 */
export default function App() {

	const viewRef = useRef<HTMLDivElement>( null )

	useEffect( () => {

		const host = viewRef.current
		if ( !host ) return

		let disposed = false
		let renderer: WebGPURenderer | undefined
		let pipeline: RenderPipeline | undefined
		let controls: OrbitControls | undefined
		const show: Fireworks[] = []
		let postChain: PostChain | null = null

		const scene = new Scene()
		scene.background = new Color( 0x04060a )

		const camera = new PerspectiveCamera( 55, 1, 0.1, 500 )
		camera.position.set( 32, 22, 42 )

		const post = { ...defaultPost }

		const display = {
			pixelRatioCap: Number( sessionStorage.getItem( 'fw-dpr-cap' ) || 1.5 ),
			msaa: sessionStorage.getItem( 'fw-msaa' ) === '1',
		}
		if ( display.pixelRatioCap !== 1 && display.pixelRatioCap !== 1.5 && display.pixelRatioCap !== 2 ) {
			display.pixelRatioCap = 1.5
		}


		for ( const shell of SHOW_SHELLS ) {

			const fw = spawnShell( shell, post.loop )
			scene.add( fw.object )
			show.push( fw )

		}

		const clock = { last: performance.now() }

		const resize = () => {

			if ( !renderer ) return
			const width = host.clientWidth
			const height = Math.max( host.clientHeight, 1 )
			camera.aspect = width / height
			camera.updateProjectionMatrix()
			renderer.setSize( width, height, false )

		}

		const tick = () => {

			if ( disposed || !renderer || !pipeline ) return
			const now = performance.now()
			const delta = Math.min( ( now - clock.last ) / 1000, 0.05 )
			clock.last = now
			for ( const fw of show ) fw.update( delta )
			controls?.update()
			pipeline.render()

		}

		;( async () => {

			try {

				renderer = new WebGPURenderer( { antialias: display.msaa, alpha: false } )
				renderer.outputColorSpace = SRGBColorSpace
				renderer.toneMapping = ACESFilmicToneMapping
				renderer.toneMappingExposure = 1.0
				renderer.setPixelRatio( Math.min( window.devicePixelRatio, display.pixelRatioCap ) )
				// Native WebGPU Inspector: Performance / Memory / Parameters tabs.
				const inspector = new Inspector()
				renderer.inspector = inspector
				await renderer.init()
				if ( disposed ) {

					renderer.dispose()
					return

				}

				renderer.domElement.classList.add( 'app-canvas' )
				host.appendChild( renderer.domElement )
				controls = new OrbitControls( camera, renderer.domElement )
				controls.target.set( 0, 12, 0 )
				controls.update()

				const scenePass = pass( scene, camera )
				const sceneColor = scenePass.getTextureNode( 'output' )

				const bloomPass = bloom(
					sceneColor,
					defaultPost.postBloomStrength,
					defaultPost.postBloomRadius,
					defaultPost.postBloomThreshold,
				)

				const uVignetteAmount = uniform( defaultPost.vignetteAmount )
				const uExposure = uniform( defaultPost.exposure )
				const uChromaticStrength = uniform( defaultPost.chromaticStrength )
				const uFilmIntensity = uniform( defaultPost.filmIntensity )

				pipeline = new RenderPipeline( renderer )
				pipeline.outputColorTransform = true

				postChain = {
					pipeline,
					sceneColor,
					bloomPass,
					camera,
					uVignetteAmount,
					uExposure,
					uChromaticStrength,
					uFilmIntensity,
					lastTopoKey: '',
				}
				applyPostSettings( postChain, post )

				const syncPost = () => {

					if ( postChain ) applyPostSettings( postChain, post )

				}

				const syncLoop = () => {

					for ( const fw of show ) fw.loop = post.loop

				}

				const actions = {
					restartAll: () => {

						for ( const fw of show ) fw.restart()

					},
					restoreShow: () => {

						Object.assign( post, defaultPost )
						show.forEach( ( fw, i ) => {

							const shell = SHOW_SHELLS[ i ]
							if ( shell ) applyShell( fw, shell, post.loop )

						} )
						syncPost()
						for ( const fw of show ) fw.restart()

					},
				}

				const showGui = inspector.createParameters( 'Show' )
				showGui.add( post, 'loop' ).name( 'Loop' ).onChange( syncLoop )
				showGui.add( actions, 'restartAll' ).name( 'Restart all' )
				showGui.add( actions, 'restoreShow' ).name( 'Restore show' )

				const bloomGui = inspector.createParameters( 'Bloom' )
				bloomGui.add( post, 'postBloom' ).name( 'Enabled' ).onChange( syncPost )
				bloomGui.add( post, 'postBloomStrength', 0, 3, 0.05 ).name( 'Strength' ).onChange( syncPost )
				bloomGui.add( post, 'postBloomThreshold', 0, 1, 0.01 ).name( 'Threshold' ).onChange( syncPost )
				bloomGui.add( post, 'postBloomRadius', 0, 1, 0.01 ).name( 'Radius' ).onChange( syncPost )

				const vigGui = inspector.createParameters( 'Vignette' )
				vigGui.add( post, 'vignette' ).name( 'Enabled' ).onChange( syncPost )
				vigGui.add( post, 'vignetteAmount', 0, 1, 0.01 ).name( 'Amount' ).onChange( syncPost )

				const expGui = inspector.createParameters( 'Exposure' )
				expGui.add( post, 'exposureEnabled' ).name( 'Enabled' ).onChange( syncPost )
				expGui.add( post, 'exposure', 0.4, 2.5, 0.05 ).name( 'Exposure' ).onChange( syncPost )

				const aaGui = inspector.createParameters( 'FXAA' )
				aaGui.add( post, 'fxaa' ).name( 'Enabled' ).onChange( syncPost )

				const caGui = inspector.createParameters( 'Chromatic Aberration' )
				caGui.add( post, 'chromatic' ).name( 'Enabled' ).onChange( syncPost )
				caGui.add( post, 'chromaticStrength', 0, 2, 0.05 ).name( 'Strength' ).onChange( syncPost )

				const filmGui = inspector.createParameters( 'Film Grain' )
				filmGui.add( post, 'filmGrain' ).name( 'Enabled' ).onChange( syncPost )
				filmGui.add( post, 'filmIntensity', 0, 1, 0.01 ).name( 'Intensity' ).onChange( syncPost )

				const displayGui = inspector.createParameters( 'Display' )
				displayGui.add( display, 'pixelRatioCap', { '1': 1, '1.5': 1.5, '2': 2 } ).name( 'Pixel ratio cap' ).onChange( () => {

					sessionStorage.setItem( 'fw-dpr-cap', String( display.pixelRatioCap ) )
					renderer!.setPixelRatio( Math.min( window.devicePixelRatio, display.pixelRatioCap ) )
					resize()

				} )
				displayGui.add( display, 'msaa' ).name( 'MSAA (reloads)' ).onChange( () => {

					sessionStorage.setItem( 'fw-msaa', display.msaa ? '1' : '0' )
					window.location.reload()

				} )

				resize()
				window.addEventListener( 'resize', resize )
				clock.last = performance.now()
				renderer.setAnimationLoop( tick )

			} catch ( error ) {

				const message = error instanceof Error ? error.message : String( error )
				console.error( 'WebGPU init failed:', message )

			}

		} )()

		return () => {

			disposed = true
			renderer?.setAnimationLoop( null )
			window.removeEventListener( 'resize', resize )
			controls?.dispose()
			for ( const fw of show ) {

				scene.remove( fw.object )
				fw.dispose()

			}
			postChain = null
			if ( renderer ) {

				renderer.domElement.remove()
				renderer.dispose()

			}

		}

	}, [] )

	return (
		<div className="app">
			<div className="view" ref={viewRef} />
		</div>
	)

}
