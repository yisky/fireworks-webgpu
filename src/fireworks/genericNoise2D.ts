import { Fn, dot, floor, fract, mix, sin, smoothstep, vec2 } from 'three/tsl'

/**
 * 基于 sin/dot 的伪随机：同一整数坐标恒定，相邻坐标不相关。
 */
const random2 = /*@__PURE__*/ Fn( ( [ co ]: [ any ] ) => {

	return fract( sin( dot( co, vec2( 12.9898, 78.233 ) ) ).mul( 47453.5453 ) )

}, { co: 'vec2', return: 'float' } )

/**
 * 二维 value noise（与 fantasy3d generic_noise(vec2) 同构）。
 *
 * 在整数格点上取伪随机，再对小数部分做 smoothstep 双线性插值，得到连续噪声场，
 * 用于片元阶段沿飘带长度的烧蚀溶解。
 */
export const genericNoise2D = /*@__PURE__*/ Fn( ( [ p ]: [ any ] ) => {

	const pos = vec2( p )
	const b = floor( pos )
	const f = smoothstep( vec2( 0.0 ), vec2( 1.0 ), fract( pos ) )
	const d = vec2( 0.0, 1.0 )

	const n00 = random2( b )
	const n10 = random2( b.add( vec2( d.y, d.x ) ) )
	const n01 = random2( b.add( vec2( d.x, d.y ) ) )
	const n11 = random2( b.add( vec2( d.y, d.y ) ) )

	return mix( mix( n00, n10, f.x ), mix( n01, n11, f.x ), f.y )

}, { p: 'vec2', return: 'float' } )
